import { Braces, Plus, Save, SlidersHorizontal, X } from 'lucide-react';
import type { Condition, Selector } from '../lib/types';
import { roles } from '../lib/types';
import { ChoiceInput } from './ChoiceInput';
import { selectorComplete } from '../lib/workspace';
import { nextKey, toggleExpression } from '../lib/selection';

type Props = {
  value: Selector; onChange: (value: Selector) => void; tags: string[]; count: number; loading: boolean;
  active: boolean; onExit: () => void; onResume: () => void; canResume: boolean; onStart: () => void; error: string | null; marked: string[];
  saveName: string; onSaveName: (value: string) => void; onSave: () => void; savedCount: number;
};

export function SelectorBuilder({ value, onChange, tags, count, loading, active, onExit, onResume, canResume, onStart, error, marked, saveName, onSaveName, onSave, savedCount }: Props) {
  if (!active) return <section className="selector-section">
    <div className="section-heading"><span><SlidersHorizontal size={15} />选择范围</span></div>
    <div className="selection-idle"><strong>未启用筛选</strong><p>选择左侧范围，或新建筛选开始批量操作。</p>
      {canResume && <button className="secondary full" onClick={onResume}>恢复上次筛选</button>}
      <button className={`${canResume ? 'text-button' : 'secondary'} full`} onClick={onStart}><Plus size={13} />新建筛选</button>
    </div>
  </section>;
  const advanced = value.mode === 'expression';
  const refs = new Set([...(value.expression || '').matchAll(/\$([A-Z][A-Z0-9_]*)/gi)].map(m => m[1].toUpperCase()));
  const unused = advanced ? value.conditions.filter(c => !refs.has(c.key || '')) : [];
  function update(index: number, patch: Partial<Condition>) {
    onChange({ ...value, conditions: value.conditions.map((c, i) => i === index ? { ...c, ...patch } : c) });
  }
  function fieldChange(index: number, field: Condition['field']) {
    update(index, { field, op: field === 'text' ? 'contains' : 'is', value: { role: 'body', tag: '保留原格式', context: 'table', text: '', ids: '' }[field], ids: field === 'ids' ? [...marked] : undefined });
  }
  return <section className="selector-section">
    <div className="section-heading"><span><SlidersHorizontal size={15} />选择范围</span><div className="selector-tools"><button className={`logic-toggle ${advanced ? 'chosen' : ''}`} aria-label="高级逻辑表达式" aria-pressed={advanced} title={advanced ? '切回全部条件，替换当前表达式' : '使用 AND / OR / NOT 自由组合'} onClick={() => onChange(toggleExpression(value))}><Braces size={16} /></button><button className="text-button" onClick={onExit}><X size={13} />退出筛选</button></div></div>
    {!advanced && <div className="logic-line">匹配<select aria-label="条件组合方式" value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as Selector['mode'] })}><option value="all">全部条件</option><option value="any">任一条件</option></select>的段落</div>}
    <div className="condition-list">
      {value.conditions.map((condition, index) => <div className="condition-entry" key={condition.key || index}>
        {advanced && <div className="condition-reference"><code>${condition.key}</code><span>{refs.has(condition.key || '') ? '已引用' : '未引用'}</span></div>}
        <div className="condition-row">
          {condition.field === 'ids' ? <span className="condition-field-label">框选</span> : <select aria-label={`条件 ${index + 1} 字段`} value={condition.field} onChange={e => fieldChange(index, e.target.value as Condition['field'])}><option value="role">类别</option><option value="tag">标签</option><option value="context">位置</option><option value="text">内容</option><option value="ids" disabled={!marked.length}>框选</option></select>}
          <select aria-label={`条件 ${index + 1} 关系`} value={condition.op} onChange={e => update(index, { op: e.target.value as Condition['op'] })}>{condition.field === 'text' ? <><option value="contains">包含</option><option value="not_contains">不含</option></> : <><option value="is">是</option><option value="is_not">不是</option></>}</select>
          {condition.field === 'role' ? <select aria-label={`条件 ${index + 1} 值`} value={condition.value} onChange={e => update(index, { value: e.target.value })}>{Object.entries(roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : condition.field === 'context' ? <select aria-label={`条件 ${index + 1} 值`} value={condition.value} onChange={e => update(index, { value: e.target.value })}><option value="table">表格内</option><option value="outside_table">表格外</option></select> : condition.field === 'tag' ? <ChoiceInput label={`条件 ${index + 1} 值`} value={condition.value} options={tags} onChange={value => update(index, { value })} placeholder="选择标签" maxLength={40} /> : condition.field === 'ids' ? <span className="range-count">{condition.ids?.length || 0} 段快照</span> : <input aria-label={`条件 ${index + 1} 值`} placeholder="输入文字" value={condition.value} onChange={e => update(index, { value: e.target.value })} maxLength={200} />}
          <button className="icon-button remove-condition" aria-label={`删除条件 ${index + 1}`} onClick={() => onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== index) })}><X size={13} /></button>
        </div>
        {condition.field === 'ids' && <details className="range-details"><summary>查看快照编号</summary><p>{condition.ids?.join('、')}</p><span>需更换范围时，删除此条件后重新加入框选。</span></details>}
      </div>)}
    </div>
    <button className="text-button add-condition" disabled={value.conditions.length >= 30} onClick={() => onChange({ ...value, conditions: [...value.conditions, { key: nextKey(value), field: 'tag', op: 'is_not', value: '' }] })}><Plus size={14} />添加条件</button>
    {advanced && <div className="expression-editor"><label htmlFor="logic-expression">逻辑表达式</label><textarea id="logic-expression" aria-label="逻辑表达式" spellCheck={false} value={value.expression || ''} maxLength={2000} placeholder="$A AND ($B OR NOT $C)" onChange={e => onChange({ ...value, expression: e.target.value })} /><p>与 AND · 或 OR · 非 NOT · 用括号分组。代号不随删行改名；切回简单模式会改为全部满足。</p>{unused.length > 0 && <span className="expression-note">未参与表达式：{unused.map(c => `$${c.key}`).join('、')}</span>}</div>}
    {active && error && <p className="selector-error" role="alert">{error}</p>}
    <div className={`match-summary ${active ? '' : 'inactive'}`}><span className="status-dot" /><span>{!active ? '当前没有批量选择' : !selectorComplete(value) ? '请补全条件或表达式' : error ? '表达式无效，未选择任何段落' : loading ? '正在匹配…' : <>已选中 <strong>{count}</strong> 个段落</>}</span><span>{active ? '绿色高亮' : '阅读模式'}</span></div>
    <div className="save-selector"><input aria-label="筛选名称" placeholder="命名当前筛选…" maxLength={60} value={saveName} onChange={e => onSaveName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && active && !loading && !error && selectorComplete(value) && saveName.trim() && savedCount < 50) { e.preventDefault(); onSave(); } }} /><button className="icon-button" aria-label="保存当前筛选" title="保存条件，可从左侧恢复；不会应用格式" disabled={!active || loading || !!error || !selectorComplete(value) || !saveName.trim() || savedCount >= 50} onClick={onSave}><Save size={16} /></button></div>
    <p className="help-text">保存条件供本文件复用，不会持续修改格式。</p>
  </section>;
}
