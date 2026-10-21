import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import type { DocumentView, Preview, Selector } from './types';
import type { FormatDraft } from './formatDraft';
import { formatDraftError, requestKey } from './formatDraft';
import { LatestPreview } from './latestPreview';

type Request = { doc: DocumentView; selector: Selector; draft: FormatDraft; key: string; context: string };
export type FormatPreview = Preview & { request: Request };

export function useFormatPreview(doc: DocumentView | null, selector: Selector, draft: FormatDraft, enabled: boolean) {
  const [result, setResult] = useState<FormatPreview | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: Error } | null>(null);
  const [retryIndex, setRetryIndex] = useState(0);
  const queue = useRef<LatestPreview<Request, Preview> | null>(null);
  const dirty = Object.keys(draft.patch).length > 0 || draft.sizeChange !== null;
  const validation = formatDraftError(draft);
  const request = useMemo<Request | null>(() => doc ? {
    doc, selector, draft,
    key: requestKey(doc.id, doc.revision, selector, draft),
    context: JSON.stringify([doc.id, doc.revision, selector]),
  } : null, [doc, selector, draft]);

  useEffect(() => {
    const scheduler = new LatestPreview<Request, Preview>(
      (input, signal) => api.preview(input.doc, input.selector, input.draft.patch, input.draft.sizeChange, signal),
      (input, output) => { setResult({ ...output, request: input }); setFailure(null); },
      (input, error) => setFailure({ key: input.key, error: error instanceof Error ? error : new Error('预览失败') }),
    );
    queue.current = scheduler;
    return () => { scheduler.dispose(); queue.current = null; };
  }, []);

  useEffect(() => {
    setFailure(null);
    queue.current?.schedule(enabled && dirty && !validation ? request : null);
    if (!enabled || !dirty) setResult(null);
  }, [request, enabled, dirty, validation, retryIndex]);

  const active = enabled && dirty && request != null;
  const currentFailure = failure?.key === request?.key ? failure?.error : null;
  const error = dirty ? validation || currentFailure?.message || null : null;
  const ready = !!(active && !error && result?.request.key === request.key && result.revision === doc?.revision);
  // Retain a previous frame only within exactly the same saved version and scope.
  const displayed = active && result?.request.context === request.context ? result : null;
  return { preview: displayed, ready, pending: active && !ready && !error, error,
    conflict: currentFailure instanceof ApiError && currentFailure.status === 409,
    retry: () => setRetryIndex(i => i + 1) };
}
