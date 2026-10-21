import type { Block } from './types.ts';

export const flagKeys = ['bold', 'italic', 'page_break_before', 'keep_next', 'keep_lines', 'widow_control'] as const;
export type FlagKey = typeof flagKeys[number];
export type FlagState = boolean | 'mixed' | 'unknown';
export type FlagStates = Partial<Record<FlagKey, FlagState>>;

/** Read current saved values without turning them into an operation patch. */
export function currentFlags(blocks: Block[]): FlagStates {
  if (!blocks.length) return {};
  return Object.fromEntries(flagKeys.map(key => {
    const values = new Set(blocks.flatMap(block =>
      (key === 'bold' || key === 'italic') && block.runs.length
        ? block.runs.map(run => run.format[key] ?? null)
        : [block.format[key] ?? null]));
    const mixed = blocks.some(block => block.mixed.includes(key)) || values.size > 1;
    return [key, mixed ? 'mixed' : values.has(null) ? 'unknown' : [...values][0]];
  }));
}

export function flagStateLabel(state?: FlagState): string {
  return state === true ? '开启 · 当前' : state === false ? '关闭 · 当前'
    : state === 'mixed' ? '混合 · 保持各自' : state === 'unknown' ? '未解析 · 保持原样' : '不设置';
}
