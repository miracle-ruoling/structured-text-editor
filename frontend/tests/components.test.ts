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

test('保存文字时侧栏隔离交互，但不切换按钮的灰色禁用样式', () => {
  const props = { doc: { id: 'doc', name: '测试.docx', blocks: [], chapters: [], saved_selectors: [] }, recent: [], selector: null, disabled: false };
  const idle = render(ui.Sidebar, props);
  const saving = render(ui.Sidebar, { ...props, textPending: true });
  assert.match(saving, /inert=""/);
  assert.match(saving, /aria-busy="true"/);
  assert.doesNotMatch(saving, /disabled=""/);
  assert.equal(saving.replace(' inert="" aria-busy="true"', ''), idle);
});
const paragraph: Block = { id: 'p3', kind: 'paragraph', text: '混合字号', role: 'body', tags: [], in_table: false, editable: true, confirmed: false, style_id: '', style_name: '正文', role_source: '自动识别', format: { size_pt: 18 }, format_sources: { size_pt: '规则：正文' }, mixed: [], features: [], overrides: {}, format_trace: {}, runs: [{ text: '混合', format: { size_pt: 18 } }, { text: '字号', format: { size_pt: 18 } }] };
const draft: FormatRule = { id: 'a'.repeat(32), name: '正文', selector: { mode: 'all', conditions: [] }, patch: { size_pt: 18, first_line_chars: 2 }, enabled: true };

test('模板保存与应用分离，预览过期或零命中不能提交', () => {
  const props = { doc: { revision: 1 }, library: { revision: 0, items: [], deleted: [] }, draft: { template: { version: 1, name: '报告', entries: [{ role: 'body', patch: { size_pt: 14 } }] } }, extraction: null,
    busy: false, dirty: true, preview: { ids: ['p3'], counts: { body: 1 }, changes: [], warnings: [] }, ready: false, pending: true, error: null, scope: 'selection', scopeReady: false, scopeCount: 1, previewEnabled: true, onPreviewToggle: noop };
  const html = render(ui.TemplatePanel, props);
  assert.match(html, /请先在操作页设置并确认筛选范围/);
  assert.match(html, /disabled="">应用到文档/);
  assert.match(html, /保存模板只更新模板库/);
  assert.doesNotMatch(html, /持续格式规则|从当前筛选新建规则/);
  assert.doesNotMatch(render(ui.TemplatePanel, { ...props, ready: true, pending: false, scopeReady: true }), /disabled="">应用到文档/);
  assert.match(render(ui.TemplatePanel, { ...props, ready: true, preview: { ids: [], counts: {}, changes: [] } }), /disabled="">应用到文档/);
});

test('规则预览使用完整的逐段结果，恢复混合字号时不残留统一字号', () => {
  const afterBlock = { ...paragraph, format: {}, mixed: ['size_pt'], runs: [{ text: '混合', format: { size_pt: 12 } }, { text: '字号', format: { size_pt: 24 } }] };
  const html = render(ui.DocumentCanvas, { doc: { id: 'doc', revision: 1, name: '示例', blocks: [paragraph], layout: [{ kind: 'paragraph', id: 'p3' }], warnings: [] }, matched: [], current: null, preview: { revision: 1, ids: ['p3'], changes: [], after_blocks: [afterBlock] }, patch: {}, showTags: true, onlyMatches: false, zoom: 100, busy: false });
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
  const html = render(ui.SelectorBuilder, { value: { mode: 'all', conditions: [{ field: 'tag', op: 'is', value: '旧条件' }] }, active: false, canResume: true, tags: [], count: 0, saveName: '' });
  assert.match(html, /未启用筛选/);
  assert.match(html, /恢复上次筛选/);
  assert.doesNotMatch(html, /旧条件|高级关系式|保存此筛选/);
});


test('字号输入与两个步进按钮、折叠分组共同提交，不再锁定或按页隐藏范围', () => {
  const html = render(ui.FormatPanel, { draft: { patch: { bold: false, first_line_chars: 2 }, sizeChange: { mode: 'chinese_steps', amount: 2 } }, onChange: noop, preview: { revision: 1, ids: ['p3'], changes: [], after_blocks: [] }, ready: true, pending: false, error: null, count: 1, blocks: [paragraph], matched: ['p3'], selectionActive: true, busy: false });
  assert.match(html, /aria-label="字号"/);
  assert.match(html, /aria-label="增大一级字号"/);
  assert.match(html, /aria-label="缩小一级字号"/);
  assert.match(html, /各自字号 \+2 级/);
  assert.match(html, /首行缩进 · 2 字符/);
  assert.match(html, /粗体 · 否/);
  assert.match(html, /<details class="format-group" open="">/);
  assert.match(html, /<details class="format-group">/);
  assert.doesNotMatch(html, /字号方式|锁定草稿|同时应用文字页|预览修改/);
  assert.match(html, /<button class="primary">应用到 1 段/);
});

test('预览更新或错误期间禁用应用，但格式输入仍可用', () => {
  const props = { draft: { patch: { size_pt: 15 }, sizeChange: null }, onChange: noop, preview: { ids: ['p3'], changes: [] }, ready: false, pending: true, error: null, count: 1, blocks: [paragraph], matched: ['p3'], selectionActive: true, busy: false };
  const html = render(ui.FormatPanel, props);
  assert.match(html, /<button class="primary" disabled="">应用到 1 段/);
  assert.match(html, /正在更新预览/);
  assert.doesNotMatch(html, /<fieldset disabled/);
  assert.match(render(ui.FormatPanel, { ...props, pending: false, error: '字号越界' }), /字号越界/);
});

test('分页与粗斜体区分不设置和显式关闭', () => {
  const html = render(ui.FormatFields, { patch: { bold: false, keep_next: false }, onChange: noop });
  assert.match(html, /value="false" selected="">关闭/);
  assert.match(html, /分页与连排/);
  assert.doesNotMatch(html, /字号方式|role="tablist"/);
});

test('失效的章节条件保持可见，绝不静默换成其他章节', () => {
  const html = render(ui.SelectorBuilder, { value: { mode: 'all', conditions: [{ field: 'chapter', op: 'is_not', value: 'p4' }] }, active: true, chapters: [{ id: 'p8', name: '第二章', level: 1, count: 4 }], sections: [], tags: [], count: 0, saveName: '' });
  assert.match(html, /value="p4" selected="">已失效 · p4/);
  assert.match(html, /第二章 · 4 段/);
  const rules = render(ui.RulePanel, { rules: [{ ...draft, scope_warning: '范围已失效，规则暂不匹配：章节 p4', matched_count: 0, effective_count: 0 }], draft: null, preview: null, busy: false, canUseScope: false });
  assert.match(rules, /范围已失效，规则暂不匹配/);
});

test('相对预览保留不同片段字号，显式关闭粗斜体输出正常字重', () => {
  const afterBlock = { ...paragraph, format: { bold: false, italic: false }, mixed: ['size_pt'], runs: [{ text: '混合', format: { size_pt: 13, bold: false, italic: false } }, { text: '字号', format: { size_pt: 25 } }] };
  const html = render(ui.DocumentCanvas, { doc: { id: 'doc', revision: 1, name: '示例', blocks: [paragraph], layout: [{ kind: 'paragraph', id: 'p3' }], warnings: [] }, matched: ['p3'], current: null, preview: { revision: 1, ids: ['p3'], changes: [], after_blocks: [afterBlock] }, patch: {}, showTags: true, onlyMatches: false, selectionActive: true, zoom: 100, busy: false });
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


test('即时预览默认只渲染结果，需要时可切换原文对照', () => {
  const afterBlock = { ...paragraph, format: { size_pt: 24 }, runs: [{ text: '字号结果', format: { size_pt: 24 } }] };
  const props = { doc: { id: 'doc', revision: 1, name: '示例', blocks: [paragraph], layout: [{ kind: 'paragraph', id: 'p3' }], warnings: [] }, matched: ['p3'], current: null, preview: { revision: 1, ids: ['p3'], changes: [], after_blocks: [afterBlock] }, patch: {}, showTags: true, onlyMatches: false, selectionActive: true, zoom: 100, busy: false, livePreview: true, compare: false };
  const html = render(ui.DocumentCanvas, props);
  assert.match(html, /font-size:24pt/);
  assert.doesNotMatch(html, /font-size:18pt|comparison-before/);
  assert.match(html, /对照原文/);
  const comparing = render(ui.DocumentCanvas, { ...props, compare: true });
  assert.match(comparing, /comparison-before/);
  assert.match(comparing, /font-size:18pt/);
  const updating = render(ui.DocumentCanvas, { ...props, previewPending: true });
  assert.match(updating, /当前仍为上次效果/);
});

test('清空草稿后显示已保存开关但不产生待应用属性，修改值优先于当前值', () => {
  const props = { draft: { patch: {}, sizeChange: null }, onChange: noop, preview: null, ready: false, pending: false, error: null, count: 1, blocks: [{ ...paragraph, runs: [{ text: '中文 English', format: { italic: true, bold: false } }] }], matched: ['p3'], selectionActive: true, busy: false };
  const html = render(ui.FormatPanel, props);
  assert.match(html, /value="" selected="">开启 · 当前/);
  assert.match(html, /value="" selected="">关闭 · 当前/);
  assert.doesNotMatch(html, /draft-summary/);
  assert.match(html, /<button class="primary" disabled="">应用到 1 段/);
  const modified = render(ui.FormatPanel, { ...props, draft: { patch: { italic: false }, sizeChange: null } });
  assert.match(modified, /value="false" selected="">关闭/);
  assert.match(modified, /斜体 · 否/);
  const mixed = render(ui.FormatPanel, { ...props, blocks: [{ ...paragraph, runs: [{ text: '中文', format: { italic: true } }, { text: 'English', format: { italic: false } }] }] });
  assert.match(mixed, /value="" selected="">混合 · 保持各自/);
});

test('阅读区取消框选工具，查看焦点与匹配范围独立，中文和西文保留各自斜体', () => {
  const italic = { ...paragraph, runs: [{ text: '中文斜体', format: { italic: true, font_east_asia: '宋体' } }, { text: 'English', format: { italic: false } }] };
  const html = render(ui.DocumentCanvas, { doc: { id: 'doc', revision: 1, name: '示例', blocks: [italic], layout: [{ kind: 'paragraph', id: 'p3' }], warnings: [] }, matched: [], current: 'p3', focusMuted: true, preview: null, patch: {}, showTags: true, onlyMatches: false, selectionActive: true, zoom: 100, busy: false });
  assert.match(html, /focused focus-muted/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /font-style:italic[^>]*>中文斜体/);
  assert.match(html, /font-style:normal[^>]*>English/);
  assert.doesNotMatch(html, /框选|type="checkbox"|block-mark/);
  const selector = render(ui.SelectorBuilder, { value: { mode: 'all', conditions: [{ field: 'ids', op: 'is', value: '', ids: ['p3'] }] }, active: true, direct: true, tags: [], count: 1, saveName: '' });
  assert.match(selector, /直接选择/);
  assert.doesNotMatch(selector, /点击换段 · Ctrl 点击切换段落/);
  assert.match(selector, /class="range-input"/);
  assert.match(selector, /range-input-tooltip/);
  assert.doesNotMatch(selector, /查看快照编号|段快照/);
  assert.doesNotMatch(selector, /框选/);
});
