import { useEffect, useRef } from 'react';

type Props = { onCancel: () => void; onDiscard: () => void; message?: string };
export function DraftDialog({ onCancel, onDiscard, message }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="draft-dialog" onCancel={e => { e.preventDefault(); onCancel(); }} onKeyDown={e => e.stopPropagation()} aria-labelledby="draft-dialog-title">
    <h2 id="draft-dialog-title">还有未提交的内容</h2>
    <p>{message || '已应用的修改和标注已自动保存。切换文档会丢弃格式与模板草稿、预览、未提交的标注输入和未保存的筛选输入。'}</p>
    <div><button autoFocus className="primary" onClick={onCancel}>继续编辑</button><button className="secondary" onClick={onDiscard}>放弃草稿并切换</button></div>
  </dialog>;
}
