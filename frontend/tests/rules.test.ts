import assert from 'node:assert/strict';
import test from 'node:test';
import { newRule, ruleDraft, ruleIsDirty } from '../src/lib/rules.ts';
import type { RuleView, Selector } from '../src/lib/types.ts';

test('规则范围和格式草稿独立，批量范围后续变化不会污染已编辑的规则', () => {
  const selector: Selector = { mode: 'all', conditions: [{ field: 'ids', op: 'is', value: '', ids: ['p3'] }] };
  const fresh = newRule('a'.repeat(32), selector);
  selector.conditions[0].ids!.push('p5');
  assert.deepEqual(fresh.selector.conditions[0].ids, ['p3']);
  assert.deepEqual(fresh.patch, {});
  const saved: RuleView = { ...fresh, name: '段落规则', patch: { size_pt: 18 }, matched_count: 10, effective_count: 8 };
  const draft = ruleDraft(saved);
  draft.patch.size_pt = 20;
  draft.selector.conditions[0].ids!.push('p7');
  assert.equal(saved.patch.size_pt, 18);
  assert.deepEqual(saved.selector.conditions[0].ids, ['p3']);
  assert.equal('matched_count' in draft, false, '计算结果不能混入保存请求');
});

test('查看已有规则或打开空白新规则不需确认；实际编辑需要草稿保护', () => {
  const saved: RuleView = { ...newRule('a'.repeat(32), { mode: 'all', conditions: [] }), name: '全篇', patch: { size_pt: 12 }, matched_count: 20, effective_count: 19 };
  assert.equal(ruleIsDirty(ruleDraft(saved), [saved]), false);
  assert.equal(ruleIsDirty(ruleDraft(saved), [{ ...saved, matched_count: 30 }]), false);
  assert.equal(ruleIsDirty({ ...ruleDraft(saved), enabled: false }, [saved]), true);
  assert.equal(ruleIsDirty({ ...ruleDraft(saved), patch: { size_pt: 14 } }, [saved]), true);
  assert.equal(ruleIsDirty({ ...ruleDraft(saved), name: '另一规则' }, [saved]), true);
  assert.equal(ruleIsDirty({ ...ruleDraft(saved), selector: { mode: 'any', conditions: [] } }, [saved]), true);
  assert.equal(ruleIsDirty(newRule('b'.repeat(32), saved.selector), [saved]), false);
  assert.equal(ruleIsDirty({ ...newRule('b'.repeat(32), saved.selector), name: '新规则' }, [saved]), true);
  assert.equal(ruleIsDirty(null, [saved]), false);
});
