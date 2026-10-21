import { Check, CircleHelp, Fingerprint, Plus, Tag, X } from 'lucide-react';
import type { AnnotationPatch, Block, Chapter, Role, Section } from '../lib/types';
import { roles } from '../lib/types';
import { FormatSources } from './FormatSources';

type Props = { block: Block | null; busy: boolean; onSave: (id: string, patch: AnnotationPatch) => Promise<boolean>; tagDraft: string; onTagDraft: (value: string) => void; onFormat: (id: string) => void; onClearOverrides: (id: string, keys: string[]) => void; chapters?: Chapter[]; sections?: Section[] };
export function ObjectInspector({ block, busy, onSave, tagDraft, onTagDraft, onFormat, onClearOverrides, chapters, sections }: Props) {
  if (!block) return <div className="inspector-empty"><Fingerprint size={36} /><h3>查看一个对象</h3><p>右键点击段落并选择「检查对象」，查看类别、标签和格式来源。</p></div>;
  return <ObjectForm key={block.id} block={block} busy={busy} onSave={onSave} tagDraft={tagDraft} onTagDraft={onTagDraft} onFormat={onFormat} onClearOverrides={onClearOverrides} chapters={chapters} sections={sections} />;
}

function ObjectForm({ block, busy, onSave, tagDraft: tag, onTagDraft: setTag, onFormat, onClearOverrides, chapters = [], sections = [] }: Omit<Props, 'block'> & { block: Block }) {
  const { role, tags } = block;
  async function addTag() {
    const value = tag.trim();
    if (!value || tags.length >= 30) return;
    if (tags.includes(value)) { setTag(''); return; }
    if (await onSave(block.id, { tags: [...tags, value] })) setTag('');
  }
  return <div className="object-inspector">
    <div className="object-identity"><span><Fingerprint size={16} />段落 {block.id.toUpperCase()}</span><span>{block.in_table ? '表格内' : '表格外'}</span></div>
    <div className="object-excerpt">{block.text || '空段落 / 非文字内容'}</div>
    {!block.editable && <p className="locked-message">此段落处于复杂结构中，本阶段仅供查看。</p>}
    <fieldset disabled={busy || !block.editable}>
      <label className="field"><span>主要类别 <b className="required">必选</b></span><select aria-label="对象主要类别" value={role} onChange={e => void onSave(block.id, { role: e.target.value as Role })}>{Object.entries(roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className="classification-source"><CircleHelp size={12} /><span>类别来源：{block.confirmed ? '手动设置' : '自动识别'}<br />{block.role_source}</span></div>
      {block.confirmed && <button className="text-button reset-role" onClick={() => void onSave(block.id, { reset_role: true })}>恢复自动识别</button>}
      <label className="field tag-field"><span>自由标签</span></label>
      <div className="editable-tags">{tags.length ? tags.map(t => <span key={t}><Tag size={11} />{t}<button aria-label={`移除标签 ${t}`} onClick={() => void onSave(block.id, { tags: tags.filter(item => item !== t) })}><X size={12} /></button></span>) : <p>还没有标签</p>}</div>
      <div className="add-tag"><input aria-label="新标签" placeholder="输入标签，按 Enter 添加" maxLength={40} value={tag} onChange={e => setTag(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addTag(); } }} /><button className="icon-button" aria-label="添加标签" disabled={!tag.trim() || tags.length >= 30} onClick={addTag}><Plus size={17} /></button></div>
      {!tags.includes('保留原格式') && tags.length < 30 && <button className="text-button tag-shortcut" onClick={() => void onSave(block.id, { tags: [...tags, '保留原格式'] })}>+ 保留原格式</button>}
      <p className="autosave-note"><Check size={12} />类别选择、标签添加或移除后自动保存，可撤销。</p>
      {!!tag.trim() && <p className="help-text">此标签尚未添加，请按 Enter 或 +。</p>}
    </fieldset>
    <button className="secondary full object-format-button" disabled={busy || !block.editable} onClick={() => onFormat(block.id)}>仅调整此段的格式</button>
    <div className="source-section"><div className="section-heading"><span>原文档信息</span></div><dl><div><dt>结构类型</dt><dd>段落</dd></div><div><dt>Word 样式</dt><dd title={block.style_id}>{block.style_name}</dd></div><div><dt>格式覆盖</dt><dd>{Object.keys(block.overrides).length ? `${Object.keys(block.overrides).length} 项显式设置` : '无局部覆盖（可由规则决定）'}</dd></div></dl></div>
    <details className="structure-metadata"><summary>章节、分节与编号</summary><dl>
      <div><dt>当前章节</dt><dd>{block.chapter_ids?.map(id => chapters.find(c => c.id === id)?.name || id).join(' › ') || '未划分'}</dd></div>
      <div><dt>Word 分节</dt><dd>{sections.find(s => s.id === block.section_id)?.name || block.section_id || '未解析'}</dd></div>
      <div><dt>原大纲级别</dt><dd>{block.outline_level == null ? '无' : block.outline_level + 1}</dd></div>
      {block.numbering && <><div><dt>编号定义</dt><dd>{block.numbering.format || '未解析'} · 第 {block.numbering.level + 1} 级</dd></div><div><dt>编号模板</dt><dd>{block.numbering.text || '未解析'} · 起始 {block.numbering.start}</dd></div></>}
    </dl><p className="help-text">章节随类别更新；Word 分节与原大纲来自源文件。编号读取定义，结构视图不计算完整编号序列。</p></details>
    <FormatSources block={block} busy={busy} onClear={onClearOverrides} />
  </div>;
}
