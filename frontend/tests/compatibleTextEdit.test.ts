import assert from 'node:assert/strict';
import test from 'node:test';
import { createTextEditSender } from '../src/lib/compatibleTextEdit.ts';
import type { DocumentView } from '../src/lib/types.ts';
import type { TextOperation } from '../src/lib/textEditing.ts';

const document = { id: 'doc', revision: 1, blocks: [{ id: 'p1', text: '' }] } as DocumentView;
const unsupported = new Error('old schema');

test('旧后端拒绝 draft 后先保存纯数字，再用新版本号拆分；后续不重复探测', async () => {
  const calls: { revision: number; operation: TextOperation }[] = [];
  const send = createTextEditSender(async (doc, operation) => {
    calls.push({ revision: doc.revision, operation });
    if (operation.draft !== undefined) throw unsupported;
    return { ...doc, revision: doc.revision + 1 };
  }, error => error === unsupported);
  const saved: number[] = [];
  const result = await send(document, { action: 'split', id: 'p1', offset: 3, draft: '123' }, doc => saved.push(doc.revision));
  assert.equal(result.revision, 3);
  assert.deepEqual(saved, [2]);
  assert.deepEqual(calls.map(c => [c.revision, c.operation.action, c.operation.draft]), [[1, 'split', '123'], [1, 'replace', undefined], [2, 'split', undefined]]);
  assert.equal(calls[1].operation.text, '123');
  calls.length = 0;
  await send(result, { action: 'paste', id: 'p1', offset: 3, end: 3, text: '\n456', draft: '123' });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(c => c.operation.draft === undefined));
});

test('新版只发送一次结构请求；网络错误或冲突不重放操作', async () => {
  let count = 0;
  const send = createTextEditSender(async doc => { count++; return { ...doc, revision: 2 }; }, () => false);
  await send(document, { action: 'split', id: 'p1', offset: 3, draft: '123' });
  assert.equal(count, 1);
  const network = new Error('network');
  const failed = createTextEditSender(async () => { count++; throw network; }, error => error === unsupported);
  await assert.rejects(failed(document, { action: 'split', id: 'p1', offset: 3, draft: '123' }), error => error === network);
  assert.equal(count, 2);
});

test('旧后端保存成功而拆分失败时保留已保存版本，重试不重复改字', async () => {
  let current = document;
  const calls: TextOperation[] = [];
  const structureError = new Error('split failed');
  const send = createTextEditSender(async (doc, operation) => {
    calls.push(operation);
    if (operation.draft !== undefined) throw unsupported;
    if (operation.action === 'split') throw structureError;
    return { ...doc, revision: 2, blocks: [{ ...doc.blocks[0], text: operation.text! }] };
  }, error => error === unsupported);
  const op: TextOperation = { action: 'split', id: 'p1', offset: 3, draft: '123' };
  await assert.rejects(send(current, op, doc => { current = doc; }), error => error === structureError);
  assert.equal(current.revision, 2);
  assert.equal(current.blocks[0].text, '123');
  calls.length = 0;
  await assert.rejects(send(current, op), error => error === structureError);
  assert.deepEqual(calls, [{ action: 'split', id: 'p1', offset: 3 }]);
});
