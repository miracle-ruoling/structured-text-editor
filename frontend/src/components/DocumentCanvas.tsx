import { Eye, FileSearch, Info, LockKeyhole, PanelLeftClose, ScanLine, Table2, Tag } from 'lucide-react';
import type { CSSProperties } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ObjectQuickMenu } from './ObjectQuickMenu';
import type { QuickMenuTarget } from './ObjectQuickMenu';
import type { Block, DocumentView, Format, FormatPatch, Layout, Preview, PreviewBlock } from '../lib/types';
import { roles } from '../lib/types';
import { paragraphInsets } from '../lib/workspace';
import { EditableParagraph } from './EditableParagraph';
import type { TextEditorProps } from './EditableParagraph';

type Props = {
  textEditor?: TextEditorProps;
  preventHide?: boolean;
  doc: DocumentView; matched: string[]; current: string | null; onPick: (id: string, extend: boolean) => void;
  preview: Preview | null; patch: FormatPatch; showTags: boolean; onShowTags: () => void;
  onlyMatches: boolean; onOnlyMatches: () => void; zoom: number; onZoom: (value: number) => void;
  livePreview?: boolean; previewPending?: boolean; previewError?: string | null; compare?: boolean; onCompare?: () => void;
  onExitPreview: () => void; selectionActive: boolean; busy: boolean;
  focusMuted?: boolean; onInspect: (id: string) => void; onAddCondition: (id: string) => void; onFormat: (id: string) => void;
};

function typography(format: Format): CSSProperties {
  const fonts = [format.font_latin, format.font_east_asia].filter(Boolean).map(font => `"${font!.replace(/["\\]/g, '')}"`);
  return {
    fontSize: format.size_pt ? `${format.size_pt}pt` : undefined,
    fontFamily: fonts.length ? [...fonts, 'serif'].join(',') : undefined,
    fontWeight: format.bold == null ? undefined : format.bold ? 700 : 400, fontStyle: format.italic == null ? undefined : format.italic ? 'italic' : 'normal',
    color: format.color || undefined,
  };
}

const EMPTY_PATCH: FormatPatch = {};
const ParagraphText = memo(function ParagraphText({ block, resolved = block, override = EMPTY_PATCH }: { block: Block; resolved?: PreviewBlock; override?: FormatPatch }) {
  const format = { ...resolved.format, ...override };
  const style: CSSProperties = {
    ...typography(format), ...paragraphInsets(format),
    lineHeight: format.line_spacing ?? (format.line_spacing_pt ? `${format.line_spacing_pt}pt` : undefined),
    textAlign: format.alignment === 'both' ? 'justify' : format.alignment as CSSProperties['textAlign'],
    marginTop: `${format.space_before_pt ?? 0}pt`, marginBottom: `${format.space_after_pt ?? 4}pt`,
  };
  return <p className="paragraph-text" style={style}>{resolved.runs.length ? resolved.runs.map((run, index) => <span key={index} style={typography({ ...run.format, ...override })}>{run.text}</span>) : <span className="empty-paragraph">{block.features.length ? '' : '空段落'}</span>}</p>;
});

export function DocumentCanvas({ doc, matched, current, onPick, preview, patch, showTags, onShowTags, onlyMatches, onOnlyMatches, zoom, onZoom, onExitPreview, selectionActive, busy, onInspect, onAddCondition, onFormat, textEditor, preventHide = false, focusMuted = false, livePreview = false, previewPending = false, previewError = null, compare = true, onCompare }: Props) {
  const [menu, setMenu] = useState<QuickMenuTarget | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useEffect(() => { setMenu(null); }, [doc.id, doc.revision, busy]);
  const afterById = useMemo(() => new Map(preview?.after_blocks?.map(block => [block.id, block]) || []), [preview]);
  const byId = useMemo(() => new Map(doc.blocks.map(block => [block.id, block])), [doc]);
  const matchSet = useMemo(() => new Set(matched), [matched]);
  const previewSet = useMemo(() => new Set(preview?.ids || []), [preview]);
  function isVisible(node: Layout): boolean {
    if (!onlyMatches || preventHide) return true;
    if (node.kind === 'paragraph') return matchSet.has(node.id);
    if (node.kind === 'table') return node.rows.some(row => row.some(cell => cell.children.some(isVisible)));
    return node.children.some(isVisible);
  }
  function paragraph(block: Block) {
    const category = block.role === 'heading' && block.outline_level != null && block.outline_level < 3
      ? `${['一', '二', '三'][block.outline_level]}级小标题` : roles[block.role];
    const pending = previewSet.has(block.id);
    const after = afterById.get(block.id);
    const textView = (changed = false) => block.text_editable && textEditor && !pending
      ? <EditableParagraph block={block} busy={busy} {...textEditor} />
      : <ParagraphText block={block} resolved={changed && after ? after : block} override={changed && !after ? patch : EMPTY_PATCH} />;
    return <div key={block.id} id={`block-${block.id}`} role="button" tabIndex={0}
      aria-label={`${block.id.toUpperCase()} ${roles[block.role]}：${block.text.slice(0, 40) || '空段落'}`} aria-pressed={matchSet.has(block.id)}
      onContextMenu={e => { if (!busy) { e.preventDefault(); setMenu({ id: block.id, x: e.clientX, y: e.clientY, anchor: e.currentTarget }); } }}
      onClick={e => { if (!busy) onPick(block.id, e.ctrlKey || e.metaKey); }}
      onKeyDown={e => {
        if (busy || e.target !== e.currentTarget) return;
        if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault(); const box = e.currentTarget.getBoundingClientRect();
          setMenu({ id: block.id, x: box.left + 20, y: box.top + 20, anchor: e.currentTarget }); return;
        }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(block.id, e.ctrlKey || e.metaKey); }
      }}
      className={`document-block ${block.role} ${matchSet.has(block.id) ? 'matched' : ''} ${current === block.id ? (focusMuted ? 'focused focus-muted' : 'focused') : ''} ${pending ? (livePreview && !compare ? 'pending live-pending' : 'pending') : ''} ${!block.editable ? 'locked' : ''}`}>
      <span className="block-index" title="选择此段作为操作范围">{block.id.slice(1).padStart(2, '0')}</span>
      <div className="block-content">
      {showTags && <div className="block-labels"><span className={`role-badge ${block.role}`} title={`${block.confirmed ? '手动设置' : '自动识别'} · ${block.role_source}`}>{category}</span>{block.tags.map(tag => <span className={`tag-badge ${tag === '保留原格式' ? 'protected' : ''}`} key={tag}><Tag size={9} />{tag}</span>)}{(!block.editable || (doc.text_editing && !block.text_editable)) && <span className="locked-badge"><LockKeyhole size={10} />{block.editable ? '文字只读' : '仅查看'}</span>}{pending && <span className="pending-label">预览中</span>}</div>}
      {pending && (!livePreview || compare) ? <div className="paragraph-comparison"><div className="comparison-before"><span className="comparison-label">修改前</span>{textView()}</div><div className="comparison-after"><span className="comparison-label">预览后 · 尚未应用</span>{textView(true)}</div></div> : textView(pending)}
      {block.features.map(feature => <div className="feature-placeholder" key={feature}><ScanLine size={14} />{feature}</div>)}
      </div>
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
    <div className="canvas-toolbar"><div><span className="active-view" title="直接点击选择段落；Ctrl 点击增删同一组。已有自定义筛选时，普通点击仅查看，Ctrl 点击切换该段是否选中。"><FileSearch size={15} />结构视图</span></div><div className="view-actions"><button aria-pressed={showTags} title="显示或隐藏类别与标签" onClick={onShowTags}><Tag size={14} /><span>标记</span></button><button aria-pressed={onlyMatches} title="只显示匹配的段落" disabled={!selectionActive} onClick={onOnlyMatches}><PanelLeftClose size={14} /><span>仅匹配</span></button><select aria-label="文档缩放" value={zoom} onChange={e => onZoom(Number(e.target.value))}>{[80, 90, 100, 110, 125].map(value => <option key={value} value={value}>{value}%</option>)}</select></div></div>
    {(preview || (livePreview && (previewPending || previewError))) && <div className={`preview-banner ${previewPending || previewError ? 'preview-stale' : ''}`}><Eye size={16} /><span><strong>{previewError ? '预览未完成' : previewPending ? '预览更新中…' : '预览 · 未应用'}</strong>{preview && (previewPending || previewError) ? ' · 当前仍为上次效果' : preview ? ` · ${preview.ids.length} 段` : ''}</span>{livePreview && <button className="text-button" aria-pressed={compare} onClick={onCompare} title="切换原文与结果的上下对照">{compare ? '关闭原文对照' : '对照原文'}</button>}<button className="secondary" disabled={busy} onClick={onExitPreview}>{livePreview ? '取消修改 · Esc' : '退出预览 · Esc'}</button></div>}
    <div className="canvas-scroll">
      <div className="reading-note"><Info size={13} /><span title="缩进按屏幕宽度适配；字体替代与精确分页以 Word 为准。">近似排版</span>{doc.warnings.length > 0 && <details className="warnings"><summary>{doc.warnings.length} 项说明</summary><div>{doc.warnings.map(w => <p key={w}>{w}</p>)}</div></details>}</div>
      {onlyMatches && !matched.length && !preventHide ? <div className="empty-state"><FileSearch size={32} /><h3>没有匹配的段落</h3><p>调整右侧条件，或关闭「仅匹配」查看完整文档。</p></div> : <article className="document-paper" style={{ zoom: zoom / 100 }} aria-label="文档结构阅读区"><div className="paper-eyebrow"><span>DOCUMENT</span><span>{doc.blocks.length} 段 · 可见的结构</span></div>{render(doc.layout)}<div className="paper-end"><span />文档结束<span /></div></article>}
    </div>
    {menu && byId.has(menu.id) && <ObjectQuickMenu block={byId.get(menu.id)!} target={menu} onClose={closeMenu} onPick={onInspect} onFormat={onFormat} onAddCondition={onAddCondition} />}
  </main>;
}
