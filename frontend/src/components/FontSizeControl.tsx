import { ChevronDown, ChevronUp } from 'lucide-react';
import { HelpTip } from './HelpTip';

export function FontSizeControl({ value, onValue, onStep, canGrow, canShrink, placeholder = '保持原样' }: {
  value?: number | null; onValue: (value: string) => void; onStep: (direction: 1 | -1) => void;
  canGrow: boolean; canShrink: boolean; placeholder?: string;
}) {
  return <div className="font-size-control">
    <div className="field-label">字号 <HelpTip text="输入磅数统一字号；A 按钮按中文字号逐级调整。混合字号按各自大小计算，未应用时累计净级数。小四 12 → 四号 14 → 小三 15 → 三号 16。" /></div>
    <div className="size-toolbar"><div className="unit-input"><input aria-label="字号" type="number" min={1} max={200} step={0.5} placeholder={placeholder} value={value ?? ''} onChange={e => onValue(e.target.value)} /><span>磅</span></div><button className="size-step" aria-label="增大一级字号" title="增大一级中文字号" disabled={!canGrow} onClick={() => onStep(1)}><b>A</b><ChevronUp size={12} /></button><button className="size-step" aria-label="缩小一级字号" title="缩小一级中文字号" disabled={!canShrink} onClick={() => onStep(-1)}><b>A</b><ChevronDown size={12} /></button></div>
  </div>;
}
