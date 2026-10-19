import { Eye, FileSearch, Info, LockKeyhole, PanelLeftClose, ScanLine, Table2, Tag } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import type { Block, DocumentView, Format, FormatPatch, Layout, Preview } from '../lib/types';
import { roles } from '../lib/types';

type Props = { doc: DocumentView; matched: string[]; current: string | null; onPick: (id: string) => void; preview: Preview | null; patch: FormatPatch; showTags: boolean; onShowTags: () => void; onlyMatches: boolean; onOnlyMatches: () => void; zoom: number; onZoom: (value: number) => void; };

function typography(format: Format): CSSProperties {
  const fonts = [format.font_latin, format.font_east_asia].filter(Boolean).map(font => `"${font!.replace(/["\\]/g, '')}"`);
  return {
    fontSize: format.size_pt ? `${format.size_pt}pt` : undefined,
    fontFamily: fonts.length ? [...fonts, 'serif'].join(',') : undefined,
    fontWeight: format.bold ? 700 : undefined, fontStyle: format.italic ? 'italic' : undefined,
    color: format.color || undefined,
  };
}

export function DocumentCanvas({ doc, matched, current, onPick, preview, patch, showTags, onShowTags, onlyMatches, onOnlyMatches, zoom, onZoom }: Props) {
  const byId = useMemo(() => new Map(doc.blocks.map(block => [block.id, block])), [doc]);
  const matchSet = useMemo(() => new Set(matched), [matched]);
  const previewSet = useMemo(() => new Set(preview?.ids || []), [preview]);
  function isVisible(node: Layout): boolean {
    if (!onlyMatches) return true;
    if (node.kind === 'paragraph') return matchSet.has(node.id);
    if (node.kind === 'table') return node.rows.some(row => row.some(cell => cell.children.some(isVisible)));
    return node.children.some(isVisible);
  }
  function paragraph(block: Block) {
    const pending = previewSet.has(block.id);
    const override = pending ? patch : {};
    const format = { ...block.format, ...override };
    const indent = format.first_line_chars != null ? `${format.first_line_chars}em` : format.first_line_pt != null ? `${format.first_line_pt}pt` : undefined;
    const style: CSSProperties = {
      ...typography(format), textIndent: indent,
      lineHeight: format.line_spacing ?? (format.line_spacing_pt ? `${format.line_spacing_pt}pt` : undefined),
      textAlign: format.alignment === 'both' ? 'justify' : format.alignment as CSSProperties['textAlign'],
      marginTop: `${format.space_before_pt ?? 0}pt`, marginBottom: `${format.space_after_pt ?? 4}pt`,
    };
    return <div key={block.id} id={`block-${block.id}`} role="button" tabIndex={0} aria-label={`${block.id.toUpperCase()} ${roles[block.role]}：${block.text.slice(0, 40) || '空段落'}`} onClick={() => onPick(block.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(block.id); } }} className={`document-block ${block.role} ${matchSet.has(block.id) ? 'matched' : ''} ${current === block.id ? 'focused' : ''} ${pending ? 'pending' : ''} ${!block.editable ? 'locked' : ''}`}>
      <span className="block-index">{block.id.slice(1).padStart(2, '0')}</span>
      {showTags && <div className="block-labels"><span className={`role-badge ${block.role}`} title={`${block.confirmed ? '手动分类' : '自动分类建议'} · ${block.role_source}`}>{roles[block.role]}</span>{block.tags.map(tag => <span className={`tag-badge ${tag === '保留原格式' ? 'protected' : ''}`} key={tag}><Tag size={9} />{tag}</span>)}{!block.editable && <span className="locked-badge"><LockKeyhole size={10} />仅查看</span>}{pending && <span className="pending-label">预览中</span>}</div>}
      <p className="paragraph-text" style={style}>{block.runs.length ? block.runs.map((run, index) => <span key={index} style={typography({ ...run.format, ...override })}>{run.text}</span>) : <span className="empty-paragraph">{block.features.length ? '' : '空段落'}</span>}</p>
      {block.features.map(feature => <div className="feature-placeholder" key={feature}><ScanLine size={14} />{feature}</div>)}
    </div>;
  }
  function render(nodes: Layout[], prefix = ''): React.ReactNode {
    return nodes.filter(isVisible).map((node, index) => {
      if (node.kind === 'paragraph') { const block = byId.get(node.id); return block ? paragraph(block) : null; }
      if (node.kind === 'unsupported') return <div className="unsupported-node" key={`${prefix}-${index}`}><span><LockKeyhole size={12} />{node.label}</span>{render(node.children, `${prefix}-${index}`)}</div>;
      return <div className="document-table" key={`${prefix}-${index}`}><div className="table-label"><Table2 size={12} />表格 <span>独立结构范围</span></div><table><tbody>{node.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c} colSpan={cell.span}>{render(cell.children, `${prefix}-${r}-${c}`)}</td>)}</tr>)}</tbody></table></div>;
    });
  }
  return <main className="canvas-area">
    <div className="canvas-heading"><div className="breadcrumb"><span>文档空间</span><span>/</span><strong>{doc.name}</strong></div><span className="view-mode"><span className="status-dot" />本地工作区</span></div>
    <div className="canvas-toolbar"><div><span className="active-view"><FileSearch size={15} />结构视图</span><span className="view-description">让每次修改都有明确的范围</span></div><div className="view-actions"><button aria-pressed={showTags} title="显示或隐藏类别与标签" onClick={onShowTags}><Tag size={14} /><span>标记</span></button><button aria-pressed={onlyMatches} title="只显示匹配的段落" onClick={onOnlyMatches}><PanelLeftClose size={14} /><span>仅匹配</span></button><select aria-label="文档缩放" value={zoom} onChange={e => onZoom(Number(e.target.value))}>{[80, 90, 100, 110, 125].map(value => <option key={value} value={value}>{value}%</option>)}</select></div></div>
    {preview && <div className="preview-banner"><Eye size={16} /><span><strong>正在预览</strong> · {preview.ids.length} 个段落的格式变化，尚未应用</span></div>}
    <div className="canvas-scroll">
      <div className="reading-note"><Info size={13} /><span>结构阅读视图 · Word 中的分页和复杂对象以导出文件为准</span>{doc.warnings.length > 0 && <details className="warnings"><summary>{doc.warnings.length} 项说明</summary><div>{doc.warnings.map(w => <p key={w}>{w}</p>)}</div></details>}</div>
      {onlyMatches && !matched.length ? <div className="empty-state"><FileSearch size={32} /><h3>没有匹配的段落</h3><p>调整右侧条件，或关闭「仅匹配」查看完整文档。</p></div> : <article className="document-paper" style={{ zoom: zoom / 100 }} aria-label="文档结构阅读区"><div className="paper-eyebrow"><span>DOCUMENT</span><span>{doc.blocks.length} 段 · 可见的结构</span></div>{render(doc.layout)}<div className="paper-end"><span />文档结束<span /></div></article>}
    </div>
  </main>;
}
