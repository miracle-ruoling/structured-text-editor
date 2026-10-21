import type { FormatPatch, SizeChange } from './types.ts';

export type FormatDraft = { patch: FormatPatch; sizeChange: SizeChange | null };
export const emptyFormatDraft = (): FormatDraft => ({ patch: {}, sizeChange: null });
export const chineseSizes = [5, 5.5, 6.5, 7.5, 9, 10.5, 12, 14, 15, 16, 18, 22, 24, 26, 36, 42];
const fontKeys = new Set(['font_east_asia', 'font_latin', 'size_pt', 'bold', 'italic']);

export function fieldCount(patch: FormatPatch, group: 'font' | 'paragraph') {
  return Object.keys(patch).filter(key => fontKeys.has(key) === (group === 'font')).length;
}

export function inputSize(draft: FormatDraft, value: string): FormatDraft {
  const patch = { ...draft.patch };
  if (value === '') delete patch.size_pt;
  else patch.size_pt = Number(value);
  return { patch, sizeChange: null };
}

export function stepSize(draft: FormatDraft, direction: 1 | -1): FormatDraft | null {
  if (draft.patch.size_pt != null) {
    const size = draft.patch.size_pt;
    const next = direction === 1 ? chineseSizes.find(v => v > size) : [...chineseSizes].reverse().find(v => v < size);
    return next == null ? null : { patch: { ...draft.patch, size_pt: next }, sizeChange: null };
  }
  const amount = (draft.sizeChange?.amount || 0) + direction;
  if (Math.abs(amount) > 15) return null;
  return { patch: { ...draft.patch }, sizeChange: amount ? { mode: 'chinese_steps', amount } : null };
}

export function formatDraftError(draft: FormatDraft): string | null {
  const limits: Record<string, [number, number, number, string]> = {
    size_pt: [1, 200, 0.5, '字号'], first_line_chars: [0, 20, 0.01, '首行缩进'],
    line_spacing: [0.5, 5, 0.05, '行距'], space_before_pt: [0, 200, 0.05, '段前间距'], space_after_pt: [0, 200, 0.05, '段后间距'],
  };
  for (const [key, value] of Object.entries(draft.patch)) {
    if (typeof value === 'number' && limits[key]) {
      const [min, max, step, name] = limits[key];
      if (!Number.isFinite(value) || value < min || value > max || Math.abs(value / step - Math.round(value / step)) > 1e-6) return `${name}需在 ${min}–${max} 内，步进 ${step}。`;
    }
  }
  return null;
}

export function requestKey(id: string, revision: number, selector: unknown, draft: FormatDraft) {
  return JSON.stringify({ id, revision, selector, ...draft });
}
