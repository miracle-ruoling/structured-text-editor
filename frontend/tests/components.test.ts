import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildSync } from 'esbuild';
import type { Block, FormatRule } from '../src/lib/types.ts';

// Render local components without opening a browser or accessing any HTTP service.
const root = fileURLToPath(new URL('../../.artifacts/ui-tests/', import.meta.url));
mkdirSync(root, { recursive: true });
const temporary = mkdtempSync(join(root, 'render-'));
const bundle = join(temporary, 'components.cjs');
buildSync({ entryPoints: [fileURLToPath(new URL('./component-fixtures.tsx', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
const ui = createRequire(import.meta.url)(bundle);
after(() => { rmSync(temporary, { recursive: true }); });
const render = (component: unknown, props: object) => ui.renderToStaticMarkup(ui.createElement(component, props));
const noop = () => {};
const paragraph: Block = { id: 'p3', kind: 'paragraph', text: '混合字号', role: 'body', tags: [], in_table: false, editable: true, confirmed: false, style_id: '', style_name: '正文', role_source: '自动识别', format: { size_pt: 18 }, format_sources: { size_pt: '规则：正文' }, mixed: [], features: [], overrides: {}, format_trace: {}, runs: [{ text: '混合', format: { size_pt: 18 } }, { text: '字号', format: { size_pt: 18 } }] };
const draft: FormatRule = { id: 'a'.repeat(32), name: '正文', selector: { mode: 'all', conditions: [] }, patch: { size_pt: 18, first_line_chars: 2 }, enabled: true };

test('规则预览使用完整的逐段结果，恢复混合字号时不残留统一字号', () => {
  const afterBlock = { ...paragraph, format: {}, mixed: ['size_pt'], runs: [{ text: '混合', format: { size_pt: 12 } }, { text: '字号', format: { size_pt: 24 } }] };
  const html = render(ui.DocumentCanvas, { doc: { id: 'doc', revision: 1, name: '示例', blocks: [paragraph], layout: [{ kind: 'paragraph', id: 'p3' }], warnings: [] }, matched: [], current: null, preview: { revision: 1, ids: ['p3'], changes: [], after_blocks: [afterBlock] }, patch: {}, marked: [], marking: false, showTags: true, onlyMatches: false, zoom: 100, busy: false });
  const before = html.slice(html.indexOf('comparison-before'), html.indexOf('comparison-after'));
  const afterHtml = html.slice(html.indexOf('comparison-after'));
  assert.match(before, /font-size:18pt/);
  assert.match(afterHtml, /font-size:12pt/);
  assert.match(afterHtml, /font-size:24pt/);
  assert.doesNotMatch(afterHtml, /font-size:18pt/);
});

test('零变化的有效规则仍可保存，规则摘要包含两页格式且不混用单次草稿开关', () => {
  const html = render(ui.RulePanel, { rules: [], draft, preview: { revision: 1, ids: [], rules: [{ ...draft, matched_count: 1, effective_count: 0 }], changes: [] }, busy: false, canUseScope: true, onChange: noop });
  assert.match(html, /当前没有显示变化，仍可保存/);
  assert.match(html, /字号 · 18 磅/);
  assert.match(html, /首行缩进 · 2 字符/);
  assert.match(html, /<button class="primary full">保存规则并应用/);
  assert.doesNotMatch(html, /锁定草稿|同时应用另一页/);
});

test('格式来源同时列出被覆盖层和生效层，清除入口仅针对局部覆盖', () => {
  const block = { ...paragraph, overrides: { size_pt: 18 }, format_trace: { size_pt: [
    { kind: 'source', key: 'size_pt', label: '原样式', value: 12 },
    { kind: 'rule', key: 'size_pt', label: '规则：正文', value: 14 },
    { kind: 'local', key: 'size_pt', label: '本项目局部覆盖', value: 18 },
  ] } };
  const html = render(ui.FormatSources, { block, busy: false, onClear: noop });
  assert.match(html, /原样式 · 被覆盖/);
  assert.match(html, /规则：正文 · 被覆盖/);
  assert.match(html, /本项目局部覆盖 · 当前生效/);
  assert.match(html, /清除此项局部覆盖/);
  assert.doesNotMatch(render(ui.FormatSources, { block: paragraph, busy: false, onClear: noop }), /清除此项局部覆盖/);
});

test('批量标注无有效范围时不能提交，返回面板保留移除动作与输入', () => {
  const html = render(ui.BulkAnnotations, { count: 0, disabled: true, tags: ['保护'], draft: '保护', action: 'remove_tag', role: 'body', onDraft: noop });
  assert.match(html, /value="remove_tag" selected=""/);
  assert.match(html, /disabled="">移除标签 · 0 段/);
});

test('未启用筛选时不渲染活动条件、表达式和保存区域', () => {
  const html = render(ui.SelectorBuilder, { value: { mode: 'all', conditions: [{ field: 'tag', op: 'is', value: '旧条件' }] }, active: false, canResume: true, tags: [], marked: [], count: 0, saveName: '' });
  assert.match(html, /未启用筛选/);
  assert.match(html, /恢复上次筛选/);
  assert.doesNotMatch(html, /旧条件|高级关系式|保存此筛选/);
});


test('相对字号单独可预览，切到段落页后不夹带文字操作', () => {
  const props = { patch: {}, sizeChange: { mode: 'points', amount: 1 }, onSizeChange: noop, onChange: noop, preview: null, count: 2, tab: 'font', locked: true, includeOther: false, busy: false };
  const html = render(ui.FormatPanel, props);
  assert.match(html, /按各自字号增减磅数/);
  assert.match(html, /每次应用会基于当时字号重新计算/);
  assert.doesNotMatch(html, /class="primary full" disabled/);
  const paragraphHtml = render(ui.FormatPanel, { ...props, tab: 'paragraph' });
  assert.match(paragraphHtml, /class="primary full" disabled/);
  assert.match(paragraphHtml, /同时应用文字页的 1 项设置/);
  assert.doesNotMatch(paragraphHtml, /relative-summary/);
});

test('分页与粗斜体区分不设置和显式关闭，规则不提供相对字号', () => {
  const font = render(ui.FormatFields, { patch: { bold: false }, tab: 'font', onChange: noop });
  assert.match(font, /value="false" selected="">关闭/);
  assert.doesNotMatch(font, /字号方式/);
  const para = render(ui.FormatFields, { patch: { keep_next: false }, tab: 'paragraph', onChange: noop });
  assert.match(para, /分页与连排/);
  assert.match(para, /value="false" selected="">关闭/);
});

test('失效的章节条件保持可见，绝不静默换成其他章节', () => {
  const html = render(ui.SelectorBuilder, { value: { mode: 'all', conditions: [{ field: 'chapter', op: 'is_not', value: 'p4' }] }, active: true, chapters: [{ id: 'p8', name: '第二章', level: 1, count: 4 }], sections: [], marked: [], tags: [], count: 0, saveName: '' });
  assert.match(html, /value="p4" selected="">已失效 · p4/);
  assert.match(html, /第二章 · 4 段/);
  const rules = render(ui.RulePanel, { rules: [{ ...draft, scope_warning: '范围已失效，规则暂不匹配：章节 p4', matched_count: 0, effective_count: 0 }], draft: null, preview: null, busy: false, canUseScope: false });
  assert.match(rules, /范围已失效，规则暂不匹配/);
});

test('相对预览保留不同片段字号，显式关闭粗斜体输出正常字重', () => {
  const afterBlock = { ...paragraph, format: { bold: false, italic: false }, mixed: ['size_pt'], runs: [{ text: '混合', format: { size_pt: 13, bold: false, italic: false } }, { text: '字号', format: { size_pt: 25 } }] };
  const html = render(ui.DocumentCanvas, { doc: { id: 'doc', revision: 1, name: '示例', blocks: [paragraph], layout: [{ kind: 'paragraph', id: 'p3' }], warnings: [] }, matched: ['p3'], current: null, preview: { revision: 1, ids: ['p3'], changes: [], after_blocks: [afterBlock] }, patch: {}, marked: [], marking: false, showTags: true, onlyMatches: false, selectionActive: true, zoom: 100, busy: false });
  const afterHtml = html.slice(html.indexOf('comparison-after'));
  assert.match(afterHtml, /font-size:13pt/);
  assert.match(afterHtml, /font-size:25pt/);
  assert.match(afterHtml, /font-weight:400/);
  assert.match(afterHtml, /font-style:normal/);
});

test('导出检查标明已保存修订、混合字号差异及兼容性边界', () => {
  const html = render(ui.ExportInspection, { report: { name: '示例.docx', revision: 7, verified: true, changed_paragraphs: [{ id: 'p3', text: '混合字号', properties: [{ key: 'size_pt', before: null, after: null }], size_before: [12, 24], size_after: [13, 25] }], paragraph_count: 10, planned_paragraph_count: 1, changed_parts: ['word/document.xml'], preserved_parts: 9, warnings: ['公式原样保留'], limits: ['不验证精确页数'], source_sha256: 'abc', output_sha256: 'def' }, onClose: noop });
  assert.match(html, /已保存版本 r7/);
  assert.match(html, /12 磅 \/ 24 磅 → 13 磅 \/ 25 磅/);
  assert.match(html, /不验证精确页数/);
  assert.match(html, /下载此报告/);
});
