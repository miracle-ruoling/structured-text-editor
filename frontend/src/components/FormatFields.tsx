import { AlignJustify, AlignLeft, AlignCenter, AlignRight, Type, WrapText } from 'lucide-react';
import type { FormatPatch, SizeChange } from '../lib/types';
import type { FormatTab } from '../lib/workspace';
import { ChoiceInput } from './ChoiceInput';
import { FontSizeControl } from './FontSizeControl';

type Props = { patch: FormatPatch; onChange: (value: FormatPatch) => void; tab: FormatTab; onTab: (value: FormatTab) => void; sizeChange?: SizeChange | null; onSizeChange?: (value: SizeChange | null) => void };
export function FormatFields({ patch, onChange, tab, onTab, sizeChange, onSizeChange }: Props) {
  function update(key: keyof FormatPatch, value: string) {
    const next = { ...patch };
    if (value === '') delete next[key];
    else Object.assign(next, { [key]: ['font_east_asia', 'font_latin', 'alignment'].includes(key) ? value : ['bold', 'italic', 'keep_next', 'keep_lines', 'page_break_before', 'widow_control'].includes(key) ? value === 'true' : Number(value) });
    onChange(next);
  }
  const numberField = (key: keyof FormatPatch, label: string, unit: string, min: number, max: number, step: number) => <label className="field" key={key}><span>{label}</span><div className="unit-input"><input aria-label={label} type="number" min={min} max={max} step={step} placeholder="保持原样" value={patch[key] == null ? '' : String(patch[key])} onChange={e => update(key, e.target.value)} /><span>{unit}</span></div></label>;
  const flagField = (key: keyof FormatPatch, label: string) => <label className="field" key={key}><span>{label}</span><select aria-label={label} value={patch[key] == null ? '' : String(patch[key])} onChange={e => update(key, e.target.value)}><option value="">不设置</option><option value="true">开启</option><option value="false">关闭</option></select></label>;
  return <>
      <div className="segmented" role="tablist" aria-label="格式类型"><button role="tab" aria-selected={tab === 'paragraph'} className={tab === 'paragraph' ? 'selected' : ''} onClick={() => onTab('paragraph')}><WrapText size={14} />段落</button><button role="tab" aria-selected={tab === 'font'} className={tab === 'font' ? 'selected' : ''} onClick={() => onTab('font')}><Type size={14} />文字</button></div>
      {tab === 'paragraph' ? <div className="field-stack">
        {numberField('first_line_chars', '首行缩进', '字符', 0, 20, 0.5)}
        <div className="quick-values"><button onClick={() => update('first_line_chars', '0')}>不缩进</button><button onClick={() => update('first_line_chars', '2')}>2 字符</button></div>
        {numberField('line_spacing', '行距', '倍', 0.5, 5, 0.05)}
        <div className="two-fields">{numberField('space_before_pt', '段前间距', '磅', 0, 200, 0.5)}{numberField('space_after_pt', '段后间距', '磅', 0, 200, 0.5)}</div>
        <div className="field"><span>段落对齐</span><div className="alignment-options">{([{ value: 'left', label: '左对齐', icon: AlignLeft }, { value: 'center', label: '居中', icon: AlignCenter }, { value: 'right', label: '右对齐', icon: AlignRight }, { value: 'both', label: '两端对齐', icon: AlignJustify }]).map(({ value, label, icon: Icon }) => <button key={value} title={label} aria-label={label} aria-pressed={patch.alignment === value} className={patch.alignment === value ? 'chosen' : ''} onClick={() => update('alignment', patch.alignment === value ? '' : value)}><Icon size={17} /></button>)}</div></div>
        <details className="pagination-fields"><summary>分页与连排</summary><div className="two-fields">{flagField('page_break_before', '段前分页')}{flagField('keep_next', '与下段同页')}{flagField('keep_lines', '段中不分页')}{flagField('widow_control', '孤行控制')}</div><p className="help-text">这些设置由 Word 排版时执行，结构阅读视图不模拟精确分页。</p></details>
      </div> : <div className="field-stack">
        <div className="field"><span>中文字体</span><ChoiceInput label="中文字体" options={['宋体', '黑体', '微软雅黑', '仿宋', '楷体', '等线']} value={patch.font_east_asia || ''} placeholder="保持原样" onChange={value => update('font_east_asia', value)} /></div>
        <div className="field"><span>西文字体</span><ChoiceInput label="西文字体" options={['Times New Roman', 'Arial', 'Calibri', 'Consolas']} value={patch.font_latin || ''} placeholder="保持原样" onChange={value => update('font_latin', value)} /></div>
        <FontSizeControl value={patch.size_pt} onValue={value => update('size_pt', value)} relative={sizeChange} onRelative={onSizeChange} />
        <div className="two-fields">{flagField('bold', '粗体')}{flagField('italic', '斜体')}</div>
      </div>}
  </>;
}
