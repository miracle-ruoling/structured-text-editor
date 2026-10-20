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
