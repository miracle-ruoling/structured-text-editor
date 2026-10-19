import { useEffect, useRef } from 'react';

type Props = { onCancel: () => void; onDiscard: () => void; objectOnly: boolean };
export function DraftDialog({ onCancel, onDiscard, objectOnly }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className="draft-dialog" onCancel={e => { e.preventDefault(); onCancel(); }} onKeyDown={e => e.stopPropagation()} aria-labelledby="draft-dialog-title">
    <h2 id="draft-dialog-title">还有未提交的内容</h2>
    <p>{objectOnly ? '当前标签还没有添加。切换对象会丢弃正在输入的标签；已保存的标注不受影响。' : '已应用的修改和标注已自动保存。切换文档会丢弃格式草稿、预览、未添加的标签和未保存的筛选名称。'}</p>
    <div><button autoFocus className="primary" onClick={onCancel}>继续编辑</button><button className="secondary" onClick={onDiscard}>放弃草稿并切换</button></div>
  </dialog>;
}
