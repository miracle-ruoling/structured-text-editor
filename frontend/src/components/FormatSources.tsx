import type { Block } from '../lib/types';
import { formatLabels, formatValue } from '../lib/types';

export function FormatSources({ block, busy, onClear }: { block: Block; busy: boolean; onClear: (id: string, keys: string[]) => void }) {
  const overrides = Object.keys(block.overrides);
  return <div className="source-section">
    <div className="section-heading"><span>当前格式与来源</span></div>
    {!!overrides.length && <button className="secondary full" disabled={busy || !block.editable} onClick={() => onClear(block.id, overrides)}>清除此段全部局部覆盖（{overrides.length} 项）</button>}
    <div className="format-sources">{Object.entries(block.format).map(([key, value]) => {
      const traceKey = ({ first_line_pt: 'first_line_chars', line_spacing_pt: 'line_spacing' } as Record<string, string>)[key] || key;
      const layers = block.format_trace?.[traceKey] || [];
      return <div key={key}>
        <div><span>{formatLabels[key] || key}</span><strong>{block.mixed.includes(key) ? '混合格式' : formatValue(key, value)}</strong></div>
        <p>{block.format_sources[key] || '原文档 / 未完整解析'}</p>
        {layers.length > 1 && <details className="format-trace"><summary>来源叠加 · {layers.length} 层</summary><ol>{layers.map((layer, index) => <li className={index === layers.length - 1 ? 'winning-layer' : ''} key={`${layer.kind}-${index}`}><span>{layer.label}{index === layers.length - 1 ? ' · 当前生效' : ' · 被覆盖'}</span><b>{layer.mixed ? '混合文字格式' : formatValue(layer.key, layer.value)}</b></li>)}</ol></details>}
        {overrides.includes(key) && <button className="text-button clear-override" disabled={busy || !block.editable} onClick={() => onClear(block.id, [key])}>清除此项局部覆盖</button>}
      </div>;
    })}</div>
    <p className="help-text">清除只影响本项目的局部设置（包括已应用的模板），恢复原文档对应格式。原 Word 中的直接格式保留。</p>
  </div>;
}
