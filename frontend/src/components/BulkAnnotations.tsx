import { Tags } from 'lucide-react';
import type { BulkAnnotation, Role } from '../lib/types';
import { roles } from '../lib/types';
import { ChoiceInput } from './ChoiceInput';

export function BulkAnnotations({ count, disabled, tags, draft, onDraft, onApply, action, onAction, role, onRole }: {
  count: number; disabled: boolean; tags: string[]; draft: string; onDraft: (value: string) => void; onApply: (action: BulkAnnotation) => Promise<boolean>;
  action: BulkAnnotation['action']; onAction: (action: BulkAnnotation['action']) => void; role: Role; onRole: (role: Role) => void;
}) {
  const isTag = action === 'add_tag' || action === 'remove_tag';
  const names = { add_tag: '添加标签', remove_tag: '移除标签', set_role: '设置类别', reset_role: '恢复自动类别' };
  async function apply() {
    const payload: BulkAnnotation = isTag ? { action, tag: draft.trim() } : action === 'set_role' ? { action, role } : { action };
    if (await onApply(payload)) onDraft('');
  }
  return <details className="bulk-annotations"><summary><Tags size={15} />批量标注 <span>当前筛选 · {count} 段</span></summary>
    <div className="field-stack"><select aria-label="批量标注动作" value={action} onChange={e => onAction(e.target.value as BulkAnnotation['action'])}>{Object.entries(names).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select>
      {isTag ? <ChoiceInput label="批量标签" value={draft} options={tags} onChange={onDraft} maxLength={40} placeholder="选择或输入标签" /> : action === 'set_role' ? <select aria-label="批量设置类别" value={role} onChange={e => onRole(e.target.value as Role)}>{Object.entries(roles).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select> : null}
      <button className="secondary full" disabled={disabled || !count || (isTag && (!draft.trim() || draft.trim().length > 40))} onClick={() => void apply()}>{names[action]} · {count} 段</button>
      <p className="help-text">按当前筛选一次性标注，可撤销。标签和类别变化后，持续规则会重新匹配。</p>
    </div>
  </details>;
}
