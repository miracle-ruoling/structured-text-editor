import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { LatestPreview } from './latestPreview';
import { finishPointAdjustment } from './selection';
import type { SelectionSession } from './selection';
import { selectionKey, selectionView } from './selectionView';
import type { SelectionFrame } from './selectionView';
import type { DocumentView, Selector } from './types';
import { selectorComplete } from './workspace';

type Request = { doc: DocumentView; session: SelectionSession; scope: string; key: string };
type Result = { selector: Selector; ids: string[]; revision: number };

export function useSelection(doc: DocumentView | null, session: SelectionSession, blocked: boolean,
  accept: (expected: SelectionSession, next: SelectionSession) => void) {
  const [frame, setFrame] = useState<SelectionFrame | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: Error } | null>(null);
  const [retryIndex, setRetryIndex] = useState(0);
  const queue = useRef<LatestPreview<Request, Result> | null>(null);
  const scope = JSON.stringify([doc?.id, doc?.revision]);
  const request = useMemo<Request | null>(() => doc && session.active && selectorComplete(session.selector) && !blocked
    ? { doc, session, scope, key: selectionKey(scope, session) } : null, [doc, session, scope, blocked]);
  const latest = useRef({ request, accept });
  latest.current = { request, accept };

  useEffect(() => {
    const scheduler = new LatestPreview<Request, Result>(async input => {
      const { doc, session } = input;
      const result = session.pendingChanges.length
        ? await api.adjustSelection(doc, session.selector, session.pendingChanges)
        : { ...await api.select(doc.id, session.selector), selector: session.selector };
      if (result.revision !== doc.revision) throw new ApiError('文档版本已更新，请同步后重试。', 409);
      return result;
    }, (input, output) => {
      // Also guard the render-to-effect interval, before the scheduler sees new work.
      if (latest.current.request?.key !== input.key) return;
      const next = input.session.pendingChanges.length ? finishPointAdjustment(input.session, output) : input.session;
      setFrame({ scope: input.scope, selector: next.selector, ids: output.ids });
      setFailure(null);
      if (next !== input.session) latest.current.accept(input.session, next);
    }, (input, error) => {
      if (latest.current.request?.key === input.key) setFailure({ key: input.key,
        error: error instanceof Error ? error : new Error('范围更新失败，请重试。') });
    }, 70);
    queue.current = scheduler;
    return () => { scheduler.dispose(); queue.current = null; };
  }, []);

  useEffect(() => {
    const accepted = request && frame?.scope === scope && !session.pendingChanges.length &&
      JSON.stringify(frame.selector) === JSON.stringify(session.selector);
    queue.current?.schedule(accepted ? null : request);
  }, [request, frame, scope, session, retryIndex]);

  const error = failure && failure.key === request?.key ? failure.error : null;
  const view = selectionView(scope, session, frame, blocked, !!error);
  return { ...view, error: error?.message || null, conflict: error instanceof ApiError && error.status === 409,
    retry: () => { setFailure(null); setRetryIndex(i => i + 1); } };
}
