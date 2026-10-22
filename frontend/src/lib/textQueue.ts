import type { Block, DocumentView, Layout } from './types.ts';
import type { TextOperation } from './textEditing.ts';

type Runs = Block['runs'];
function slice(runs: Runs, start: number, end: number): Runs {
  let position = 0;
  return runs.flatMap(run => {
    const points = [...run.text];
    const text = points.slice(Math.max(0, start - position), Math.max(0, end - position)).join('');
    position += points.length;
    return text ? [{ ...run, text }] : [];
  });
}
function replace(block: Block, text: string): Block {
  const old = [...block.text], next = [...text];
  let start = 0, suffix = 0;
  while (start < Math.min(old.length, next.length) && old[start] === next[start]) start++;
  while (suffix < Math.min(old.length, next.length) - start && old[old.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
  const before = slice(block.runs, 0, start);
  return { ...block, text, runs: [...before,
    { text: next.slice(start, next.length - suffix).join(''), format: before.at(-1)?.format || block.runs[0]?.format || block.format },
    ...slice(block.runs, old.length - suffix, old.length)].filter(run => run.text) };
}
function category(block: Block, role = 'body' as Block['role'], level?: number): Block {
  const format = { ...block.format, size_pt: role === 'title' ? 24 : role === 'heading' ? [18, 15, 13][(level || 1) - 1] : 12,
    bold: role === 'title' || role === 'heading', alignment: role === 'title' ? 'center' : 'left', keep_next: role === 'title' || role === 'heading' };
  return { ...block, role, format, confirmed: true, outline_level: role === 'heading' ? (level || 1) - 1 : 9,
    numbering: null, overrides: {}, runs: [{ text: block.text, format }] };
}
function insert(nodes: Layout[], id: string, added: string[]): Layout[] {
  return nodes.flatMap((node): Layout[] => {
    if (node.kind === 'paragraph') return node.id === id ? [node, ...added.map(id => ({ kind: 'paragraph' as const, id }))] : [node];
    if (node.kind === 'table') return [{ ...node, rows: node.rows.map(row => row.map(cell => ({ ...cell, children: insert(cell.children, id, added) }))) }];
    return [{ ...node, children: insert(node.children, id, added) }];
  });
}

// Provisional IDs are taken from the server's monotonic allocator. Revision checks
// make allocation exclusive: a conflict stops the queue rather than remapping live editors.
export function projectText(doc: DocumentView, op: TextOperation): DocumentView {
  for (const value of [op.text, op.draft]) {
    if (value === undefined) continue;
    if ([...value].length > 100000) throw new Error('正文最多支持 100,000 字符');
    if ([...value].some(c => {
      const point = c.codePointAt(0)!;
      return c !== '\n' && c !== '\t' && (point < 32 || (point >= 0xD800 && point <= 0xDFFF) || point === 0xFFFE || point === 0xFFFF);
    })) throw new Error('正文包含不支持的控制字符');
  }
  const index = doc.blocks.findIndex(b => b.id === op.id);
  const original = doc.blocks[index];
  if (!original?.text_editable) throw new Error('该段文字只读');
  let block = op.draft === undefined ? original : replace(original, op.draft);
  let next = doc.next_paragraph!;
  let blocks: Block[];
  if (op.action === 'replace') blocks = [replace(block, op.text || '')];
  else if (op.action === 'category') blocks = [category(block, op.role, op.level)];
  else if (op.action === 'split' || op.action === 'paste') {
    const points = [...block.text], offset = op.offset!, end = op.action === 'split' ? offset : op.end!;
    if (offset < 0 || end < offset || end > points.length) throw new Error('编辑位置超出段落');
    const lines = op.action === 'split' ? ['', ''] : (op.text || '').split('\n');
    if (op.action === 'paste' && points.length - (end - offset) + [...(op.text || '')].length > 100000) throw new Error('本次粘贴文字过长，最多支持 100,000 字符');
    if (doc.blocks.length + lines.length - 1 > 20000) throw new Error('最多支持 20,000 段');
    const runs = [...slice(block.runs, 0, offset), { text: lines[0], format: block.format }];
    blocks = [{ ...block, text: points.slice(0, offset).join('') + lines[0], runs }];
    for (const line of lines.slice(1)) {
      blocks.push(category({ ...block, id: `p${next++}`, text: line, tags: [], features: [], mixed: [],
        format: {}, format_sources: {}, format_trace: {}, overrides: {}, runs: [], style_id: '', style_name: '' }, op.action === 'split' ? op.role : 'body', op.level));
    }
    const last = blocks[blocks.length - 1];
    last.text += points.slice(end).join('');
    // Split's new category resets run formatting; paste preserves the untouched suffix.
    last.runs = op.action === 'split' ? [{ text: last.text, format: last.format }]
      : [...last.runs, ...slice(block.runs, end, points.length)];
  } else throw new Error('此动作需要先完成后台保存');
  return { ...doc, next_paragraph: next, edit_focus: blocks.at(-1)!.id,
    blocks: [...doc.blocks.slice(0, index), ...blocks, ...doc.blocks.slice(index + 1)],
    layout: blocks.length > 1 ? insert(doc.layout, op.id, blocks.slice(1).map(b => b.id)) : doc.layout };
}

type Entry = { operation: TextOperation; revision?: number };
export class TextQueue {
  private entries: Entry[] = [];
  private running: Promise<void> | null = null;
  error: Error | null = null;
  view: DocumentView;
  private base: DocumentView;
  private send: (doc: DocumentView, operation: TextOperation) => Promise<DocumentView>;
  private publish: (view: DocumentView, pending: boolean, error: Error | null) => void;
  constructor(base: DocumentView,
    send: (doc: DocumentView, operation: TextOperation) => Promise<DocumentView>,
    publish: (view: DocumentView, pending: boolean, error: Error | null) => void) {
    this.view = this.base = base; this.send = send; this.publish = publish;
  }
  get pending() { return this.entries.length > 0; }
  enqueue(operation: TextOperation) {
    const view = projectText(this.view, operation); // Validate before accepting the local transaction.
    this.entries.push({ operation: { ...operation, request_id: crypto.randomUUID() } });
    this.view = view;
    this.publish(view, true, this.error);
    if (!this.error) void this.flush();
    return view;
  }
  async flush(): Promise<boolean> {
    if (!this.running && !this.error && this.pending) {
      this.running = this.drain().finally(() => { this.running = null; });
    }
    await this.running;
    return !this.pending;
  }
  async retry() { this.error = null; this.publish(this.view, true, null); return this.flush(); }
  private async drain() {
    while (this.entries.length && !this.error) {
      const entry = this.entries[0];
      entry.revision ??= this.base.revision;
      try {
        const saved = await this.send({ ...this.base, revision: entry.revision }, entry.operation);
        const expected = projectText(this.base, entry.operation);
        if (saved.next_paragraph !== expected.next_paragraph || saved.edit_focus !== expected.edit_focus) {
          throw new Error('段落标识不一致，已停止保存；请下载本地文字');
        }
        this.base = saved;
        this.entries.shift();
        this.view = this.entries.reduce((doc, item) => projectText(doc, item.operation), saved);
        this.publish(this.view, this.pending, null);
      } catch (error) {
        this.error = error instanceof Error ? error : new Error('保存失败');
        this.publish(this.view, true, this.error);
      }
    }
  }
}
