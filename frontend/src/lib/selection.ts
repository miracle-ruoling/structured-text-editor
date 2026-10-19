import type { Condition, Selector } from './types.ts';

export type SelectionSession = { selector: Selector; active: boolean; previous: Selector | null };

export function emptySelectionSession(): SelectionSession {
  return { selector: { mode: 'all', conditions: [] }, active: false, previous: null };
}

export function leaveSelection(session: SelectionSession): SelectionSession {
  return {
    ...emptySelectionSession(),
    previous: structuredClone(session.active ? session.selector : session.previous),
  };
}

export function activateSelection(session: SelectionSession, selector: Selector, explicitAll = false): SelectionSession {
  if (!explicitAll && selector.mode !== 'expression' && !selector.conditions.length) return leaveSelection(session);
  return { ...session, selector: withKeys(selector), active: true };
}

function letterKey(number: number): string {
  let result = '';
  do { result = String.fromCharCode(65 + number % 26) + result; number = Math.floor(number / 26) - 1; } while (number >= 0);
  return result;
}

export function nextKey(selector: Selector): string {
  // Reserve dangling expression references too: deleting B must never rebind $B.
  const used = new Set([...selector.conditions.map(c => c.key), ...[...(selector.expression || '').matchAll(/\$([A-Z][A-Z0-9_]*)/gi)].map(m => m[1].toUpperCase())]);
  let index = 0;
  while (used.has(letterKey(index))) index++;
  return letterKey(index);
}

export function withKeys(selector: Selector): Selector {
  const result = structuredClone(selector);
  for (const condition of result.conditions) if (!condition.key) condition.key = nextKey(result);
  return result;
}

export function toggleExpression(selector: Selector): Selector {
  const result = withKeys(selector);
  if (result.mode === 'expression') return { ...result, mode: 'all', expression: '' };
  return { ...result, mode: 'expression', expression: result.conditions.map(c => `$${c.key}`).join(result.mode === 'all' ? ' AND ' : ' OR ') };
}

export function rangeCondition(ids: string[], key?: string): Condition {
  return { key, field: 'ids', op: 'is', value: '', ids: [...new Set(ids)] };
}

export function selectorSignature(selector: Selector | null): string {
  if (!selector) return '';
  return JSON.stringify({ mode: selector.mode, expression: selector.expression || '', conditions: selector.conditions.map(c => ({ key: selector.mode === 'expression' ? c.key : undefined, field: c.field, op: c.op, value: c.value, ids: c.ids })) });
}
