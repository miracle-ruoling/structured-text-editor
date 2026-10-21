import type { Format, Selector } from './types.ts';

export function selectorComplete(selector: Selector): boolean {
  return (selector.mode !== 'expression' || !!selector.expression?.trim()) &&
    selector.conditions.every(c => c.field === 'ids' ? !!c.ids?.length : c.value.trim().length > 0);
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
