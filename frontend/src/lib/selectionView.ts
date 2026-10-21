import type { SelectionSession } from './selection.ts';
import type { Selector } from './types.ts';
import { selectorComplete } from './workspace.ts';

export type SelectionFrame = { scope: string; selector: Selector; ids: string[] };
export function selectionKey(scope: string, session: SelectionSession): string {
  return JSON.stringify([scope, session.active, session.selector, session.pendingChanges]);
}

/** Retaining highlights is visual only: only an exact, accepted scope enables mutations. */
export function selectionView(scope: string, session: SelectionSession, frame: SelectionFrame | null, blocked = false, failed = false) {
  const complete = session.active && selectorComplete(session.selector);
  const sameScope = frame?.scope === scope;
  const sameBase = sameScope && JSON.stringify(frame.selector) === JSON.stringify(session.selector);
  const ready = complete && !blocked && !failed && sameBase && !session.pendingChanges.length;
  let ids = complete && sameScope ? frame.ids : [];
  if (failed && !sameBase) ids = [];
  if (complete && !failed && !blocked) {
    if (session.direct) ids = session.selector.conditions[0]?.ids || [];
    else if (sameBase && session.pendingChanges.length) {
      const optimistic = new Set(ids);
      for (const change of session.pendingChanges) {
        if (change.selected) optimistic.add(change.id); else optimistic.delete(change.id);
      }
      ids = [...optimistic];
    }
  }
  return { ids, ready, canToggle: complete && !blocked && (session.direct || sameBase),
    matching: complete && !blocked && !failed && !ready };
}
