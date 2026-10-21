import type { AnnotationPatch, BulkAnnotation, DocumentView, ExportReport, FormatPatch, Preview, RecentProject, RuleAction, RulePreview, Selector, SizeChange } from './types';
import type { FormatTemplate, TemplateLibrary, TemplatePreview, ExtractionGroup } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function request<T>(path: string, body?: unknown, form?: FormData, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      signal,
      method: body !== undefined || form ? 'POST' : 'GET',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (error) { if (signal?.aborted) throw error; throw new ApiError('暂时无法连接本机服务，请检查启动窗口是否仍在运行。', 0); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new ApiError(result.detail || `请求失败（${response.status}）`, response.status);
  }
  return response.json();
}

export const api = {
  templates: () => request<TemplateLibrary>('/templates'),
  saveTemplate: (revision: number, template: FormatTemplate, id?: string) => request<TemplateLibrary>('/templates/save', { revision, template, id }),
  deleteTemplate: (revision: number, id: string, restore = false) => request<TemplateLibrary>(`/templates/${restore ? 'restore' : 'delete'}`, { revision, id }),
  importTemplate: (revision: number, file: File) => { const form = new FormData(); form.append('file', file); return request<TemplateLibrary>(`/templates/import?revision=${revision}`, undefined, form); },
  extractTemplate: (doc: DocumentView) => request<{ revision: number; groups: ExtractionGroup[] }>(`/projects/${doc.id}/templates/extract`, { revision: doc.revision }),
  previewTemplate: (doc: DocumentView, template: FormatTemplate, selector: Selector | null, signal?: AbortSignal) => request<TemplatePreview>(`/projects/${doc.id}/templates/preview`, { revision: doc.revision, template, selector }, undefined, signal),
  applyTemplate: (doc: DocumentView, template: FormatTemplate, selector: Selector | null) => request<DocumentView>(`/projects/${doc.id}/templates/apply`, { revision: doc.revision, template, selector }),
  recent: () => request<RecentProject[]>('/projects'),
  demo: () => request<DocumentView>('/projects/demo', {}),
  get: (id: string) => request<DocumentView>(`/projects/${id}`),
  import: (file: File) => { const form = new FormData(); form.append('file', file); return request<DocumentView>('/projects/import', undefined, form); },
  select: (id: string, selector: Selector) => request<{ ids: string[]; revision: number }>(`/projects/${id}/select`, selector),
  adjustSelection: (doc: DocumentView, selector: Selector, changes: { id: string; selected: boolean }[]) => request<{ ids: string[]; revision: number; selector: Selector }>(`/projects/${doc.id}/selection-adjust`, { revision: doc.revision, selector, changes }),
  preview: (doc: DocumentView, selector: Selector, patch: FormatPatch, size_change: SizeChange | null = null, signal?: AbortSignal) => request<Preview>(`/projects/${doc.id}/preview?compact=true`, { revision: doc.revision, selector, patch, size_change }, undefined, signal),
  apply: (doc: DocumentView, selector: Selector, patch: FormatPatch, size_change: SizeChange | null = null) => request<DocumentView>(`/projects/${doc.id}/apply`, { revision: doc.revision, selector, patch, size_change }),
  report: (doc: DocumentView) => request<ExportReport>(`/projects/${doc.id}/export/report`),
  annotate: (doc: DocumentView, id: string, patch: AnnotationPatch) => request<DocumentView>(`/projects/${doc.id}/annotate`, { revision: doc.revision, ids: [id], ...patch }),
  saveSelector: (doc: DocumentView, name: string, selector: Selector) => request<DocumentView>(`/projects/${doc.id}/selections/save`, { revision: doc.revision, name, selector }),
  deleteSelector: (doc: DocumentView, id: string) => request<DocumentView>(`/projects/${doc.id}/selections/delete`, { revision: doc.revision, id }),
  history: (doc: DocumentView, direction: 'undo' | 'redo') => request<DocumentView>(`/projects/${doc.id}/${direction}`, { revision: doc.revision }),
  previewRule: (doc: DocumentView, action: RuleAction) => request<Omit<RulePreview, 'request'>>(`/projects/${doc.id}/rules/preview`, { revision: doc.revision, ...action }),
  applyRule: (doc: DocumentView, action: RuleAction) => request<DocumentView>(`/projects/${doc.id}/rules/apply`, { revision: doc.revision, ...action }),
  clearOverrides: (doc: DocumentView, id: string, keys: string[]) => request<DocumentView>(`/projects/${doc.id}/overrides/clear`, { revision: doc.revision, ids: [id], keys }),
  bulkAnnotate: (doc: DocumentView, selector: Selector, action: BulkAnnotation) => request<DocumentView>(`/projects/${doc.id}/annotations/bulk`, { revision: doc.revision, selector, ...action }),
  download: async (doc: DocumentView, kind: 'docx' | 'project') => {
    const response = await fetch(`/api/projects/${doc.id}/export/${kind}`);
    if (!response.ok) { const data = await response.json(); throw new Error(data.detail || '导出失败'); }
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = doc.name.replace(/\.docx$/i, '') + (kind === 'docx' ? '_文序.docx' : '.sdoc');
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  },
};
