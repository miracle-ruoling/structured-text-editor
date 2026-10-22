import assert from 'node:assert/strict';
import test from 'node:test';
import { projectText, TextQueue } from '../src/lib/textQueue.ts';
import type { Block, DocumentView } from '../src/lib/types.ts';
import type { TextOperation } from '../src/lib/textEditing.ts';

const block = { id: 'p1', text: '甲😀乙', text_editable: true, role: 'body', format: {}, runs: [{ text: '甲😀乙', format: { bold: true } }] } as Block;
const initial = { id: 'doc', revision: 1, next_paragraph: 8, blocks: [block], layout: [{ kind: 'paragraph', id: 'p1' }] } as DocumentView;
const texts = (doc: DocumentView) => doc.blocks.map(b => [b.id, b.text]);
const saved = (doc: DocumentView, op: TextOperation) => ({ ...projectText(doc, op), revision: doc.revision + 1 });

test('回车和多段粘贴在同容器预留单调 ID，Unicode 偏移不拆代理对', () => {
  const doc = { ...initial, layout: [{ kind: 'table', rows: [[{ span: 1, children: initial.layout }]] }] } as DocumentView;
  const value = projectText(doc, { action: 'paste', id: 'p1', offset: 1, end: 2, text: '一\n\n二' });
  assert.deepEqual(texts(value), [['p1', '甲一'], ['p8', ''], ['p9', '二乙']]);
  assert.equal(value.next_paragraph, 10);
  assert.deepEqual(value.blocks.at(-1)?.runs.at(-1), { text: '乙', format: { bold: true } });
  assert.equal(value.layout[0].kind, 'table');
  assert.deepEqual(texts(initial), [['p1', '甲😀乙']]);
});

test('软换行不增加段落；拆分可携带尚未保存的草稿', () => {
  const value = projectText(initial, { action: 'split', id: 'p1', offset: 2, draft: '新😀\n正文' });
  assert.deepEqual(texts(value), [['p1', '新😀'], ['p8', '\n正文']]);
  assert.equal(value.blocks[1].role, 'body');
});

test('延迟响应期间连续拆分、类别及输入立即可见，确认不会回退后续输入', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: [number, string][] = [];
  const published: DocumentView[] = [];
  const queue = new TextQueue(initial, async (doc, op) => {
    calls.push([doc.revision, op.action]); await gate; return saved(doc, op);
  }, doc => published.push(doc));
  queue.enqueue({ action: 'split', id: 'p1', offset: 2 });
  queue.enqueue({ action: 'category', id: 'p8', role: 'heading', level: 2 });
  queue.enqueue({ action: 'split', id: 'p8', offset: 2, draft: '继续输入' });
  queue.enqueue({ action: 'replace', id: 'p9', text: '尾部' });
  assert.deepEqual(texts(queue.view), [['p1', '甲😀'], ['p8', '继续'], ['p9', '尾部']]);
  assert.deepEqual(calls, [[1, 'split']]);
  const start = published.length;
  release(); assert.equal(await queue.flush(), true);
  assert.deepEqual(calls.map(c => c[0]), [1, 2, 3, 4]);
  assert.ok(published.slice(start).every(doc => doc.blocks.at(-1)?.text === '尾部'));
});

test('失败阻断后续请求、保留本地事务，重试沿用原请求 ID 与 revision', async () => {
  const calls: [number, TextOperation][] = [];
  let fail = true;
  const queue = new TextQueue(initial, async (doc, op) => {
    calls.push([doc.revision, op]); if (fail) throw new Error('断连'); return saved(doc, op);
  }, () => {});
  queue.enqueue({ action: 'split', id: 'p1', offset: 1 });
  assert.equal(await queue.flush(), false);
  queue.enqueue({ action: 'replace', id: 'p8', text: '断连后的输入' });
  assert.equal(calls.length, 1);
  assert.equal(queue.view.blocks[1].text, '断连后的输入');
  fail = false; assert.equal(await queue.retry(), true);
  assert.deepEqual(calls[0], calls[1]);
  assert.notEqual(calls[1][1].request_id, calls[2][1].request_id);
});

test('历史后的分配器不回退；只读结构或无效偏移不能进入队列', () => {
  assert.equal(projectText({ ...initial, next_paragraph: 99 }, { action: 'split', id: 'p1', offset: 0 }).edit_focus, 'p99');
  assert.throws(() => projectText(initial, { action: 'split', id: 'p1', offset: 99 }));
  assert.throws(() => projectText({ ...initial, blocks: [{ ...block, text_editable: false }] }, { action: 'split', id: 'p1', offset: 0 }));
});

test('响应丢失后通过同一回执恢复，不重复创建段落，后续请求使用确认版本', async () => {
  let receipt: DocumentView | undefined;
  let receiptId: string | undefined;
  let commits = 0;
  const queue = new TextQueue(initial, async (doc, op) => {
    if (op.request_id === receiptId) return receipt!;
    const result = saved(doc, op); commits++;
    if (!receipt) { receipt = result; receiptId = op.request_id; throw new Error('响应丢失'); }
    return result;
  }, () => {});
  queue.enqueue({ action: 'split', id: 'p1', offset: 1 });
  await queue.flush();
  queue.enqueue({ action: 'replace', id: 'p8', text: '后续文字' });
  assert.equal(await queue.retry(), true);
  assert.equal(commits, 2);
  assert.equal(queue.view.revision, 3);
  assert.deepEqual(texts(queue.view), [['p1', '甲'], ['p8', '后续文字']]);
});

test('版本冲突保留本地视图并阻断后续结构请求', async () => {
  let requests = 0;
  const queue = new TextQueue(initial, async () => { requests++; throw new Error('版本冲突'); }, () => {});
  queue.enqueue({ action: 'split', id: 'p1', offset: 1 });
  await queue.flush();
  queue.enqueue({ action: 'split', id: 'p8', offset: 0 });
  assert.equal(await queue.flush(), false);
  assert.equal(requests, 1);
  assert.equal(queue.view.blocks.length, 3);
});

test('非法控制字符与超长输入在入队前拒绝，避免阻塞后续合法保存', () => {
  const queue = new TextQueue(initial, async (doc, op) => saved(doc, op), () => {});
  assert.throws(() => queue.enqueue({ action: 'split', id: 'p1', offset: 0, draft: '\x00' }));
  assert.throws(() => queue.enqueue({ action: 'paste', id: 'p1', offset: 0, end: 0, text: 'a'.repeat(100000) }));
  assert.equal(queue.pending, false);
  assert.equal(queue.view, initial);
});
