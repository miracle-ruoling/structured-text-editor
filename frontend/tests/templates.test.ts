import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyTemplate, extractedEntries, templateDirty, templateDraft, templateError, templatePreviewKey, templatePreviewState } from '../src/lib/templates.ts';
import type { Extraction } from '../src/lib/templates.ts';
import type { StoredTemplate } from '../src/lib/types.ts';

const saved: StoredTemplate = { id: 'a'.repeat(32), version: 1, name: '报告', entries: [{ role: 'body', patch: { size_pt: 14, bold: false } }] };

test('模板草稿与库隔离；已保存模板直接查看不算未提交，编辑受保护', () => {
  const draft = templateDraft(saved);
  assert.equal(templateDirty(draft, [saved]), false);
  draft.template.entries[0].patch.size_pt = 16;
  assert.equal(templateDirty(draft, [saved]), true);
  assert.equal(saved.entries[0].patch.size_pt, 14);
  assert.equal(templateDirty(emptyTemplate(), []), false);
  assert.equal(templateDirty({ template: { version: 1, name: '', entries: [{ role: 'body', patch: {} }] } }, []), true);
});

test('未决并列不能悄悄采用；明确选择整套组合、排除类别，不逐属性拼接', () => {
  const extraction: Extraction = { revision: 1, groups: [
    { role: 'body', count: 2, suggested: null, tied: true, candidates: [
      { patch: { size_pt: 12, alignment: 'left' }, count: 1, example: 'p1', omitted: {} },
      { patch: { size_pt: 14, alignment: 'right' }, count: 1, example: 'p2', omitted: {} },
    ] },
    { role: 'heading', count: 1, suggested: 0, tied: false, candidates: [{ patch: { bold: true }, count: 1, example: 'p3', omitted: {} }] },
  ], choices: { body: null, heading: 0 } };
  assert.equal(extractedEntries(extraction), null);
  extraction.choices = { body: 1, heading: -1 };
  const entries = extractedEntries(extraction)!;
  assert.deepEqual(entries, [{ role: 'body', patch: { size_pt: 14, alignment: 'right' } }]);
  entries[0].patch.size_pt = 18;
  assert.equal(extraction.groups[0].candidates[1].patch.size_pt, 14);
});

test('模板保留显式关闭和零值；空类别、无名和非法数值禁止预览/保存', () => {
  assert.equal(templateError(saved), null);
  assert.equal(templateError({ version: 1, name: '零值', entries: [{ role: 'body', patch: { bold: false, first_line_chars: 0 } }] }), null);
  assert.ok(templateError(emptyTemplate().template));
  assert.ok(templateError({ ...saved, entries: [{ role: 'body', patch: {} }] }));
  assert.ok(templateError({ ...saved, entries: [{ role: 'body', patch: { size_pt: 201 } }] }));
});

test('模板预览只允许当前版本和范围提交；同范围旧效果可暂留，换文档或取消立即隐藏', () => {
  const request = templatePreviewKey('doc1', 3, saved, null);
  const result = { revision: 3, ids: ['p3'], counts: { body: 1 }, changes: [], request };
  assert.equal(templatePreviewState(result, request, 3, true, null).ready, true);
  const edited = templatePreviewKey('doc1', 3, { ...saved, entries: [{ role: 'body', patch: { size_pt: 18 } }] }, null);
  const stale = templatePreviewState(result, edited, 3, true, null);
  assert.equal(stale.ready, false);
  assert.equal(stale.preview, result);
  assert.equal(stale.pending, true);
  for (const next of [templatePreviewKey('doc2', 3, saved, null), templatePreviewKey('doc1', 4, saved, null),
    templatePreviewKey('doc1', 3, saved, { mode: 'any', conditions: [] })]) {
    const state = templatePreviewState(result, next, 3, true, null);
    assert.equal(state.ready, false);
    assert.equal(state.preview, null);
  }
  assert.equal(templatePreviewState(result, request, 4, true, null).ready, false);
  assert.equal(templatePreviewState(result, request, 3, false, null).preview, null);
  assert.equal(templatePreviewState(result, request, 3, true, '范围无效').ready, false);
});
