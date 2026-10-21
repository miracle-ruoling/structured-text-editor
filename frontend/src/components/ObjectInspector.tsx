import { Fingerprint } from 'lucide-react';
import type { Block, Chapter, Section } from '../lib/types';
import { roles } from '../lib/types';
import { FormatSources } from './FormatSources';

type Props = { block: Block | null; busy: boolean; onFormat: (id: string) => void; onClearOverrides: (id: string, keys: string[]) => void; chapters?: Chapter[]; sections?: Section[] };
export function ObjectInspector({ block, busy, onFormat, onClearOverrides, chapters, sections }: Props) {
  if (!block) return <div className="inspector-empty"><Fingerprint size={36} /><h3>查看一个对象</h3><p>右键点击段落并选择「检查对象」，查看类别、标签和格式来源。</p></div>;
  return <ObjectForm key={block.id} block={block} busy={busy} onFormat={onFormat} onClearOverrides={onClearOverrides} chapters={chapters} sections={sections} />;
}

function ObjectForm({ block, busy, onFormat, onClearOverrides, chapters = [], sections = [] }: Omit<Props, 'block'> & { block: Block }) {
  const { role, tags } = block;
  return <div className="object-inspector">
    <div className="object-identity"><span><Fingerprint size={16} />段落 {block.id.toUpperCase()}</span><span>{block.in_table ? '表格内' : '表格外'}</span></div>
    <div className="object-excerpt">{block.text || '空段落 / 非文字内容'}</div>
    {!block.editable && <p className="locked-message">此段落处于复杂结构中，本阶段仅供查看。</p>}
    <div className="source-section"><dl>
      <div><dt>主要类别</dt><dd>{roles[role]}</dd></div>
      <div><dt>自由标签</dt><dd>{tags.length ? tags.join(' · ') : '无'}</dd></div>
      <div><dt>类别来源</dt><dd title={block.role_source}>{block.confirmed ? '手动设置' : '自动识别'}</dd></div>
    </dl></div>
    <button className="secondary full object-format-button" disabled={busy || !block.editable} onClick={() => onFormat(block.id)}>仅调整此段的格式</button>
    <div className="source-section"><div className="section-heading"><span>原文档信息</span></div><dl><div><dt>结构类型</dt><dd>段落</dd></div><div><dt>Word 样式</dt><dd title={block.style_id}>{block.style_name}</dd></div><div><dt>格式覆盖</dt><dd>{Object.keys(block.overrides).length ? `${Object.keys(block.overrides).length} 项显式设置` : '无局部覆盖'}</dd></div></dl></div>
    <details className="structure-metadata"><summary>章节、分节与编号</summary><dl>
      <div><dt>当前章节</dt><dd>{block.chapter_ids?.map(id => chapters.find(c => c.id === id)?.name || id).join(' › ') || '未划分'}</dd></div>
      <div><dt>Word 分节</dt><dd>{sections.find(s => s.id === block.section_id)?.name || block.section_id || '未解析'}</dd></div>
      <div><dt>原大纲级别</dt><dd>{block.outline_level == null ? '无' : block.outline_level + 1}</dd></div>
      {block.numbering && <><div><dt>编号定义</dt><dd>{block.numbering.format || '未解析'} · 第 {block.numbering.level + 1} 级</dd></div><div><dt>编号模板</dt><dd>{block.numbering.text || '未解析'} · 起始 {block.numbering.start}</dd></div></>}
    </dl><p className="help-text">章节随类别更新；Word 分节与原大纲来自源文件。编号读取定义，结构视图不计算完整编号序列。</p></details>
    <FormatSources block={block} busy={busy} onClear={onClearOverrides} />
  </div>;
}
