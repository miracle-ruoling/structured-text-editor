export const roles = {
  body: '正文', title: '文档标题', heading: '小标题', caption: '图表题注',
  quote: '引用', code: '代码', list: '列表', reference: '参考文献', unclassified: '未分类',
} as const;
export type Role = keyof typeof roles;
export type Format = {
  font_east_asia?: string | null; font_latin?: string | null; size_pt?: number | null;
  first_line_chars?: number | null; first_line_pt?: number; line_spacing?: number | null;
  line_spacing_pt?: number; line_spacing_rule?: string; space_before_pt?: number | null; space_after_pt?: number | null;
  alignment?: string | null; bold?: boolean | null; italic?: boolean | null; color?: string | null;
  left_indent_chars?: number; right_indent_chars?: number; left_indent_pt?: number; right_indent_pt?: number;
  keep_next?: boolean | null; keep_lines?: boolean | null; page_break_before?: boolean | null; widow_control?: boolean | null;
};
export type FormatPatch = Pick<Format, 'font_east_asia' | 'font_latin' | 'size_pt' | 'first_line_chars' | 'line_spacing' | 'space_before_pt' | 'space_after_pt' | 'alignment' | 'bold' | 'italic' | 'keep_next' | 'keep_lines' | 'page_break_before' | 'widow_control'>;
export type SizeChange = { mode: 'points' | 'chinese_steps'; amount: number };
export type Chapter = { id: string; name: string; level: number; count: number };
export type Section = { id: string; name: string; count: number; break_type: string; width_pt: number | null; height_pt: number | null };
export type Block = {
  id: string; kind: 'paragraph'; text: string; role: Role; tags: string[]; in_table: boolean;
  editable: boolean; confirmed: boolean; style_id: string; style_name: string; role_source: string;
  format: Format; format_sources: Record<string, string>; mixed: string[]; features: string[];
  overrides: FormatPatch; runs: { index?: number; text: string; format: Format }[];
  format_trace: Record<string, FormatLayer[]>;
  paragraph_size_pt?: number | null; outline_level?: number | null; chapter_ids?: string[]; section_id?: string;
  numbering?: { num_id: string; level: number; format: string | null; text: string | null; start: string; resolved: boolean } | null;
};
export type Layout = { kind: 'paragraph'; id: string } | { kind: 'table'; rows: { span: number; children: Layout[] }[][] } | { kind: 'unsupported'; label: string; children: Layout[] };
export type DocumentView = {
  id: string; name: string; revision: number; updated_at: string;
  blocks: Block[]; layout: Layout[]; warnings: string[]; undo_label: string | null; redo_label: string | null;
  saved_selectors: SavedSelector[];
  rules: RuleView[];
  chapters: Chapter[]; sections: Section[];
};
export type RecentProject = { id: string; name: string; updated_at: string; revision: number };
export type Condition = { key?: string; field: 'role' | 'tag' | 'context' | 'text' | 'ids' | 'chapter' | 'section'; op: 'is' | 'is_not' | 'contains' | 'not_contains'; value: string; ids?: string[] };
export type Selector = { mode: 'all' | 'any' | 'expression'; conditions: Condition[]; expression?: string };
export type SavedSelector = { id: string; name: string; selector: Selector };
export type AnnotationPatch = { role?: Role; tags?: string[]; reset_role?: boolean };
export type PreviewBlock = Pick<Block, 'id' | 'format' | 'runs' | 'mixed'>;
export type Preview = { revision: number; ids: string[]; changes: { id: string; text: string; before: Format; after: Format; size_before?: (number | null)[]; size_after?: (number | null)[] }[]; after_blocks?: PreviewBlock[]; warnings?: string[] };
export type FormatLayer = { kind: 'source' | 'rule' | 'local'; key: string; label: string; value: unknown; mixed?: boolean; rule_id?: string };
export type FormatRule = SavedSelector & { patch: FormatPatch; enabled: boolean };
export type RuleView = FormatRule & { matched_count: number; effective_count: number; scope_warning?: string | null };
export type RuleAction = { action: 'save'; rule: FormatRule } | { action: 'delete'; id: string } | { action: 'toggle'; id: string; enabled: boolean } | { action: 'move'; id: string; position: number };
export type RulePreview = Preview & { label: string; rules: RuleView[]; request: RuleAction };
export type BulkAnnotation = { action: 'add_tag' | 'remove_tag'; tag: string } | { action: 'set_role'; role: Role } | { action: 'reset_role' };
export type ExportReport = { revision: number; project_id: string; name: string; source_sha256: string; output_sha256: string; verified: boolean;
  text_preserved: boolean; unselected_preserved: boolean; changed_parts: string[]; preserved_parts: number;
  paragraph_count: number; planned_paragraph_count: number; enabled_rules: number; warnings: string[]; limits: string[];
  changed_paragraphs: { id: string; text: string; properties: { key: string; before: unknown; after: unknown }[]; size_before: (number | null)[]; size_after: (number | null)[] }[];
};

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
  keep_next: '与下段同页', keep_lines: '段中不分页', page_break_before: '段前分页', widow_control: '孤行控制', line_spacing_rule: '行距类型',
};
export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '继承 / 混合 / 未解析';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (key === 'alignment') return ({ left: '左对齐', center: '居中', right: '右对齐', both: '两端对齐' } as Record<string, string>)[String(value)] || String(value);
  if (key === 'line_spacing_rule') return ({ exact: '固定值', atLeast: '最小值' } as Record<string, string>)[String(value)] || String(value);
  if (key.endsWith('_chars')) return `${value} 字符`;
  if (key === 'line_spacing') return `${value} 倍`;
  if (key.endsWith('_pt')) return `${value} 磅`;
  return String(value);
}

export function sizeValues(values?: (number | null)[]): string {
  return values?.length ? values.map(v => v === null ? '未解析' : `${v} 磅`).join(' / ') : '未解析';
}
