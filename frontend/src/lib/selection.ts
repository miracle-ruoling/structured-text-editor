import type { Condition, Selector } from './types.ts';

export type SelectionSession = {
  selector: Selector; active: boolean; previous: Selector | null;
  direct: boolean; gestureKey: string | null;
};

export function emptySelectionSession(): SelectionSession {
  return { selector: { mode: 'all', conditions: [] }, active: false, previous: null, direct: false, gestureKey: null };
}

export function leaveSelection(session: SelectionSession): SelectionSession {
  return {
    ...emptySelectionSession(),
    previous: structuredClone(session.active ? session.selector : session.previous),
  };
}

export function activateSelection(session: SelectionSession, selector: Selector, explicitAll = false): SelectionSession {
  if (!explicitAll && selector.mode !== 'expression' && !selector.conditions.length) return leaveSelection(session);
  return { ...session, selector: withKeys(selector), active: true, direct: false, gestureKey: null };
}

export function endPointerGesture(session: SelectionSession): SelectionSession {
  return session.gestureKey === null ? session : { ...session, gestureKey: null };
}

/** Direct selection keeps one ID group; explicit filters keep each Ctrl gesture separate. */
export function selectParagraph(session: SelectionSession, id: string, extend: boolean): SelectionSession {
  if (!session.active || session.direct) {
    const ids = extend && session.active ? session.selector.conditions[0].ids || [] : [];
    return { ...session, active: true, direct: true, gestureKey: null,
      selector: { mode: 'all', conditions: [rangeCondition([...ids, id], 'A')] } };
  }
  if (!extend) return endPointerGesture(session);
  const base = session.selector;
  const existing = base.conditions.find(c => c.key === session.gestureKey && c.field === 'ids' && c.op === 'is');
  if (existing) {
    if (existing.ids?.includes(id)) return session;
    return { ...session, selector: { ...base, conditions: base.conditions.map(c => c === existing ? rangeCondition([...(c.ids || []), id], c.key) : c) } };
  }
  if (base.conditions.length >= 30) throw new Error('最多 30 个条件，请先删除不需要的条件再添加。');
  const condition = rangeCondition([id], nextKey(base));
  return { ...session, gestureKey: condition.key!, selector: { ...base, conditions: [...base.conditions, condition],
    // Leave an invalid empty expression invalid rather than silently discarding its conditions.
    expression: base.mode === 'expression' ? (base.expression?.trim() ? `(${base.expression}) AND $${condition.key}` : base.expression) : '',
  } };
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
