import { AlignJustify, AlignLeft, AlignCenter, AlignRight, Type, WrapText } from 'lucide-react';
import type { FormatPatch } from '../lib/types';
import type { FormatTab } from '../lib/workspace';
import { ChoiceInput } from './ChoiceInput';

type Props = { patch: FormatPatch; onChange: (value: FormatPatch) => void; tab: FormatTab; onTab: (value: FormatTab) => void };
export function FormatFields({ patch, onChange, tab, onTab }: Props) {
  function update(key: keyof FormatPatch, value: string) {
    const next = { ...patch };
    if (value === '') delete next[key];
    else Object.assign(next, { [key]: ['font_east_asia', 'font_latin', 'alignment'].includes(key) ? value : Number(value) });
    onChange(next);
  }
  const numberField = (key: keyof FormatPatch, label: string, unit: string, min: number, max: number, step: number) => <label className="field" key={key}><span>{label}</span><div className="unit-input"><input aria-label={label} type="number" min={min} max={max} step={step} placeholder="保持原样" value={patch[key] ?? ''} onChange={e => update(key, e.target.value)} /><span>{unit}</span></div></label>;
  return <>
      <div className="segmented" role="tablist" aria-label="格式类型"><button role="tab" aria-selected={tab === 'paragraph'} className={tab === 'paragraph' ? 'selected' : ''} onClick={() => onTab('paragraph')}><WrapText size={14} />段落</button><button role="tab" aria-selected={tab === 'font'} className={tab === 'font' ? 'selected' : ''} onClick={() => onTab('font')}><Type size={14} />文字</button></div>
      {tab === 'paragraph' ? <div className="field-stack">
        {numberField('first_line_chars', '首行缩进', '字符', 0, 20, 0.5)}
        <div className="quick-values"><button onClick={() => update('first_line_chars', '0')}>不缩进</button><button onClick={() => update('first_line_chars', '2')}>2 字符</button></div>
        {numberField('line_spacing', '行距', '倍', 0.5, 5, 0.05)}
        <div className="two-fields">{numberField('space_before_pt', '段前间距', '磅', 0, 200, 0.5)}{numberField('space_after_pt', '段后间距', '磅', 0, 200, 0.5)}</div>
        <div className="field"><span>段落对齐</span><div className="alignment-options">{([{ value: 'left', label: '左对齐', icon: AlignLeft }, { value: 'center', label: '居中', icon: AlignCenter }, { value: 'right', label: '右对齐', icon: AlignRight }, { value: 'both', label: '两端对齐', icon: AlignJustify }]).map(({ value, label, icon: Icon }) => <button key={value} title={label} aria-label={label} aria-pressed={patch.alignment === value} className={patch.alignment === value ? 'chosen' : ''} onClick={() => update('alignment', patch.alignment === value ? '' : value)}><Icon size={17} /></button>)}</div></div>
      </div> : <div className="field-stack">
        <div className="field"><span>中文字体</span><ChoiceInput label="中文字体" options={['宋体', '黑体', '微软雅黑', '仿宋', '楷体', '等线']} value={patch.font_east_asia || ''} placeholder="保持原样" onChange={value => update('font_east_asia', value)} /></div>
        <div className="field"><span>西文字体</span><ChoiceInput label="西文字体" options={['Times New Roman', 'Arial', 'Calibri', 'Consolas']} value={patch.font_latin || ''} placeholder="保持原样" onChange={value => update('font_latin', value)} /></div>
        {numberField('size_pt', '字号', '磅', 1, 200, 0.5)}
        <div className="size-presets">{[[10.5, '五号'], [12, '小四'], [14, '四号'], [15, '小三'], [16, '三号'], [18, '小二']].map(([size, label]) => <button key={size} className={patch.size_pt === size ? 'chosen' : ''} onClick={() => update('size_pt', String(size))}>{label}<span>{size}</span></button>)}</div>
      </div>}
  </>;
}
