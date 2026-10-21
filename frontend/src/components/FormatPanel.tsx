import { ArrowRight, Check, LoaderCircle, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Block, Preview } from '../lib/types';
import { formatLabels, formatValue, sizeValues } from '../lib/types';
import type { FormatDraft } from '../lib/formatDraft';
import { inputSize, stepSize } from '../lib/formatDraft';
import { FormatFields } from './FormatFields';
import { HelpTip } from './HelpTip';

type Props = {
  draft: FormatDraft; onChange: (draft: FormatDraft) => void; preview: Preview | null;
  onApply: () => void; onCancel: () => void; onRetry: () => void; busy: boolean; count: number;
  ready: boolean; pending: boolean; error: string | null; selectionActive: boolean;
  blocks: Block[]; matched: string[];
};

export function FormatPanel({ draft, onChange, preview, onApply, onCancel, onRetry, busy, count, ready, pending, error, selectionActive, blocks, matched }: Props) {
  const [visibleChanges, setVisibleChanges] = useState(30);
  const { patch, sizeChange } = draft;
  const countFields = Object.keys(patch).length + (sizeChange ? 1 : 0);
  const sizePlaceholder = useMemo(() => {
    if (pending) return '更新中…';
    const ids = new Set(matched);
    const selected = ready && preview?.after_blocks ? preview.after_blocks : blocks.filter(b => ids.has(b.id));
    const values = new Set(selected.flatMap(b => b.runs.length ? b.runs.map(r => r.format.size_pt ?? null) : [b.format.size_pt ?? null]));
    return values.size === 1 && !values.has(null) ? `当前 ${[...values][0]}` : values.size > 1 ? '混合字号' : '保持原样';
  }, [blocks, matched, preview, ready, pending]);
  return <>
    <section className="format-section compact-format">
      <div className="section-heading"><span>格式 <HelpTip text="修改会自动预览，点击应用才保存。所有填写的属性一起提交，折叠分组不排除设置。取消修改或 Esc 恢复已保存视图；已应用的结果可撤销。" /></span><span className="auto-preview-label">自动预览</span></div>
      <FormatFields patch={patch} onChange={value => onChange({ ...draft, patch: value })} sizeChange={sizeChange}
        onSizeInput={value => onChange(inputSize(draft, value))} onSizeStep={direction => { const next = stepSize(draft, direction); if (next) onChange(next); }}
        sizePlaceholder={sizePlaceholder} canGrow={stepSize(draft, 1) != null} canShrink={stepSize(draft, -1) != null} />
    </section>
    <div className="operation-footer live-operation">
      {!!countFields && <div className="draft-summary"><span>待应用 · {countFields} 项</span><div className="patch-chips" aria-label="本次全部提交属性">{Object.entries(patch).map(([key, value]) => <span key={key}>{formatLabels[key]} · {formatValue(key, value)}<button disabled={busy} aria-label={`取消${formatLabels[key]}修改`} title="移除此项设置" onClick={() => { const next = { ...patch }; delete next[key as keyof typeof next]; onChange({ ...draft, patch: next }); }}><X size={11} /></button></span>)}{sizeChange && <span>各自字号 {sizeChange.amount > 0 ? '+' : ''}{sizeChange.amount} 级<button disabled={busy} aria-label="取消字号增减" onClick={() => onChange({ ...draft, sizeChange: null })}><X size={11} /></button></span>}</div></div>}
      {error && <div className="live-error" role="alert"><p>{error}</p><button className="text-button" disabled={busy} onClick={onRetry}>重试 / 同步状态</button></div>}
      {ready && preview?.warnings?.map(warning => <p className="scope-warning" key={warning}>{warning}</p>)}
      <div className="live-preview-status" role="status">{pending ? <><LoaderCircle size={13} className="spin" />正在更新预览…</> : ready ? <><Check size={13} />{count} 段预览已更新，尚未保存</> : !selectionActive ? '先选择操作范围' : error ? '预览未完成，不能应用' : countFields ? (count ? '等待有效范围' : '没有匹配段落') : '修改设置即可预览'}</div>
      <div className="live-actions"><button className="secondary" disabled={busy || !countFields} onClick={onCancel} title="清空格式草稿并恢复已保存视图 · Esc">取消修改</button><button className="primary" disabled={busy || !ready || !preview?.ids.length} onClick={onApply}>应用到 {count} 段<ArrowRight size={15} /></button></div>
      {ready && preview && <details className="change-details"><summary>查看逐段差异 · {preview.changes.length} 段</summary><div className="change-list">{preview.changes.slice(0, visibleChanges).map(change => <div className="change-item" key={change.id}><strong>{change.id.toUpperCase()} · {change.text.slice(0, 24) || '空段落'}</strong>{Object.entries(change.after).map(([key, value]) => <div key={key}><span>{formatLabels[key]}：{key === 'size_pt' && change.size_before ? sizeValues(change.size_before) : formatValue(key, change.before[key as keyof typeof change.before])}</span><ArrowRight size={11} /><b>{key === 'size_pt' && change.size_after ? sizeValues(change.size_after) : formatValue(key, value)}</b></div>)}</div>)}</div>{preview.changes.length > visibleChanges && <button className="secondary full" onClick={() => setVisibleChanges(visibleChanges + 30)}>再显示 30 段</button>}</details>}
    </div>
  </>;
}
