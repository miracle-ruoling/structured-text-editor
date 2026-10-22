import type { Role } from './types.ts';

export const paragraphChoices: { label: string; role: Role; level?: number }[] = [
  { label: '正文', role: 'body' }, { label: '一级小标题', role: 'heading', level: 1 },
  { label: '二级小标题', role: 'heading', level: 2 }, { label: '三级小标题', role: 'heading', level: 3 },
  { label: '文档大标题', role: 'title' }, { label: '图表题注', role: 'caption' },
  { label: '引用', role: 'quote' }, { label: '代码', role: 'code' }, { label: '列表', role: 'list' },
  { label: '参考文献', role: 'reference' }, { label: '未分类', role: 'unclassified' },
];
export type TextOperation = { request_id?: string; action: 'replace' | 'split' | 'join' | 'delete' | 'category' | 'paste'; id: string; text?: string; draft?: string; offset?: number; end?: number; role?: Role; level?: number };

export function pasteCaret(text: string, offset: number) {
  const lines = text.split('\n');
  return [...lines[lines.length - 1]].length + (lines.length === 1 ? offset : 0);
}

export function selectedTextRange(element: HTMLElement): { offset: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return null;
  const prefix = range.cloneRange(); prefix.selectNodeContents(element);
  prefix.setEnd(range.startContainer, range.startOffset);
  const offset = [...prefix.toString()].length;
  return { offset, end: offset + [...range.toString()].length };
}

export function chooserKey(key: string, selected: number, composing: boolean) {
  if (composing) return { action: 'ignore', selected };
  if (/^[1-9]$/.test(key)) return { action: 'select', selected: Number(key) - 1 };
  if (key === '0') return { action: 'select', selected: 9 };
  if (key === 'ArrowRight' || key === 'ArrowLeft') return { action: 'select', selected: (selected + (key === 'ArrowRight' ? 1 : -1) + paragraphChoices.length) % paragraphChoices.length };
  if (key === 'Enter') return { action: 'confirm', selected };
  if (key === 'Escape') return { action: 'close', selected };
  return { action: 'type', selected };
}

export function caretOffset(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return 0;
  const range = selection.getRangeAt(0).cloneRange(); range.selectNodeContents(element);
  range.setEnd(selection.anchorNode!, selection.anchorOffset);
  return [...range.toString()].length;
}

export function focusText(element: HTMLElement, offset: number) {
  element.focus();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null; let remaining = offset;
  while ((node = walker.nextNode())) {
    const points = [...(node.textContent || '')];
    if (remaining <= points.length) {
      const range = document.createRange(); range.setStart(node, points.slice(0, remaining).join('').length); range.collapse(true);
      const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); return;
    }
    remaining -= points.length;
  }
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
  const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
}
