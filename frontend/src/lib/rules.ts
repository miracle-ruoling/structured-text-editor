import type { FormatRule, RuleView, Selector } from './types.ts';

// Only persisted fields belong in a draft, never computed match statistics.
export function ruleDraft(rule: FormatRule): FormatRule {
  return { id: rule.id, name: rule.name, enabled: rule.enabled, patch: { ...rule.patch }, selector: structuredClone(rule.selector) };
}

export function newRule(id: string, selector: Selector): FormatRule {
  return { id, name: '', enabled: true, patch: {}, selector: structuredClone(selector) };
}

export function ruleIsDirty(draft: FormatRule | null, rules: RuleView[]): boolean {
  if (!draft) return false;
  const saved = rules.find(rule => rule.id === draft.id);
  if (!saved) return !!draft.name.trim() || Object.keys(draft.patch).length > 0 || !draft.enabled;
  return JSON.stringify(ruleDraft(saved)) !== JSON.stringify(ruleDraft(draft));
}
