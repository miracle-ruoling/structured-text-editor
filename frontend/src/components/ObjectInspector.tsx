import { Check, CircleHelp, Fingerprint, Plus, Tag, X } from 'lucide-react';
import type { AnnotationPatch, Block, Role } from '../lib/types';
import { formatLabels, formatValue, roles } from '../lib/types';

type Props = { block: Block | null; busy: boolean; onSave: (id: string, patch: AnnotationPatch) => Promise<boolean>; tagDraft: string; onTagDraft: (value: string) => void; onFormat: (id: string) => void };
export function ObjectInspector({ block, busy, onSave, tagDraft, onTagDraft, onFormat }: Props) {
  if (!block) return <div className="inspector-empty"><Fingerprint size={36} /><h3>查看一个对象</h3><p>点击文档中的段落，查看它的类别、标签和格式来源。</p></div>;
  return <ObjectForm key={block.id} block={block} busy={busy} onSave={onSave} tagDraft={tagDraft} onTagDraft={onTagDraft} onFormat={onFormat} />;
}

function ObjectForm({ block, busy, onSave, tagDraft: tag, onTagDraft: setTag, onFormat }: Omit<Props, 'block'> & { block: Block }) {
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
    <div className="source-section"><div className="section-heading"><span>原文档信息</span></div><dl><div><dt>结构类型</dt><dd>段落</dd></div><div><dt>Word 样式</dt><dd title={block.style_id}>{block.style_name}</dd></div><div><dt>格式覆盖</dt><dd>{Object.keys(block.overrides).length ? `${Object.keys(block.overrides).length} 项显式设置` : '使用原文档格式'}</dd></div></dl></div>
    <div className="source-section"><div className="section-heading"><span>当前格式与来源</span></div><div className="format-sources">{Object.entries(block.format).map(([key, value]) => <div key={key}><div><span>{formatLabels[key] || key}</span><strong>{formatValue(key, value)}</strong></div><p>{block.format_sources[key] || '原文档 / 未完整解析'}</p></div>)}</div><p className="help-text">首版显示常见样式与直接格式；主题字体、条件表格样式等以 Word 为准。</p></div>
  </div>;
}
