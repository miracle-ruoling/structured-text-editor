import type { SizeChange } from '../lib/types';

export function FontSizeControl({ value, onValue, relative = null, onRelative }: {
  value?: number | null; onValue: (value: string) => void; relative?: SizeChange | null; onRelative?: (value: SizeChange | null) => void;
}) {
  return <div className="font-size-control">
    {onRelative && <label className="field"><span>字号方式</span><select aria-label="字号方式" value={relative?.mode || 'absolute'} onChange={e => {
      onValue(''); onRelative(e.target.value === 'absolute' ? null : { mode: e.target.value as SizeChange['mode'], amount: 1 });
    }}><option value="absolute">统一指定字号</option><option value="points">按各自字号增减磅数</option><option value="chinese_steps">按中文字号增减级数</option></select></label>}
    {relative && onRelative ? <>
      <label className="field"><span>字号增减（正数放大，负数缩小）</span><div className="unit-input"><input aria-label="字号增减" type="number" min={relative.mode === 'chinese_steps' ? -15 : -100} max={relative.mode === 'chinese_steps' ? 15 : 100} step={relative.mode === 'chinese_steps' ? 1 : 0.5} value={relative.amount || ''} placeholder="输入增减值" onChange={e => onRelative({ ...relative, amount: Number(e.target.value) })} /><span>{relative.mode === 'points' ? '磅' : '级'}</span></div></label>
      <div className="quick-values"><button onClick={() => onRelative({ ...relative, amount: 1 })}>{relative.mode === 'points' ? '+1 磅' : '增大一级'}</button><button onClick={() => onRelative({ ...relative, amount: -1 })}>{relative.mode === 'points' ? '−1 磅' : '缩小一级'}</button></div>
      <p className="help-text">按当前每个文字片段分别计算，不先统一字号。未知或越界时整次不执行。</p>
      {relative.mode === 'chinese_steps' && <details className="size-sequence"><summary>中文字号顺序与非标准字号</summary><p>八号 5 → 七号 5.5 → 小六 6.5 → 六号 7.5 → 小五 9 → 五号 10.5 → 小四 12 → 四号 14 → 小三 15 → 三号 16 → 小二 18 → 二号 22 → 小一 24 → 一号 26 → 小初 36 → 初号 42（磅）</p><p>13 磅增一级到 14、减一级到 12；直接取对应方向的下一档。</p></details>}
    </> : <>
      <label className="field"><span>字号</span><div className="unit-input"><input aria-label="字号" type="number" min={1} max={200} step={0.5} placeholder="保持原样" value={value ?? ''} onChange={e => onValue(e.target.value)} /><span>磅</span></div></label>
      <div className="size-presets">{[[10.5, '五号'], [12, '小四'], [14, '四号'], [15, '小三'], [16, '三号'], [18, '小二']].map(([size, label]) => <button key={size} className={value === size ? 'chosen' : ''} onClick={() => onValue(String(size))}>{label}<span>{size}</span></button>)}</div>
    </>}
  </div>;
}
