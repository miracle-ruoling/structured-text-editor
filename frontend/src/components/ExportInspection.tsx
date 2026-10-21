import { CheckCheck, Download, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ExportReport } from '../lib/types';
import { formatLabels, formatValue, sizeValues } from '../lib/types';

export function ExportInspection({ report, onClose }: { report: ExportReport; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [limit, setLimit] = useState(30);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${report.name.replace(/\.docx$/i, '')}_导出检查_r${report.revision}.json`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return <dialog ref={ref} className="export-dialog" onCancel={e => { e.preventDefault(); onClose(); }} onKeyDown={e => e.stopPropagation()} aria-labelledby="export-title">
    <header><div><span className="eyebrow">EXPORT INSPECTION</span><h2 id="export-title">导出检查</h2></div><button autoFocus className="icon-button" aria-label="关闭导出检查" onClick={onClose}><X size={20} /></button></header>
    <div className="export-report-body">
      <p className="report-document">{report.name} · 已保存版本 r{report.revision}</p>
      <p className="help-text">对实际生成的 Word 文件与原文件进行比较。未提交的草稿和预览不在本次报告中。</p>
      <div className="report-verification"><CheckCheck size={22} /><div><strong>{report.verified ? '文档保留检查通过' : '检查未通过'}</strong><p>原文件不覆盖 · 文字内容保留 · 操作范围外段落保留</p></div></div>
      <div className="report-metrics"><div><strong>{report.changed_paragraphs.length}</strong><span>实际变化段落 / {report.paragraph_count}</span></div><div><strong>{report.changed_parts.length}</strong><span>变化的包内文件</span></div><div><strong>{report.preserved_parts}</strong><span>原样保留的包内文件</span></div></div>
      <details className="report-standard"><summary>检查以什么为标准？</summary><p>以导入时保存的原 DOCX 和已应用的格式范围为准。允许指定段落的格式变化；文字、对象结构、范围外段落和其他包内文件应保留。检测到非预期变化时停止本次下载，原文件不受影响。</p><p>不以未提交草稿为准，也不检查审美或页数。格式变化导致 Word 重新分页属于正常结果。</p></details><h3>实际修改</h3>
      <p className="help-text">格式操作涉及 {report.planned_paragraph_count} 段；写入显式属性也可能不改变视觉效果。</p>
      {!report.changed_paragraphs.length && <p>没有需要写入的格式变化。</p>}
      <div className="report-changes">{report.changed_paragraphs.slice(0, limit).map(change => <details key={change.id}><summary><b>{change.id.toUpperCase()}</b><span>{change.text.slice(0, 90) || '空段落'}</span></summary><dl>{change.properties.map(property => <div key={property.key}><dt>{formatLabels[property.key] || property.key}</dt><dd>{property.key === 'size_pt' ? sizeValues(change.size_before) : formatValue(property.key, property.before)} → {property.key === 'size_pt' ? sizeValues(change.size_after) : formatValue(property.key, property.after)}</dd></div>)}</dl></details>)}</div>
      {report.changed_paragraphs.length > limit && <button className="secondary full" onClick={() => setLimit(limit + 30)}>再显示 30 段</button>}
      <h3>兼容性与显示边界</h3><ul>{[...report.warnings, ...report.limits].map((item, index) => <li key={index}>{item}</li>)}</ul>
      <details className="report-technical"><summary>文件校验信息</summary><p>变化文件：{report.changed_parts.join('、') || '无'}</p><p>原文件 SHA-256</p><code>{report.source_sha256}</code><p>导出文件 SHA-256</p><code>{report.output_sha256}</code></details>
    </div>
    <footer><button className="secondary" onClick={download}><Download size={15} />下载此报告</button><button className="primary" onClick={onClose}>关闭检查 · Esc</button></footer>
  </dialog>;
}
