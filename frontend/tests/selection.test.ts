import assert from 'node:assert/strict';
import test from 'node:test';
import { nextKey, rangeCondition, selectorSignature, toggleExpression, withKeys } from '../src/lib/selection.ts';
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
