import assert from 'node:assert/strict';
import test from 'node:test';
import { afterApply, paragraphInsets, scopedPatch, selectorComplete } from '../src/lib/workspace.ts';

test('新增空白排除条件不能意外匹配整篇文档', () => {
  assert.equal(selectorComplete({ mode: 'all', conditions: [{ field: 'tag', op: 'is_not', value: '' }] }), false);
  assert.equal(selectorComplete({ mode: 'all', conditions: [{ field: 'text', op: 'contains', value: '  ' }] }), false);
  assert.equal(selectorComplete({ mode: 'all', conditions: [] }), true);
});

test('段落预览不携带另一页的字号和字体', () => {
  const draft = { size_pt: 18, font_latin: 'Arial', first_line_chars: 2, line_spacing: 1.5 };
  assert.deepEqual(scopedPatch(draft, 'paragraph', false), { first_line_chars: 2, line_spacing: 1.5 });
  assert.deepEqual(scopedPatch(draft, 'font', false), { size_pt: 18, font_latin: 'Arial' });
  assert.deepEqual(scopedPatch(draft, 'font', true), draft);
  assert.deepEqual(scopedPatch({ first_line_chars: 0 }, 'paragraph', false), { first_line_chars: 0 });
});

test('成功应用后清空所有草稿；锁定只保留草稿，不扩大范围', () => {
  const draft = { size_pt: 18, first_line_chars: 2 };
  assert.deepEqual(afterApply(draft, false), {});
  const retained = afterApply(draft, true);
  assert.deepEqual(retained, draft);
  assert.deepEqual(scopedPatch(retained, 'paragraph', false), { first_line_chars: 2 });
  assert.notEqual(retained, draft);
});

test('报告中的悬挂缩进预留文字空间，保留源数值', () => {
  const source = { size_pt: 12, left_indent_chars: 3, right_indent_chars: 3, first_line_chars: -9 };
  const css = paragraphInsets(source);
  assert.equal(css.paddingLeft, 'min(144px, 35%)');
  assert.equal(css.paddingRight, 'min(48px, 25%)');
  assert.equal(css.textIndent, 'max(-144px, -35%)');
  assert.equal(source.first_line_chars, -9);
  assert.equal(paragraphInsets({ ...source, first_line_chars: 2 }).textIndent, 'min(32px, 50%)');
});

test('磅缩进与零值可区分；极端缩进按屏幕宽度约束', () => {
  assert.equal(paragraphInsets({ first_line_pt: -72 }).paddingLeft, 'min(96px, 35%)');
  assert.equal(paragraphInsets({ first_line_chars: 0, first_line_pt: 72 }).textIndent, 'min(0px, 50%)');
  assert.equal(paragraphInsets({ first_line_chars: 100 }).textIndent, 'min(1600px, 50%)');
});
