import { AlignJustify, AlignLeft, AlignCenter, AlignRight, ArrowRight, Eye, RotateCcw, Type, WrapText } from 'lucide-react';
import { useState } from 'react';
import type { FormatPatch, Preview } from '../lib/types';
import { formatLabels, formatValue } from '../lib/types';

type Props = { patch: FormatPatch; onChange: (patch: FormatPatch) => void; preview: Preview | null; onPreview: () => void; onApply: () => void; onCancel: () => void; busy: boolean; count: number; };

export function FormatPanel({ patch, onChange, preview, onPreview, onApply, onCancel, busy, count }: Props) {
  const [tab, setTab] = useState<'paragraph' | 'font'>('paragraph');
  function update(key: keyof FormatPatch, value: string) {
    const next = { ...patch };
    if (value === '') delete next[key];
    else Object.assign(next, { [key]: ['font_east_asia', 'font_latin', 'alignment'].includes(key) ? value : Number(value) });
    onChange(next);
  }
  const numberField = (key: keyof FormatPatch, label: string, unit: string, min: number, max: number, step: number) => <label className="field" key={key}><span>{label}</span><div className="unit-input"><input aria-label={label} type="number" min={min} max={max} step={step} placeholder="保持原样" value={patch[key] ?? ''} onChange={e => update(key, e.target.value)} /><span>{unit}</span></div></label>;
  return <>
    <section className="format-section">
      <div className="section-heading"><span><WrapText size={16} />调整格式</span><button className="text-button" disabled={!Object.keys(patch).length} onClick={() => onChange({})}><RotateCcw size={12} />重置</button></div>
      <div className="segmented" role="tablist" aria-label="格式类型"><button role="tab" aria-selected={tab === 'paragraph'} className={tab === 'paragraph' ? 'selected' : ''} onClick={() => setTab('paragraph')}><WrapText size={14} />段落</button><button role="tab" aria-selected={tab === 'font'} className={tab === 'font' ? 'selected' : ''} onClick={() => setTab('font')}><Type size={14} />文字</button></div>
      {tab === 'paragraph' ? <div className="field-stack">
        {numberField('first_line_chars', '首行缩进', '字符', 0, 20, 0.5)}
        <div className="quick-values"><button onClick={() => update('first_line_chars', '0')}>不缩进</button><button onClick={() => update('first_line_chars', '2')}>2 字符</button></div>
        {numberField('line_spacing', '行距', '倍', 0.5, 5, 0.05)}
        <div className="two-fields">{numberField('space_before_pt', '段前间距', '磅', 0, 200, 0.5)}{numberField('space_after_pt', '段后间距', '磅', 0, 200, 0.5)}</div>
        <div className="field"><span>段落对齐</span><div className="alignment-options">{([{ value: 'left', label: '左对齐', icon: AlignLeft }, { value: 'center', label: '居中', icon: AlignCenter }, { value: 'right', label: '右对齐', icon: AlignRight }, { value: 'both', label: '两端对齐', icon: AlignJustify }]).map(({ value, label, icon: Icon }) => <button key={value} title={label} aria-label={label} aria-pressed={patch.alignment === value} className={patch.alignment === value ? 'chosen' : ''} onClick={() => update('alignment', patch.alignment === value ? '' : value)}><Icon size={17} /></button>)}</div></div>
      </div> : <div className="field-stack">
        <label className="field"><span>中文字体</span><input aria-label="中文字体" list="east-fonts" placeholder="保持原样" maxLength={100} value={patch.font_east_asia || ''} onChange={e => update('font_east_asia', e.target.value)} /></label>
        <datalist id="east-fonts">{['宋体', '黑体', '微软雅黑', '仿宋', '楷体', '等线'].map(f => <option key={f} value={f} />)}</datalist>
        <label className="field"><span>西文字体</span><input aria-label="西文字体" list="latin-fonts" placeholder="保持原样" maxLength={100} value={patch.font_latin || ''} onChange={e => update('font_latin', e.target.value)} /></label>
        <datalist id="latin-fonts">{['Times New Roman', 'Arial', 'Calibri', 'Consolas'].map(f => <option key={f} value={f} />)}</datalist>
        {numberField('size_pt', '字号', '磅', 1, 200, 0.5)}
        <div className="size-presets">{[[10.5, '五号'], [12, '小四'], [14, '四号'], [15, '小三'], [16, '三号'], [18, '小二']].map(([size, label]) => <button key={size} className={patch.size_pt === size ? 'chosen' : ''} onClick={() => update('size_pt', String(size))}>{label}<span>{size}</span></button>)}</div>
      </div>}
      <p className="help-text">留空的属性保持原样。标注类别和标签不会改变 Word 的原有样式。</p>
      {!!Object.keys(patch).length && <div className="patch-chips">{Object.entries(patch).map(([key, value]) => <span key={key}>{formatLabels[key]} · {formatValue(key, value)}</span>)}</div>}
    </section>
    {preview && <section className="preview-summary"><div className="section-heading"><span><Eye size={15} />修改预览</span><span>{preview.ids.length} 段</span></div><div className="change-list">{preview.changes.map(change => <div className="change-item" key={change.id}><strong>{change.id.toUpperCase()} · {change.text.slice(0, 24) || '空段落'}{change.text.length > 24 ? '…' : ''}</strong>{Object.entries(change.after).map(([key, value]) => <div key={key}><span>{formatLabels[key]}：{formatValue(key, change.before[key as keyof typeof change.before])}</span><ArrowRight size={11} /><b>{formatValue(key, value)}</b></div>)}</div>)}</div></section>}
    <div className="operation-footer">{preview ? <><button className="primary full" disabled={busy || !preview.ids.length} onClick={onApply}>应用到 {preview.ids.length} 个段落<ArrowRight size={16} /></button><button className="text-button cancel-preview" disabled={busy} onClick={onCancel}>退出预览，继续调整</button></> : <><button className="primary full" disabled={busy || !count || !Object.keys(patch).length} onClick={onPreview}><Eye size={16} />预览修改</button><span className="footer-hint">先看效果，再决定是否应用</span></>}</div>
  </>;
}
