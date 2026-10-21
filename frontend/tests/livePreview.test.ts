import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyFormatDraft, fieldCount, formatDraftError, inputSize, requestKey, stepSize } from '../src/lib/formatDraft.ts';
import { LatestPreview } from '../src/lib/latestPreview.ts';

const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const deferred = () => { let resolve!: (value: number) => void; let reject!: (error: Error) => void; const promise = new Promise<number>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('连续增减累计净级数、反向到零；输入绝对字号替换相对草稿', () => {
  const empty = emptyFormatDraft();
  const one = stepSize(empty, 1)!;
  const two = stepSize(one, 1)!;
  assert.equal(two.sizeChange?.amount, 2);
  assert.deepEqual(stepSize(stepSize(two, -1)!, -1), empty);
  assert.equal(empty.sizeChange, null);
  const absolute = inputSize(two, '13');
  assert.equal(absolute.sizeChange, null);
  assert.equal(stepSize(absolute, 1)?.patch.size_pt, 14);
  assert.equal(stepSize(absolute, -1)?.patch.size_pt, 12);
  assert.equal(stepSize(inputSize(empty, '42'), 1), null);
  assert.equal(stepSize(inputSize(empty, '5'), -1), null);
  assert.deepEqual(inputSize(absolute, ''), empty);
  const combined = { patch: { first_line_chars: 2, bold: false }, sizeChange: one.sizeChange };
  assert.deepEqual(stepSize(combined, 1)?.patch, combined.patch);
  assert.equal(fieldCount(combined.patch, 'paragraph'), 1);
  assert.equal(fieldCount(combined.patch, 'font'), 1);
});

test('非法草稿不预览；签名区分范围、修订和全部属性', () => {
  assert.equal(formatDraftError(inputSize(emptyFormatDraft(), '0')), '字号需在 1–200 内，步进 0.5。');
  assert.ok(formatDraftError(inputSize(emptyFormatDraft(), '1.1')));
  assert.equal(formatDraftError({ patch: { bold: false, line_spacing: 1.15 }, sizeChange: null }), null);
  const draft = inputSize(emptyFormatDraft(), '12');
  const key = requestKey('doc', 1, 'A', draft);
  assert.notEqual(requestKey('doc', 2, 'A', draft), key);
  assert.notEqual(requestKey('doc', 1, 'B', draft), key);
  assert.notEqual(requestKey('doc', 1, 'A', { ...draft, patch: { ...draft.patch, keep_next: false } }), key);
});

test('预览串行且只保留最新请求；旧结果不发布', async () => {
  const calls: number[] = [], published: number[] = [];
  const waits = [deferred(), deferred()];
  const queue = new LatestPreview<number, number>(input => { calls.push(input); return waits[calls.length - 1].promise; }, (_, result) => published.push(result), () => assert.fail('unexpected error'), 0);
  queue.schedule(1); await tick();
  queue.schedule(2); queue.schedule(3); await tick();
  assert.deepEqual(calls, [1]);
  waits[0].resolve(10); await tick();
  assert.deepEqual(calls, [1, 3]);
  assert.deepEqual(published, []);
  waits[1].resolve(30); await tick();
  assert.deepEqual(published, [30]);
  queue.dispose();
});

test('取消/切换范围后旧响应与错误不能恢复预览，销毁会中止客户端请求', async () => {
  const first = deferred(), second = deferred();
  let signal: AbortSignal | undefined;
  let calls = 0;
  const output: unknown[] = [];
  const queue = new LatestPreview<number, number>((_, s) => { signal = s; return ++calls === 1 ? first.promise : second.promise; }, (_, r) => output.push(r), (_, e) => output.push(e), 0);
  queue.schedule(1); await tick(); queue.schedule(null);
  first.reject(new Error('过期错误')); await tick();
  assert.deepEqual(output, []);
  queue.schedule(2); await tick(); queue.dispose();
  assert.equal(signal?.aborted, true);
  second.resolve(2); await tick();
  assert.deepEqual(output, []);
});

test('合并输入只发最后一笔，当前失败可重新调度且不会永久锁死', async () => {
  const calls: number[] = [], results: number[] = [], errors: unknown[] = [];
  const queue = new LatestPreview<number, number>(async n => { calls.push(n); if (n === 3) throw new Error('失败'); return n; }, (_, r) => results.push(r), (_, e) => errors.push(e), 0);
  queue.schedule(1); queue.schedule(2); queue.schedule(3); await tick();
  assert.deepEqual(calls, [3]); assert.equal(errors.length, 1);
  queue.schedule(4); await tick();
  assert.deepEqual(results, [4]); queue.dispose();
});
