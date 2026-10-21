import assert from 'node:assert/strict';
import test from 'node:test';
import { activateSelection, emptySelectionSession, endPointerGesture, leaveSelection, nextKey, rangeCondition, selectParagraph, selectorSignature, toggleExpression, withKeys } from '../src/lib/selection.ts';
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

test('直接点选立即建立范围，普通点击换段，分次 Ctrl 也向同一范围去重扩选', () => {
  const one = selectParagraph(emptySelectionSession(), 'p1', false);
  assert.equal(one.active, true); assert.equal(one.direct, true);
  const two = selectParagraph(one, 'p2', false);
  assert.deepEqual(two.selector.conditions[0].ids, ['p2']);
  const three = selectParagraph(endPointerGesture(selectParagraph(two, 'p3', true)), 'p4', true);
  assert.equal(three.selector.conditions.length, 1);
  assert.deepEqual(selectParagraph(three, 'p3', true).selector.conditions[0].ids, ['p2', 'p3', 'p4']);
  assert.deepEqual(one.selector.conditions[0].ids, ['p1']);
  assert.equal(selectParagraph(emptySelectionSession(), 'p5', true).direct, true);
});

test('自定义筛选中的普通点选不改变范围，Ctrl 一次按住合并，释放后建立新快照', () => {
  const base = activateSelection(emptySelectionSession(), { mode: 'any', conditions: [{ field: 'role', op: 'is', value: 'body' }] });
  assert.strictEqual(selectParagraph(base, 'p9', false), base);
  const first = selectParagraph(base, 'p1', true);
  const second = selectParagraph(first, 'p2', true);
  assert.equal(second.selector.mode, 'any');
  assert.deepEqual(second.selector.conditions[1].ids, ['p1', 'p2']);
  assert.deepEqual(first.selector.conditions[1].ids, ['p1']);
  assert.strictEqual(selectParagraph(second, 'p1', true), second);
  const nextGesture = selectParagraph(endPointerGesture(second), 'p3', true);
  assert.equal(nextGesture.selector.conditions.length, 3);
  assert.deepEqual(nextGesture.selector.conditions[1].ids, ['p1', 'p2']);
  assert.deepEqual(nextGesture.selector.conditions[2].ids, ['p3']);
  assert.notEqual(nextGesture.gestureKey, second.gestureKey);
});

test('编辑条件后退出直接点选模式；普通点击、换页或失焦结束手势且不重算选择器', () => {
  const direct = selectParagraph(emptySelectionSession(), 'p1', false);
  const filtered = activateSelection(direct, { ...direct.selector, conditions: [...direct.selector.conditions, { field: 'role', op: 'is', value: 'body' }] });
  assert.equal(filtered.direct, false);
  const added = selectParagraph(filtered, 'p2', true);
  const ordinary = selectParagraph(added, 'p3', false);
  assert.equal(ordinary.gestureKey, null);
  assert.strictEqual(ordinary.selector, added.selector);
  assert.strictEqual(endPointerGesture(added).selector, added.selector);
  const edited = activateSelection(added, added.selector);
  assert.equal(edited.gestureKey, null);
  assert.equal(selectParagraph(edited, 'p4', true).selector.conditions.length, 4);
});

test('退出筛选后重新点选不恢复旧条件；恢复保存的快照为筛选状态', () => {
  const first = selectParagraph(emptySelectionSession(), 'p1', false);
  const idle = leaveSelection(first);
  const next = selectParagraph(idle, 'p2', true);
  assert.deepEqual(next.selector.conditions[0].ids, ['p2']);
  assert.deepEqual(idle.previous?.conditions[0].ids, ['p1']);
  const restored = activateSelection(idle, idle.previous!, true);
  assert.equal(restored.direct, false);
  assert.strictEqual(selectParagraph(restored, 'p9', false).selector, restored.selector);
});

test('显式全选不因普通点击缩小，高级 Ctrl 条件保留原式及悬空代号', () => {
  const all = activateSelection(emptySelectionSession(), { mode: 'all', conditions: [] }, true);
  assert.strictEqual(selectParagraph(all, 'p1', false), all);
  assert.equal(selectParagraph(all, 'p1', true).direct, false);
  const advanced = activateSelection(emptySelectionSession(), {
    mode: 'expression', conditions: [rangeCondition(['p1'], 'A')], expression: '$A OR NOT $B',
  });
  const added = selectParagraph(advanced, 'p2', true);
  assert.equal(added.gestureKey, 'C');
  assert.equal(added.selector.expression, '($A OR NOT $B) AND $C');
  assert.equal(selectParagraph(added, 'p3', true).selector.expression, added.selector.expression);
  const emptyExpression = activateSelection(advanced, { ...advanced.selector, expression: '' });
  assert.equal(selectorComplete(selectParagraph(emptyExpression, 'p4', true).selector), false);
});

test('条件上限不丢失原筛选，仍允许向本次最后一组增加段落', () => {
  const base = activateSelection(emptySelectionSession(), { mode: 'all', conditions: Array.from({ length: 29 }, () => ({ field: 'role', op: 'is', value: 'body' })) });
  const last = selectParagraph(base, 'p1', true);
  assert.equal(last.selector.conditions.length, 30);
  assert.deepEqual(selectParagraph(last, 'p2', true).selector.conditions[29].ids, ['p1', 'p2']);
  assert.throws(() => selectParagraph(endPointerGesture(last), 'p3', true), /最多 30/);
  assert.equal(base.selector.conditions.length, 29);
});
