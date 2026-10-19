import type { DocumentView, FormatPatch, Preview, RecentProject, Role, Selector } from './types';

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, body?: unknown, form?: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: body !== undefined || form ? 'POST' : 'GET',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch { throw new ApiError('暂时无法连接本机服务，请检查启动窗口是否仍在运行。', 0); }
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new ApiError(result.detail || `请求失败（${response.status}）`, response.status);
  }
  return response.json();
}

export const api = {
  recent: () => request<RecentProject[]>('/projects'),
  demo: () => request<DocumentView>('/projects/demo', {}),
  get: (id: string) => request<DocumentView>(`/projects/${id}`),
  import: (file: File) => { const form = new FormData(); form.append('file', file); return request<DocumentView>('/projects/import', undefined, form); },
  select: (id: string, selector: Selector) => request<{ ids: string[]; revision: number }>(`/projects/${id}/select`, selector),
  preview: (doc: DocumentView, selector: Selector, patch: FormatPatch) => request<Preview>(`/projects/${doc.id}/preview`, { revision: doc.revision, selector, patch }),
  apply: (doc: DocumentView, selector: Selector, patch: FormatPatch) => request<DocumentView>(`/projects/${doc.id}/apply`, { revision: doc.revision, selector, patch }),
  annotate: (doc: DocumentView, id: string, role: Role, tags: string[]) => request<DocumentView>(`/projects/${doc.id}/annotate`, { revision: doc.revision, ids: [id], role, tags }),
  history: (doc: DocumentView, direction: 'undo' | 'redo') => request<DocumentView>(`/projects/${doc.id}/${direction}`, { revision: doc.revision }),
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
