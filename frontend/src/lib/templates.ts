import type { ExtractionGroup, FormatTemplate, Selector, StoredTemplate, TemplatePreview } from './types.ts';
import { formatDraftError } from './formatDraft.ts';

export type TemplateDraft = { id?: string; template: FormatTemplate };
export type Extraction = { revision: number; groups: ExtractionGroup[]; choices: Record<string, number | null> };
export const emptyTemplate = (): TemplateDraft => ({ template: { version: 1, name: '', entries: [] } });
export function templateDraft(value: StoredTemplate): TemplateDraft {
  return { id: value.id, template: structuredClone({ version: value.version, name: value.name, entries: value.entries }) };
}
export function templateDirty(draft: TemplateDraft | null, items: StoredTemplate[]): boolean {
  if (!draft) return false;
  const saved = items.find(item => item.id === draft.id);
  return saved ? JSON.stringify(templateDraft(saved).template) !== JSON.stringify(draft.template)
    : !!(draft.template.name.trim() || draft.template.entries.length);
}
export function templateError(value: FormatTemplate): string | null {
  if (!value.name.trim()) return '请填写模板名称';
  if (!value.entries.length) return '请添加至少一个类别';
  for (const entry of value.entries) {
    if (!Object.keys(entry.patch).length) return '每个类别至少需要一项格式，不需要的类别可移除';
    const error = formatDraftError({ patch: entry.patch, sizeChange: null });
    if (error) return error;
  }
  return null;
}
export function extractedEntries(extraction: Extraction) {
  if (extraction.groups.some(group => extraction.choices[group.role] == null)) return null;
  return extraction.groups.flatMap(group => {
    const index = extraction.choices[group.role]!;
    const candidate = group.candidates[index];
    return index >= 0 && candidate && Object.keys(candidate.patch).length ? [{ role: group.role, patch: structuredClone(candidate.patch) }] : [];
  });
}

export function templatePreviewKey(id: string, revision: number, template: FormatTemplate, selector: Selector | null) {
  return { key: JSON.stringify([id, revision, template, selector]), context: JSON.stringify([id, revision, selector]) };
}

export function templatePreviewState<T extends TemplatePreview & { request: { key: string; context: string } }>(
  result: T | null, request: { key: string; context: string } | null, revision: number | undefined,
  enabled: boolean, error: string | null,
) {
  const active = enabled && request != null;
  const ready = !!(active && !error && result?.request.key === request.key && result.revision === revision);
  return { preview: active && result?.request.context === request.context ? result : null,
    ready, pending: active && !ready && !error };
}
