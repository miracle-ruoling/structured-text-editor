import { Plus, SlidersHorizontal, X } from 'lucide-react';
import type { Condition, Selector } from '../lib/types';
import { roles } from '../lib/types';
import { ChoiceInput } from './ChoiceInput';
import { selectorComplete } from '../lib/workspace';

type Props = { value: Selector; onChange: (value: Selector) => void; tags: string[]; count: number; loading: boolean; active: boolean; onExit: () => void; onResume: () => void };

export function SelectorBuilder({ value, onChange, tags, count, loading, active, onExit, onResume }: Props) {
  function update(index: number, patch: Partial<Condition>) {
    onChange({ ...value, conditions: value.conditions.map((c, i) => i === index ? { ...c, ...patch } : c) });
  }
  function fieldChange(index: number, field: Condition['field']) {
    update(index, { field, op: field === 'text' ? 'contains' : 'is', value: { role: 'body', tag: '保留原格式', context: 'table', text: '' }[field] });
  }
  return <section className="selector-section">
    <div className="section-heading"><span><SlidersHorizontal size={15} />选择范围</span>{active && <button className="text-button" onClick={onExit}><X size={13} />退出筛选</button>}</div>
    {!active && <div className="selection-idle"><strong>未启用筛选</strong><p>选择左侧范围或编辑条件，开始批量操作。</p>{!!value.conditions.length && <button className="secondary full" onClick={onResume}>恢复上次筛选</button>}</div>}
    <div className="logic-line">匹配<select aria-label="条件组合方式" value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as Selector['mode'] })}><option value="all">全部条件</option><option value="any">任一条件</option></select>的段落</div>
    <div className="condition-list">
      {value.conditions.map((condition, index) => <div className="condition-row" key={index}>
        <select aria-label={`条件 ${index + 1} 字段`} value={condition.field} onChange={e => fieldChange(index, e.target.value as Condition['field'])}><option value="role">类别</option><option value="tag">标签</option><option value="context">位置</option><option value="text">内容</option></select>
        <select aria-label={`条件 ${index + 1} 关系`} value={condition.op} onChange={e => update(index, { op: e.target.value as Condition['op'] })}>{condition.field === 'text' ? <><option value="contains">包含</option><option value="not_contains">不含</option></> : <><option value="is">是</option><option value="is_not">不是</option></>}</select>
        {condition.field === 'role' ? <select aria-label={`条件 ${index + 1} 值`} value={condition.value} onChange={e => update(index, { value: e.target.value })}>{Object.entries(roles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : condition.field === 'context' ? <select aria-label={`条件 ${index + 1} 值`} value={condition.value} onChange={e => update(index, { value: e.target.value })}><option value="table">表格内</option><option value="outside_table">表格外</option></select> : condition.field === 'tag' ? <ChoiceInput label={`条件 ${index + 1} 值`} value={condition.value} options={tags} onChange={value => update(index, { value })} placeholder="选择标签" maxLength={40} /> : <input aria-label={`条件 ${index + 1} 值`} placeholder="输入文字" value={condition.value} onChange={e => update(index, { value: e.target.value })} maxLength={200} />}
        <button className="icon-button remove-condition" aria-label={`删除条件 ${index + 1}`} onClick={() => onChange({ ...value, conditions: value.conditions.filter((_, i) => i !== index) })}><X size={13} /></button>
      </div>)}
    </div>
    <button className="text-button add-condition" disabled={value.conditions.length >= 30} onClick={() => onChange({ ...value, conditions: [...value.conditions, { field: 'tag', op: 'is_not', value: '' }] })}><Plus size={14} />添加条件</button>
    <div className={`match-summary ${active ? '' : 'inactive'}`}><span className="status-dot" /><span>{!active ? '当前没有批量选择' : !selectorComplete(value) ? '请补全空白条件' : loading ? '正在匹配…' : <>已选中 <strong>{count}</strong> 个段落</>}</span><span>{active ? '绿色高亮' : '阅读模式'}</span></div>
  </section>;
}
