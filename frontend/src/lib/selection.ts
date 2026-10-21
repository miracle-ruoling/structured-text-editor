import type { Condition, Selector } from './types.ts';

export type SelectionSession = {
  selector: Selector; active: boolean; previous: Selector | null;
  direct: boolean;
  pendingChanges: { id: string; selected: boolean }[];
};

export function emptySelectionSession(): SelectionSession {
  return { selector: { mode: 'all', conditions: [] }, active: false, previous: null, direct: false, pendingChanges: [] };
}

export function leaveSelection(session: SelectionSession): SelectionSession {
  return {
    ...emptySelectionSession(),
    previous: structuredClone(session.active ? session.selector : session.previous),
  };
}

export function activateSelection(session: SelectionSession, selector: Selector, explicitAll = false): SelectionSession {
  if (!explicitAll && selector.mode !== 'expression' && !selector.conditions.length) return leaveSelection(session);
  return { ...session, selector: withKeys(selector), active: true, direct: false, pendingChanges: [] };
}

/** Direct clicks replace the range; Ctrl/Meta toggles in the same live ID set. */
export function selectParagraph(session: SelectionSession, id: string, toggle: boolean): SelectionSession {
  if (!session.active || session.direct) {
    const ids = session.direct ? [...(session.selector.conditions[0]?.ids || [])] : [];
    const next = toggle ? (ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]) : [id];
    return { ...session, active: true, direct: true, pendingChanges: [],
      selector: next.length ? { mode: 'all', conditions: [rangeCondition(next, 'A')] } : { mode: 'any', conditions: [] } };
  }
  if (!toggle) return session;
  return pointIntent(session, id, false);
}

export function finishPointAdjustment(session: SelectionSession, result: {
  selector: Selector;
}): SelectionSession {
  return { ...session, selector: withKeys(result.selector), active: true, direct: false, pendingChanges: [] };
}

export function pointIntent(session: SelectionSession, id: string, selected: boolean): SelectionSession {
  if (session.direct) return session;
  const existing = session.pendingChanges.findIndex(change => change.id === id);
  const pendingChanges = existing < 0
    ? [...session.pendingChanges, { id, selected }]
    : session.pendingChanges.map((change, index) => index === existing ? { ...change, selected } : change);
  return { ...session, pendingChanges };
}

export function parseParagraphIds(value: string, available: Set<string>): { ids?: string[]; error?: string } {
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { error: '请至少输入一个段落编号。' };
  const numbers = new Set<string>();
  for (const token of tokens) {
    if (!/^\d+$/.test(token)) return { error: '段落编号只能包含数字，并以空格分隔。' };
    const number = token.replace(/^0+/, '');
    if (!number || !available.has(`p${number}`)) return { error: `文档中没有可操作的第 ${token} 段。` };
    numbers.add(number);
  }
  return { ids: [...numbers].map(number => `p${number}`) };
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
