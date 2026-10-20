import type { Format, FormatPatch, Selector, SizeChange } from './types.ts';

export type FormatTab = 'paragraph' | 'font';
const fontKeys = new Set(['font_east_asia', 'font_latin', 'size_pt', 'bold', 'italic']);

export function scopedSizeChange(change: SizeChange | null, tab: FormatTab, includeOther: boolean) {
  return tab === 'font' || includeOther ? change : null;
}

export function validSizeChange(change: SizeChange | null) {
  return !change || (Number.isFinite(change.amount) && change.amount !== 0 && Math.abs(change.amount) <= (change.mode === 'chinese_steps' ? 15 : 100) &&
    (change.mode === 'chinese_steps' ? Number.isInteger(change.amount) : Number.isInteger(change.amount * 2)));
}

export function selectorComplete(selector: Selector): boolean {
  return (selector.mode !== 'expression' || !!selector.expression?.trim()) &&
    selector.conditions.every(c => c.field === 'ids' ? !!c.ids?.length : c.value.trim().length > 0);
}

export function scopedPatch(patch: FormatPatch, tab: FormatTab, includeOther: boolean): FormatPatch {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => includeOther || fontKeys.has(key) === (tab === 'font')));
}

export function afterApply(patch: FormatPatch, locked: boolean): FormatPatch {
  return locked ? { ...patch } : {};
}

export function afterSizeApply(change: SizeChange | null, locked: boolean): SizeChange | null {
  return locked && change ? { ...change } : null;
}

// Screen-only geometry. Preserve source values in the model and export;
// reserve enough room for hanging text and cap indentation on narrow screens.
export function paragraphInsets(format: Format) {
  const em = (format.size_pt || 12) * 4 / 3;
  const first = format.first_line_chars != null ? format.first_line_chars * em : (format.first_line_pt || 0) * 4 / 3;
  const left = format.left_indent_chars != null ? format.left_indent_chars * em : (format.left_indent_pt || 0) * 4 / 3;
  const right = format.right_indent_chars != null ? format.right_indent_chars * em : (format.right_indent_pt || 0) * 4 / 3;
  return {
    paddingLeft: `min(${Math.max(0, left, -first)}px, 35%)`,
    paddingRight: `min(${Math.max(0, right)}px, 25%)`,
    textIndent: first < 0 ? `max(${first}px, -35%)` : `min(${first}px, 50%)`,
  };
}
