import assert from 'node:assert/strict';
import test from 'node:test';
import { activateSelection, emptySelectionSession, finishPointAdjustment, leaveSelection, nextKey, parseParagraphIds, pointIntent, rangeCondition, selectParagraph, selectorSignature, toggleExpression, withKeys } from '../src/lib/selection.ts';
import { selectionView } from '../src/lib/selectionView.ts';
import { selectorComplete } from '../src/lib/workspace.ts';
import type { Selector } from '../src/lib/types.ts';

test('删除条件保留其他代号；新增条件不接管表达式的悬空引用', () => {
  const selector: Selector = { mode: 'any', conditions: ['a', 'b', 'c'].map(value => ({ field: 'tag', op: 'is', value })) };
  const advanced = toggleExpression(selector);
  assert.equal(advanced.expression, '$A OR $B OR $C');
  const removed = { ...advanced, conditions: advanced.conditions.filter(c => c.key !== 'B') };
  assert.deepEqual(withKeys(removed).conditions.map(c => c.key), ['A', 'C']);
  assert.equal(nextKey(removed), 'D');
  assert.equal(selector.conditions[0].key, undefined);
});

test('编号草稿仅接受正整数并去重，拒绝未知与不可操作段落', () => {
  const available = new Set(['p1', 'p2', 'p8']);
  assert.deepEqual(parseParagraphIds('01 2 2 008', available).ids, ['p1', 'p2', 'p8']);
  assert.match(parseParagraphIds('0', available).error!, /没有可操作/);
  assert.match(parseParagraphIds('9', available).error!, /没有可操作/);
  assert.match(parseParagraphIds('', available).error!, /至少输入/);
  assert.equal(selectorComplete({ mode: 'all', conditions: [rangeCondition([])] }), false);
});

test('首次进入无历史；退出清空当前范围并保存恢复副本', () => {
  const initial = emptySelectionSession();
  assert.equal(initial.active, false);
  assert.equal(initial.previous, null);
  const active = activateSelection(initial, { mode: 'all', conditions: [rangeCondition(['p3', 'p5'])] });
  const idle = leaveSelection(active);
  assert.equal(idle.active, false);
  assert.deepEqual(idle.selector, { mode: 'all', conditions: [] });
  assert.deepEqual(idle.previous, active.selector);
  active.selector.conditions[0].ids!.push('p7');
  assert.deepEqual(activateSelection(idle, idle.previous!, true).selector.conditions[0].ids, ['p3', 'p5']);
});

test('简单模式删完退出；显式全选可恢复，高级失效表达式仍可修正', () => {
  const active = activateSelection(emptySelectionSession(), { mode: 'all', conditions: [rangeCondition(['p3'])] });
  const cleared = activateSelection(active, { mode: 'all', conditions: [] });
  assert.equal(cleared.active, false);
  const all = activateSelection(cleared, { mode: 'all', conditions: [] }, true);
  assert.equal(leaveSelection(all).previous?.conditions.length, 0);
  const advanced = activateSelection(emptySelectionSession(), toggleExpression({ mode: 'all', conditions: [rangeCondition(['p3'])] }));
  const dangling = activateSelection(advanced, { ...advanced.selector, conditions: [] });
  assert.equal(dangling.active, true);
  assert.equal(dangling.selector.expression, '$A');
});

test('直接选择普通点击替换；Ctrl 切换同一组，重复点击可取消', () => {
  const first = selectParagraph(emptySelectionSession(), 'p1', false);
  assert.equal(first.active, true); assert.equal(first.direct, true);
  const next = selectParagraph(first, 'p2', false);
  assert.deepEqual(next.selector.conditions[0].ids, ['p2']);
  const added = selectParagraph(next, 'p3', true);
  assert.deepEqual(added.selector.conditions[0].ids, ['p2', 'p3']);
  const toggled = selectParagraph(added, 'p2', true);
  assert.deepEqual(toggled.selector.conditions[0].ids, ['p3']);
  assert.notEqual(added.selector, toggled.selector);
  assert.deepEqual(selectParagraph(emptySelectionSession(), 'p5', true).selector.conditions[0].ids, ['p5']);
  assert.deepEqual(selectParagraph(added, 'p2', false).selector.conditions[0].ids, ['p2']);
});

test('筛选中连续 Ctrl 点选并可反选，不依赖按键释放或产生额外条件', () => {
  const base = activateSelection(emptySelectionSession(), { mode: 'any', conditions: [{ field: 'role', op: 'is', value: 'body' }] });
  const first = pointIntent(base, 'p2', false);
  const second = pointIntent(first, 'p4', true);
  const third = pointIntent(second, 'p2', true);
  assert.deepEqual(first.pendingChanges, [{ id: 'p2', selected: false }]);
  assert.deepEqual(second.pendingChanges, [{ id: 'p2', selected: false }, { id: 'p4', selected: true }]);
  assert.deepEqual(third.pendingChanges, [{ id: 'p2', selected: true }, { id: 'p4', selected: true }]);
  assert.deepEqual(base.pendingChanges, []);
  const committed = finishPointAdjustment(second, { selector: { mode: 'all', conditions: [rangeCondition(['p4'])] } });
  assert.equal(committed.pendingChanges.length, 0);
  assert.equal(committed.direct, false);
  assert.equal(selectorSignature(committed.selector), selectorSignature({ mode: 'all', conditions: [rangeCondition(['p4'])] }));
});

test('条件变化保留旧范围作视觉参考但禁止旧范围操作；点选期间即时反映并暂禁提交', () => {
  const base = activateSelection(emptySelectionSession(), { mode: 'all', conditions: [{ field: 'role', op: 'is', value: 'body' }] });
  const frame = { scope: 'doc:1', selector: base.selector, ids: ['p1', 'p2'] };
  const pending = pointIntent(base, 'p2', false);
  const optimistic = selectionView('doc:1', pending, frame);
  assert.deepEqual(optimistic.ids, ['p1']);
  assert.equal(optimistic.ready, false);
  assert.equal(optimistic.canToggle, true);
  const changed = activateSelection(base, { mode: 'any', conditions: [{ field: 'tag', op: 'is', value: 'x' }] });
  const updating = selectionView('doc:1', changed, frame);
  assert.deepEqual(updating.ids, ['p1', 'p2']);
  assert.equal(updating.ready, false);
  assert.equal(updating.canToggle, false);
  const accepted = selectionView('doc:1', changed, { scope: 'doc:1', selector: changed.selector, ids: ['p3'] });
  assert.deepEqual(accepted.ids, ['p3']);
  assert.equal(accepted.ready, true);
});

test('高级表达式切换与签名保留语义，普通内容条件仍判定有效', () => {
  const simple: Selector = { mode: 'all', conditions: [{ field: 'role', op: 'is', value: 'body' }] };
  const advanced = toggleExpression(simple);
  assert.equal(advanced.expression, '$A');
  const returned = toggleExpression(advanced);
  assert.equal(selectorSignature(simple), selectorSignature(returned));
  assert.equal(selectorComplete({ ...advanced, expression: '' }), false);
});
