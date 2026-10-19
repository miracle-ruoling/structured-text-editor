import assert from 'node:assert/strict';
import test from 'node:test';
import { activateSelection, emptySelectionSession, leaveSelection, nextKey, rangeCondition, selectorSignature, toggleExpression, withKeys } from '../src/lib/selection.ts';
import { selectorComplete } from '../src/lib/workspace.ts';
import type { Selector } from '../src/lib/types.ts';

test('删除条件保留其他代号，新增条件不接管表达式的悬空引用', () => {
  const selector: Selector = { mode: 'any', conditions: ['a', 'b', 'c'].map(value => ({ field: 'tag', op: 'is', value })) };
  const advanced = toggleExpression(selector);
  assert.equal(advanced.expression, '$A OR $B OR $C');
  const removed = { ...advanced, conditions: advanced.conditions.filter(c => c.key !== 'B') };
  assert.deepEqual(withKeys(removed).conditions.map(c => c.key), ['A', 'C']);
  assert.equal(nextKey(removed), 'D');
  assert.equal(selector.conditions[0].key, undefined);
});

test('框选条件使用独立快照，不被之后的框选修改', () => {
  const marks = ['p3', 'p5', 'p3'];
  const range = rangeCondition(marks, 'A');
  marks.push('p7');
  assert.deepEqual(range.ids, ['p3', 'p5']);
  assert.equal(selectorComplete({ mode: 'all', conditions: [range] }), true);
  assert.equal(selectorComplete({ mode: 'all', conditions: [rangeCondition([])] }), false);
});

test('切回简单模式显式清空表达式；简单预设比较不受代号或属性顺序影响', () => {
  const simple: Selector = { mode: 'all', conditions: [{ field: 'role', op: 'is', value: 'body' }] };
  const advanced = toggleExpression(simple);
  const returned = toggleExpression(advanced);
  assert.equal(returned.mode, 'all');
  assert.equal(returned.expression, '');
  assert.equal(selectorSignature(simple), selectorSignature(returned));
  assert.equal(selectorSignature(simple), selectorSignature({ mode: 'all', expression: '', conditions: [{ value: 'body', key: 'B', op: 'is', field: 'role' }] }));
  assert.equal(selectorComplete({ ...advanced, expression: '' }), false);
});

test('首次进入无历史；退出清空当前范围，同时保留独立的恢复快照', () => {
  const initial = emptySelectionSession();
  assert.equal(initial.active, false);
  assert.equal(initial.previous, null);
  const active = activateSelection(initial, { mode: 'all', conditions: [rangeCondition(['p3', 'p5'])] });
  const idle = leaveSelection(active);
  assert.equal(idle.active, false);
  assert.deepEqual(idle.selector, { mode: 'all', conditions: [] });
  assert.deepEqual(idle.previous, active.selector);
  active.selector.conditions[0].ids!.push('p7');
  const resumed = activateSelection(idle, idle.previous!, true);
  assert.equal(resumed.active, true);
  assert.deepEqual(resumed.selector.conditions[0].ids, ['p3', 'p5']);
  assert.deepEqual(leaveSelection(idle).previous, idle.previous);
});

test('删除最后一个简单条件进入空闲，显式全选仍可退出并恢复', () => {
  const active = activateSelection(emptySelectionSession(), { mode: 'all', conditions: [rangeCondition(['p3'])] });
  const cleared = activateSelection(active, { mode: 'all', conditions: [] });
  assert.equal(cleared.active, false);
  assert.deepEqual(cleared.previous, active.selector);
  const all = activateSelection(cleared, { mode: 'all', conditions: [] }, true);
  const idle = leaveSelection(all);
  assert.equal(idle.previous?.conditions.length, 0);
  assert.equal(activateSelection(idle, idle.previous!, true).active, true);
  assert.equal(emptySelectionSession().previous, null, '切换文档不带入恢复范围');
});

test('高级模式删完条件保持失效表达式可修正，不能落入空 AND 全选', () => {
  const active = activateSelection(emptySelectionSession(), toggleExpression({ mode: 'all', conditions: [rangeCondition(['p3'])] }));
  const dangling = activateSelection(active, { ...active.selector, conditions: [] });
  assert.equal(dangling.active, true);
  assert.equal(dangling.selector.mode, 'expression');
  assert.equal(dangling.selector.expression, '$A');
  assert.equal(leaveSelection(dangling).active, false);
});
