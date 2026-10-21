import assert from 'node:assert/strict';
import test from 'node:test';
import type { Block, Format } from '../src/lib/types.ts';
import { currentFlags, flagStateLabel } from '../src/lib/formatState.ts';

const block = (format: Format, runs: Format[] = [], mixed: string[] = []) => ({ format, runs: runs.map(format => ({ text: '文字', format })), mixed }) as Block;

test('格式状态读取应用后的开关而不填入草稿，显式关闭不是未知', () => {
  const blocks = [block({ italic: true, bold: false, keep_next: false })];
  const original = structuredClone(blocks);
  const flags = currentFlags(blocks);
  assert.equal(flags.italic, true); assert.equal(flags.bold, false); assert.equal(flags.keep_next, false);
  assert.equal(flagStateLabel(flags.italic), '开启 · 当前');
  assert.equal(flagStateLabel(flags.bold), '关闭 · 当前');
  assert.deepEqual(blocks, original);
  assert.deepEqual(currentFlags([]), {});
});

test('行内或跨段的不同值不能假装为统一开关，分页从段落读取', () => {
  const inline = block({ italic: true, keep_next: false }, [{ italic: true, keep_next: true }, { italic: false, keep_next: true }]);
  assert.equal(currentFlags([inline]).italic, 'mixed');
  assert.equal(currentFlags([inline]).keep_next, false);
  assert.equal(currentFlags([block({ bold: false }), block({ bold: true })]).bold, 'mixed');
  assert.equal(currentFlags([block({ italic: true }, [{ italic: true }], ['italic'])]).italic, 'mixed');
  assert.equal(flagStateLabel('mixed'), '混合 · 保持各自');
});

test('未解析的行内值不以段落默认值冒充已关闭，混合未知仍明确呈现', () => {
  assert.equal(currentFlags([block({ italic: true }, [{}])]).italic, 'unknown');
  assert.equal(currentFlags([block({}, [{ italic: true }, {}])]).italic, 'mixed');
  assert.equal(flagStateLabel('unknown'), '未解析 · 保持原样');
  assert.equal(flagStateLabel(undefined), '不设置');
});
