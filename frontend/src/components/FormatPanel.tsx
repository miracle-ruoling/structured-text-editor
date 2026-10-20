import { ArrowRight, Eye, LockKeyhole, RotateCcw, WrapText } from 'lucide-react';
import { useState } from 'react';
import type { FormatPatch, Preview } from '../lib/types';
import { formatLabels, formatValue } from '../lib/types';
import { scopedPatch } from '../lib/workspace';
import type { FormatTab } from '../lib/workspace';
import { FormatFields } from './FormatFields';

type Props = { patch: FormatPatch; onChange: (patch: FormatPatch) => void; preview: Preview | null; onPreview: () => void; onApply: () => void; onCancel: () => void; busy: boolean; count: number; tab: FormatTab; onTab: (tab: FormatTab) => void; locked: boolean; onLock: (locked: boolean) => void; includeOther: boolean; onIncludeOther: (value: boolean) => void; };

export function FormatPanel({ patch, onChange, preview, onPreview, onApply, onCancel, busy, count, tab, onTab, locked, onLock, includeOther, onIncludeOther }: Props) {
  const [visibleChanges, setVisibleChanges] = useState(30);
  const submitted = scopedPatch(patch, tab, includeOther);
  const otherCount = Object.keys(scopedPatch(patch, tab === 'font' ? 'paragraph' : 'font', false)).length;
  return <>
    <section className="format-section">
      <div className="section-heading"><span><WrapText size={16} />调整格式</span><button className="text-button" disabled={!Object.keys(patch).length} onClick={() => onChange({})}><RotateCcw size={12} />清空全部</button></div>
      <FormatFields patch={patch} onChange={onChange} tab={tab} onTab={onTab} />
      <label className="check-option scope-option"><input type="checkbox" checked={includeOther} onChange={e => onIncludeOther(e.target.checked)} /><span>同时应用{tab === 'font' ? '段落' : '文字'}页的 {otherCount} 项设置</span></label>
      <label className="check-option"><input type="checkbox" checked={locked} onChange={e => onLock(e.target.checked)} /><LockKeyhole size={13} /><span>锁定草稿，应用后保留</span></label>
      <p className="scope-note">{includeOther ? '本次包含文字和段落两页' : `本次只应用${tab === 'font' ? '文字' : '段落'}页`} · {locked ? '已锁定' : '应用后清空全部草稿'}</p>
      <p className="help-text">留空的属性保持原样。此处提交为局部覆盖，优先于持续规则。</p>
      {!!Object.keys(submitted).length && <div className="patch-chips" aria-label="本次提交属性">{Object.entries(submitted).map(([key, value]) => <span key={key}>{formatLabels[key]} · {formatValue(key, value)}</span>)}</div>}
    </section>
    {preview && <section className="preview-summary"><div className="section-heading"><span><Eye size={15} />修改预览</span><span>{preview.ids.length} 段</span></div><div className="change-list">{preview.changes.slice(0, visibleChanges).map(change => <div className="change-item" key={change.id}><strong>{change.id.toUpperCase()} · {change.text.slice(0, 24) || '空段落'}{change.text.length > 24 ? '…' : ''}</strong>{Object.entries(change.after).map(([key, value]) => <div key={key}><span>{formatLabels[key]}：{formatValue(key, change.before[key as keyof typeof change.before])}</span><ArrowRight size={11} /><b>{formatValue(key, value)}</b></div>)}</div>)}</div>{preview.changes.length > visibleChanges && <button className="secondary full" onClick={() => setVisibleChanges(visibleChanges + 30)}>再显示 30 段（共 {preview.changes.length} 段）</button>}</section>}
    <div className="operation-footer">{preview ? <><button className="primary full" disabled={busy || !preview.ids.length} onClick={onApply}>应用到 {preview.ids.length} 个段落<ArrowRight size={16} /></button><button className="secondary full cancel-preview" disabled={busy} onClick={onCancel}>退出预览 · Esc</button></> : <><button className="primary full" disabled={busy || !count || !Object.keys(submitted).length} onClick={() => { setVisibleChanges(30); onPreview(); }}><Eye size={16} />预览修改</button><span className="footer-hint">先看效果，再决定是否应用</span></>}</div>
  </>;
}
