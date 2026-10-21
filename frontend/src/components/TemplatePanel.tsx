import { useRef, useState } from 'react';
import { Download, Layers, Plus, RotateCcw, Save, Trash2, Upload } from 'lucide-react';
import type { DocumentView, Role, StoredTemplate, TemplateLibrary, TemplatePreview } from '../lib/types';
import { formatLabels, formatValue, roles } from '../lib/types';
import type { Extraction, TemplateDraft } from '../lib/templates';
import { extractedEntries, templateError } from '../lib/templates';
import { FormatFields } from './FormatFields';
import { HelpTip } from './HelpTip';

type Props = {
  doc: DocumentView; library: TemplateLibrary | null; draft: TemplateDraft | null; extraction: Extraction | null;
  busy: boolean; dirty: boolean; preview: TemplatePreview | null; ready: boolean; pending: boolean; error: string | null;
  scope: 'all' | 'selection'; scopeReady: boolean; scopeCount: number; previewEnabled: boolean;
  onScope: (value: 'all' | 'selection') => void; onPreviewToggle: () => void;
  onRefresh: () => void; onRetry: () => void; onNew: () => void; onEdit: (item: StoredTemplate) => void; onBack: () => void;
  onChange: (draft: TemplateDraft) => void; onExtract: () => void; onExtraction: (value: Extraction | null) => void; onAdopt: () => void;
  onSave: (copy?: boolean) => void; onDelete: (id: string, restore?: boolean) => void; onImport: (file: File) => void; onApply: () => void;
};

export function TemplatePanel(props: Props) {
  const { doc, library, draft, extraction, busy, dirty, preview, ready, pending, error } = props;
  const [addRole, setAddRole] = useState<Role>('body');
  const file = useRef<HTMLInputElement>(null);
  const available = (Object.keys(roles) as Role[]).filter(role => !draft?.template.entries.some(entry => entry.role === role));
  const role = available.includes(addRole) ? addRole : available[0];
  return <fieldset className="template-panel" disabled={busy}>
    <div className="section-heading"><span><Layers size={16} />类别模板 <HelpTip text="按类别一次性应用，之后改类别不会自动重排。模板库在本机各文档间共用；项目包只携带已应用结果。小标题/列表暂不区分级别。" /></span><button className="text-button" onClick={props.onRefresh}>刷新模板库</button></div>
    {doc.legacy_migration && <details className="template-migration"><summary>旧规则已冻结并留档</summary><p>当前结果和每个历史状态均保留为单次格式；撤销不会重新启动规则。迁移前完整状态随项目包保留。</p>{doc.legacy_migration.warnings.map(w => <p key={w}>{w}</p>)}</details>}
    {extraction ? <>
      <div className="section-heading"><span>选择各类的常用组合</span><button className="text-button" onClick={() => props.onExtraction(null)}>返回</button></div>
      <p className="help-text">按整套格式统计。并列最多时请自行选择；省略的混合、未知或不支持属性不会写入模板。</p>
      {extraction.groups.map(group => {
        const selected = extraction.choices[group.role];
        const candidate = selected != null && selected >= 0 ? group.candidates[selected] : null;
        return <section className="template-card" key={group.role}>
          <strong>{roles[group.role]} · {group.count} 段</strong>
          <p>{group.candidates.length > 1 ? `${group.candidates.length} 种组合${group.tied ? ' · 最高频并列，需选择' : ' · 已建议最常用组合'}` : '格式组合一致'}</p>
          <select aria-label={`${roles[group.role]}提取组合`} value={selected ?? ''} onChange={e => props.onExtraction({ ...extraction, choices: { ...extraction.choices, [group.role]: e.target.value === '' ? null : Number(e.target.value) } })}>
            <option value="">请选择组合…</option><option value="-1">不提取此类别</option>
            {group.candidates.map((candidate, index) => <option value={index} key={index} disabled={!Object.keys(candidate.patch).length}>组合 {index + 1} · {candidate.count}/{group.count} 段 · 示例 {candidate.example.toUpperCase()}{!Object.keys(candidate.patch).length ? ' · 无可提取属性' : ''}</option>)}
          </select>
          {candidate && <><div className="patch-chips">{Object.entries(candidate.patch).map(([key, value]) => <span key={key}>{formatLabels[key]} · {formatValue(key, value)}</span>)}</div>
            {!!Object.keys(candidate.omitted).length && <details><summary>未提取的属性</summary><p>{Object.entries(candidate.omitted).map(([key, count]) => `${formatLabels[key]}（${count} 段）`).join('、')}</p></details>}</>}
        </section>;
      })}
      <button className="primary full" disabled={!extractedEntries(extraction)?.length || extraction.revision !== doc.revision} onClick={props.onAdopt}>采用组合，继续编辑模板</button>
      {extraction.revision !== doc.revision && <p role="alert">文档已变化，请重新提取。</p>}
    </> : draft ? <>
      <div className="section-heading"><span>{draft.id ? '编辑与应用' : '新建模板'}</span><button className="text-button" onClick={props.onBack}>返回列表</button></div>
      <label className="field"><span>模板名称</span><input aria-label="模板名称" maxLength={60} placeholder="例如：课程报告" value={draft.template.name} onChange={e => props.onChange({ ...draft, template: { ...draft.template, name: e.target.value } })} /></label>
      <div className="template-entries">{draft.template.entries.map(entry => <details className="template-entry" key={entry.role}>
        <summary>{roles[entry.role]}<span>{Object.keys(entry.patch).length} 项格式</span></summary>
        <div className="template-entry-content"><button className="text-button" onClick={() => props.onChange({ ...draft, template: { ...draft.template, entries: draft.template.entries.filter(item => item.role !== entry.role) } })}><Trash2 size={12} />移除此类别</button>
          <FormatFields patch={entry.patch} onChange={patch => props.onChange({ ...draft, template: { ...draft.template, entries: draft.template.entries.map(item => item.role === entry.role ? { ...item, patch } : item) } })} />
        </div>
      </details>)}</div>
      {available.length > 0 && <div className="template-add"><select aria-label="添加模板类别" value={role} onChange={e => setAddRole(e.target.value as Role)}>{available.map(role => <option key={role} value={role}>{roles[role]}</option>)}</select><button className="secondary" onClick={() => props.onChange({ ...draft, template: { ...draft.template, entries: [...draft.template.entries, { role, patch: {} }] } })}><Plus size={14} />添加类别</button></div>}
      <div className="template-save"><button className="secondary" disabled={!library || !!templateError(draft.template) || !dirty} onClick={() => props.onSave()}><Save size={14} />保存模板</button>{draft.id && <button className="text-button" disabled={!library || !!templateError(draft.template)} title="请先使用新的模板名称" onClick={() => props.onSave(true)}>另存新模板</button>}<span>{dirty ? '模板有未保存修改' : '模板已保存'}</span></div>
      <section className="template-apply">
        <label className="field"><span>本次应用范围</span><select aria-label="模板应用范围" value={props.scope} onChange={e => props.onScope(e.target.value as Props['scope'])}><option value="all">全文 · 按模板类别匹配</option><option value="selection">当前筛选 · {props.scopeCount} 段中按类别匹配</option></select></label>
        {props.scope === 'selection' && !props.scopeReady && <p className="scope-warning">请先在操作页设置并确认筛选范围。</p>}
        <label className="check-option"><input type="checkbox" checked={props.previewEnabled} onChange={props.onPreviewToggle} />实时预览模板效果</label>
        {error && <div className="live-error" role="alert"><p>{error}</p>{!templateError(draft.template) && <button className="text-button" onClick={props.onRetry}>同步文档并重试</button>}</div>}
        {pending && <p className="help-text">正在计算模板效果…</p>}
        {ready && preview && <><p className="template-count">匹配 {preview.ids.length} 段 · 显示变化 {preview.changes.length} 段</p><p className="help-text">{Object.entries(preview.counts).map(([role, count]) => `${roles[role as Role]} ${count}`).join(' · ')}</p>{!!preview.warnings?.length && <details><summary>应用提示 · {preview.warnings.length}</summary>{preview.warnings.map((warning, index) => <p className="scope-warning" key={index}>{warning}</p>)}</details>}</>}
        <button className="primary full" disabled={!ready || !preview?.ids.length} onClick={props.onApply}>应用到文档 · 可撤销</button>
        <p className="help-text">保存模板只更新模板库。应用只更改文档，不会自动保存模板草稿。</p>
      </section>
    </> : <>
      <div className="template-create"><button className="primary full" onClick={props.onExtract}>从当前文档提取</button><button className="secondary" onClick={props.onNew}><Plus size={14} />空白模板</button><button className="secondary" disabled={!library} onClick={() => file.current?.click()}><Upload size={14} />导入模板</button></div>
      <input ref={file} type="file" hidden accept=".json" onChange={e => { const value = e.target.files?.[0]; e.target.value = ''; if (value) props.onImport(value); }} />
      {!library ? <p className="help-text">模板库尚未加载，请点击刷新。</p> : !library.items.length ? <p className="help-text">还没有模板。从文档提取或新建后，就能在其他文件中复用。</p> : library.items.map(item => <section className="template-card" key={item.id}>
        <strong>{item.name}</strong><p>{item.entries.map(entry => roles[entry.role]).join(' · ')}</p><div className="template-actions"><button className="secondary" onClick={() => props.onEdit(item)}>编辑 / 应用</button><a className="text-button" href={`/api/templates/${item.id}/export`} download title="导出独立模板文件"><Download size={14} />导出</a><button className="text-button" onClick={() => props.onDelete(item.id)}><Trash2 size={13} />删除</button></div>
      </section>)}
      {!!library?.deleted.length && <details className="template-trash"><summary>最近删除 · {library.deleted.length}</summary>{[...library.deleted].reverse().map(item => <div key={item.id}><span>{item.name}</span><button className="text-button" onClick={() => props.onDelete(item.id, true)}><RotateCcw size={12} />恢复</button></div>)}</details>}
    </>}
  </fieldset>;
}
