import { ArrowDown, ArrowUp, Eye, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Chapter, Section, FormatRule, RuleAction, RulePreview, RuleView } from '../lib/types';
import { formatLabels, formatValue } from '../lib/types';
import { FormatFields } from './FormatFields';
import { SelectorSummary } from './SelectorSummary';

type Props = {
  chapters?: Chapter[]; sections?: Section[]; rules: RuleView[]; draft: FormatRule | null; preview: RulePreview | null; canUseScope: boolean; busy: boolean;
  onCreate: () => void; onEdit: (rule: FormatRule) => void; onChange: (rule: FormatRule) => void;
  onDiscard: () => void; onUseScope: () => void; onLoadScope: () => void;
  onPreview: () => void; onApply: () => void; onCancel: () => void; onAction: (action: RuleAction) => void;
};

export function RulePanel({ rules, draft, preview, canUseScope, busy, chapters, sections, onCreate, onEdit, onChange, onDiscard, onUseScope, onLoadScope, onPreview, onApply, onCancel, onAction }: Props) {
  const candidate = preview?.rules.find(r => r.id === draft?.id);
  return <fieldset disabled={busy} className="rule-panel">
    <div className="rule-intro"><Layers size={19} /><div><strong>持续格式规则</strong><p>原文档 → 从上到下的规则 → 局部覆盖</p></div></div>
    <p className="help-text">类别、标签变化后自动重新匹配。同一属性以后面的规则为准，局部覆盖始终优先。</p>
    {draft ? <>
      <div className="section-heading"><span>{rules.some(r => r.id === draft.id) ? '编辑规则' : '新建规则'}</span><button className="text-button" onClick={onDiscard}>返回列表</button></div>
      <label className="field"><span>规则名称</span><input aria-label="规则名称" maxLength={60} placeholder="例如：正文统一排版" value={draft.name} onChange={e => onChange({ ...draft, name: e.target.value })} /></label>
      <label className="check-option"><input type="checkbox" checked={draft.enabled} onChange={e => onChange({ ...draft, enabled: e.target.checked })} />保存后启用</label>
      <section className="rule-scope"><div className="section-heading"><span>此规则的独立条件</span></div><SelectorSummary chapters={chapters} sections={sections} selector={draft.selector} />
        <div className="rule-scope-actions"><button className="text-button" onClick={onLoadScope}>到批量页编辑条件</button><button className="secondary" disabled={!canUseScope} onClick={onUseScope}>采用当前筛选</button></div>
        <p className="help-text">批量筛选变化不会自动改变本规则。编辑条件后回到此处，点击「采用当前筛选」。</p>
      </section>
      <div className="section-heading"><span>规则格式</span><button className="text-button" onClick={() => onChange({ ...draft, patch: {} })}>清空</button></div>
      <FormatFields patch={draft.patch} onChange={patch => onChange({ ...draft, patch })} />
      <p className="scope-note">规则保存所有填写的属性，折叠不影响范围。</p>
      <div className="patch-chips" aria-label="规则全部属性">{Object.entries(draft.patch).map(([key, value]) => <span key={key}>{formatLabels[key]} · {formatValue(key, value)}</span>)}</div>
      {preview && <div className="rule-preview-summary" role="status"><strong>{preview.ids.length} 段的显示格式将改变</strong><p>保存后此规则匹配 {candidate?.matched_count ?? 0} 段，{candidate?.effective_count ?? 0} 段至少有一项属性由它决定。</p>{candidate?.scope_warning && <p className="scope-warning">{candidate.scope_warning}</p>}{preview.warnings?.map(w => <p className="scope-warning" key={w}>{w}</p>)}{!preview.ids.length && <p>当前没有显示变化，仍可保存为持续规则；可在对象属性中查看覆盖关系。</p>}<p>蓝色区域是计算后的完整格式。规则草稿尚未保存。</p></div>}
      <div className="operation-footer">{preview ? <><button className="primary full" onClick={onApply}>保存规则并应用</button><button className="secondary full" onClick={onCancel}>退出预览 · Esc</button></> : <button className="primary full" disabled={!draft.name.trim() || !Object.keys(draft.patch).length} onClick={onPreview}><Eye size={16} />预览规则效果</button>}</div>
    </> : <>
      <button className="primary full" disabled={!canUseScope || rules.length >= 50} onClick={onCreate}><Plus size={16} />从当前筛选新建规则</button>
      {!canUseScope && <p className="help-text">先在批量页选择一个有效范围，再来创建规则。可以保存暂时没有命中的范围。</p>}
      <div className="rule-list">{rules.length ? rules.map((rule, index) => <section className={`rule-card ${rule.enabled ? '' : 'rule-disabled'}`} key={rule.id}>
        <div className="rule-card-heading"><span className="rule-order">{index + 1}</span><strong>{rule.name}</strong><label className="check-option"><input type="checkbox" aria-label={`启用规则 ${rule.name}`} checked={rule.enabled} onChange={e => onAction({ action: 'toggle', id: rule.id, enabled: e.target.checked })} />启用</label></div>
        {rule.scope_warning && <p className="scope-warning" role="status">{rule.scope_warning}</p>}
        <p className="rule-counts">匹配 {rule.matched_count} 段 · {rule.enabled ? `${rule.effective_count} 段有生效属性` : '已停用'}</p>
        <details><summary>条件与格式 · {Object.keys(rule.patch).length} 项</summary><SelectorSummary chapters={chapters} sections={sections} selector={rule.selector} /><div className="patch-chips">{Object.entries(rule.patch).map(([key, value]) => <span key={key}>{formatLabels[key]} · {formatValue(key, value)}</span>)}</div></details>
        <div className="rule-actions"><button onClick={() => onEdit(rule)}><Pencil size={13} />编辑</button><button aria-label={`上移规则 ${rule.name}`} disabled={index === 0} onClick={() => onAction({ action: 'move', id: rule.id, position: index - 1 })}><ArrowUp size={14} /></button><button aria-label={`下移规则 ${rule.name}`} disabled={index === rules.length - 1} onClick={() => onAction({ action: 'move', id: rule.id, position: index + 1 })}><ArrowDown size={14} /></button><button aria-label={`删除规则 ${rule.name}`} className="rule-delete" onClick={() => onAction({ action: 'delete', id: rule.id })}><Trash2 size={14} />删除</button></div>
      </section>) : <div className="rule-empty"><Layers size={28} /><p>还没有持续规则</p><span>把反复使用的范围和格式保存下来。</span></div>}</div>
      <p className="help-text">启停、移动和删除立即保存，可撤销。规则随当前项目包携带。</p>
    </>}
  </fieldset>;
}
