import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentView, FormatTemplate, Selector, TemplatePreview } from './types';
import { api, ApiError } from './api';
import { LatestPreview } from './latestPreview';
import { templateError, templatePreviewKey, templatePreviewState } from './templates';

type Request = { doc: DocumentView; template: FormatTemplate; selector: Selector | null; key: string; context: string };
export type LiveTemplatePreview = TemplatePreview & { request: Request };

export function useTemplatePreview(doc: DocumentView | null, template: FormatTemplate | null, selector: Selector | null, enabled: boolean) {
  const [result, setResult] = useState<LiveTemplatePreview | null>(null);
  const [failure, setFailure] = useState<{ key: string; error: Error } | null>(null);
  const [retry, setRetry] = useState(0);
  const queue = useRef<LatestPreview<Request, TemplatePreview> | null>(null);
  const request = useMemo<Request | null>(() => doc && template ? {
    doc, template, selector, ...templatePreviewKey(doc.id, doc.revision, template, selector),
  } : null, [doc, template, selector]);
  const validation = template ? templateError(template) : null;
  useEffect(() => {
    const scheduler = new LatestPreview<Request, TemplatePreview>(
      (input, signal) => api.previewTemplate(input.doc, input.template, input.selector, signal),
      (input, output) => { setResult({ ...output, request: input }); setFailure(null); },
      (input, error) => setFailure({ key: input.key, error: error instanceof Error ? error : new Error('模板预览失败') }),
    );
    queue.current = scheduler;
    return () => { scheduler.dispose(); queue.current = null; };
  }, []);
  useEffect(() => {
    setFailure(null);
    queue.current?.schedule(enabled && !validation ? request : null);
    if (!enabled || !request) setResult(null);
  }, [request, enabled, validation, retry]);
  const currentFailure = failure?.key === request?.key ? failure?.error : null;
  const error = validation || currentFailure?.message || null;
  return { ...templatePreviewState(result, request, doc?.revision, enabled, error), error,
    conflict: currentFailure instanceof ApiError && currentFailure.status === 409,
    retry: () => setRetry(i => i + 1) };
}
