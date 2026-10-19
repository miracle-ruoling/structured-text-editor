export const roles = {
  body: '正文', title: '文档标题', heading: '小标题', caption: '图表题注',
  quote: '引用', code: '代码', list: '列表', reference: '参考文献', unclassified: '未分类',
} as const;
export type Role = keyof typeof roles;
export type Format = {
  font_east_asia?: string | null; font_latin?: string | null; size_pt?: number | null;
  first_line_chars?: number | null; first_line_pt?: number; line_spacing?: number | null;
  line_spacing_pt?: number; space_before_pt?: number | null; space_after_pt?: number | null;
  alignment?: string | null; bold?: boolean | null; italic?: boolean | null; color?: string | null;
  left_indent_chars?: number; right_indent_chars?: number; left_indent_pt?: number; right_indent_pt?: number;
};
export type FormatPatch = Pick<Format, 'font_east_asia' | 'font_latin' | 'size_pt' | 'first_line_chars' | 'line_spacing' | 'space_before_pt' | 'space_after_pt' | 'alignment'>;
export type Block = {
  id: string; kind: 'paragraph'; text: string; role: Role; tags: string[]; in_table: boolean;
  editable: boolean; confirmed: boolean; style_id: string; style_name: string; role_source: string;
  format: Format; format_sources: Record<string, string>; mixed: string[]; features: string[];
  overrides: FormatPatch; runs: { text: string; format: Format }[];
};
export type Layout = { kind: 'paragraph'; id: string } | { kind: 'table'; rows: { span: number; children: Layout[] }[][] } | { kind: 'unsupported'; label: string; children: Layout[] };
export type DocumentView = {
  id: string; name: string; revision: number; updated_at: string;
  blocks: Block[]; layout: Layout[]; warnings: string[]; undo_label: string | null; redo_label: string | null;
};
export type RecentProject = { id: string; name: string; updated_at: string; revision: number };
export type Condition = { field: 'role' | 'tag' | 'context' | 'text'; op: 'is' | 'is_not' | 'contains' | 'not_contains'; value: string };
export type Selector = { mode: 'all' | 'any'; conditions: Condition[] };
export type Preview = { revision: number; ids: string[]; changes: { id: string; text: string; before: Format; after: FormatPatch }[] };

export const bodySelector: Selector = { mode: 'all', conditions: [
  { field: 'role', op: 'is', value: 'body' },
  { field: 'context', op: 'is_not', value: 'table' },
  { field: 'tag', op: 'is_not', value: '保留原格式' },
] };

export const formatLabels: Record<string, string> = {
  font_east_asia: '中文字体', font_latin: '西文字体', size_pt: '字号', first_line_chars: '首行缩进',
  first_line_pt: '首行缩进', line_spacing: '行距', line_spacing_pt: '行距',
  space_before_pt: '段前间距', space_after_pt: '段后间距', alignment: '对齐', bold: '粗体', italic: '斜体', color: '颜色',
  left_indent_chars: '左缩进', right_indent_chars: '右缩进', left_indent_pt: '左缩进', right_indent_pt: '右缩进',
};
export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '继承 / 混合 / 未解析';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (key === 'alignment') return ({ left: '左对齐', center: '居中', right: '右对齐', both: '两端对齐' } as Record<string, string>)[String(value)] || String(value);
  if (key.endsWith('_chars')) return `${value} 字符`;
  if (key === 'line_spacing') return `${value} 倍`;
  if (key.endsWith('_pt')) return `${value} 磅`;
  return String(value);
}
