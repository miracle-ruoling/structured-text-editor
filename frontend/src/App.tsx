import { Check, CheckCheck, Download, FileInput, Fingerprint, FolderDown, Layers, LoaderCircle, Redo2, SlidersHorizontal, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentCanvas } from './components/DocumentCanvas';
import { DraftDialog } from './components/DraftDialog';
import { ExportInspection } from './components/ExportInspection';
import { FormatPanel } from './components/FormatPanel';
import { BulkAnnotations } from './components/BulkAnnotations';
import { TemplatePanel } from './components/TemplatePanel';
import { ObjectInspector } from './components/ObjectInspector';
import { SelectorBuilder } from './components/SelectorBuilder';
import { Sidebar } from './components/Sidebar';
import { api, ApiError } from './lib/api';
import type { BulkAnnotation, DocumentView, ExportReport, RecentProject, Role, Selector, TemplateLibrary, StoredTemplate } from './lib/types';
import { selectorComplete } from './lib/workspace';
import { emptyFormatDraft } from './lib/formatDraft';
import { useFormatPreview } from './lib/useFormatPreview';
import { useSelection } from './lib/useSelection';
import { activateSelection, emptySelectionSession, leaveSelection, parseParagraphIds, pointIntent, selectParagraph } from './lib/selection';
import type { SelectionSession } from './lib/selection';
import { emptyTemplate, templateDraft, templateDirty, extractedEntries } from './lib/templates';
import type { TemplateDraft, Extraction } from './lib/templates';
import { useTemplatePreview } from './lib/useTemplatePreview';

const LAST_PROJECT = 'wenxu.last-project.v1';

export default function App() {
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [selectionSession, setSelectionSession] = useState(emptySelectionSession);
  const { selector, active: selectionActive, previous: previousSelector } = selectionSession;
  const [saveName, setSaveName] = useState('');
  const [formatDraft, setFormatDraft] = useState(emptyFormatDraft);
  const { patch, sizeChange } = formatDraft;
  const [report, setReport] = useState<ExportReport | null>(null);
  const [compare, setCompare] = useState(false);
  const [library, setLibrary] = useState<TemplateLibrary | null>(null);
  const [template, setTemplate] = useState<TemplateDraft | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [templateScope, setTemplateScope] = useState<'all' | 'selection'>('all');
  const [templatePreviewEnabled, setTemplatePreviewEnabled] = useState(true);
  const [bulkTagDraft, setBulkTagDraft] = useState('');
  const [bulkAction, setBulkAction] = useState<BulkAnnotation['action']>('add_tag');
  const [bulkRole, setBulkRole] = useState<Role>('body');
  const [current, setCurrent] = useState<string | null>(null);
  const [tab, setTab] = useState<'batch' | 'object' | 'templates'>('batch');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [showTags, setShowTags] = useState(true);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pendingSwitch, setPendingSwitch] = useState<{ action: () => void; message?: string } | null>(null);
  const [rangeInputs, setRangeInputs] = useState<Record<string, string>>({});
  const [rangeError, setRangeError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const operationLock = useRef(false);
  const rangeDirty = Object.keys(rangeInputs).length > 0;
  const acceptResolvedSelection = useCallback((expected: SelectionSession, next: SelectionSession) => {
    setSelectionSession(current => current === expected ? next : current);
  }, []);
  const selection = useSelection(doc, selectionSession, rangeDirty, acceptResolvedSelection);
  const { ids: matched, matching, error: selectionError } = selection;
  const selectorError = rangeError || (rangeDirty ? '段落编号尚未确认，请按回车或移开焦点完成。' : selectionError);
  // An empty range input is still an unfinished edit and must be protected from document switches.
  const hasDraft = !!Object.keys(patch).length || !!sizeChange || !!saveName.trim() || !!bulkTagDraft.trim() || !!extraction || rangeDirty || templateDirty(template, library?.items || []);

  const live = useFormatPreview(doc, selector, formatDraft, tab === 'batch' && !busy && selectionActive && selectorComplete(selector) && !matching && !selectorError && matched.length > 0);
  const preview = live.preview;
  const templateScopeReady = selectionActive && !matching && !selectorError && selectorComplete(selector);
  const templateLive = useTemplatePreview(doc, extraction ? null : template?.template || null, templateScope === 'selection' ? selector : null,
    tab === 'templates' && !busy && templatePreviewEnabled && (templateScope === 'all' || templateScopeReady));
  const clearFormatDraft = useCallback(() => { setFormatDraft(emptyFormatDraft()); }, []);

  const acceptDoc = useCallback((value: DocumentView) => {
    setDoc(value); setReport(null);
    void api.recent().then(setRecent).catch(() => { /* Listing failure does not discard the current document. */ });
    try { localStorage.setItem(LAST_PROJECT, value.id); } catch { /* Content is stored by the local service. */ }
  }, []);

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        let saved: string | null = null;
        try { saved = localStorage.getItem(LAST_PROJECT); } catch { /* Browser storage may be unavailable. */ }
        const recentProjects = await api.recent();
        let document: DocumentView;
        const fallback = () => recentProjects.length ? api.get(recentProjects[0].id) : api.demo();
        try { document = saved ? await api.get(saved) : await fallback(); }
        catch (error) { if (saved && error instanceof ApiError && error.status === 404) document = await fallback(); else throw error; }
        if (active) acceptDoc(document);
        try { const value = await api.templates(); if (active) setLibrary(value); } catch (error) { if (active) setMessage({ text: (error as Error).message, error: true }); }
      } catch (error) { if (active) setMessage({ text: (error as Error).message, error: true }); }
      finally { if (active) setBusy(false); }
    }
    void start();
    return () => { active = false; };
  }, [acceptDoc]);

  useEffect(() => {
    if (!message || message.error) return;
    const timer = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (hasDraft || busy) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [hasDraft, busy]);

  const run = useCallback(async (action: () => Promise<void>): Promise<boolean> => {
    if (operationLock.current) return false;
    operationLock.current = true; setBusy(true); setMessage(null);
    try { await action(); return true; }
    catch (error) {
      setMessage({ text: (error as Error).message || '操作失败，请重试。', error: true });
      if (error instanceof ApiError && error.status === 409 && doc) {
        try { acceptDoc(await api.get(doc.id)); } catch { /* Preserve the conflict message. */ }
      }
      return false;
    } finally { operationLock.current = false; setBusy(false); }
  }, [doc, acceptDoc]);

  const history = useCallback((direction: 'undo' | 'redo') => {
    if (!doc || busy || !(direction === 'undo' ? doc.undo_label : doc.redo_label)) return;
    void run(async () => {
      acceptDoc(await api.history(doc, direction)); clearFormatDraft(); setTemplatePreviewEnabled(false);
      setMessage({ text: direction === 'undo' ? '已撤销上一次操作' : '已重做操作', error: false });
    });
  }, [doc, busy, run, acceptDoc, clearFormatDraft]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.isComposing || pendingSwitch || report) return;
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && ((tab === 'templates' && templatePreviewEnabled) || (tab === 'batch' && (Object.keys(patch).length || sizeChange))) && !busy) {
        event.preventDefault(); if (tab === 'templates') setTemplatePreviewEnabled(false); else clearFormatDraft(); return;
      }
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select') || target.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, patch, sizeChange, tab, templatePreviewEnabled, busy, pendingSwitch, report, clearFormatDraft]);

  function changeSelector(value: Selector, explicitAll = false) {
    setRangeError(null);
    const retained = new Set(value.conditions.map((condition, index) => condition.key || String(index)));
    setRangeInputs(current => Object.fromEntries(Object.entries(current).filter(([key]) => retained.has(key))));
    const next = activateSelection(selectionSession, value, explicitAll);
    acceptSelection(next);
  }
  function updateRangeDraft(key: string, value: string) {
    setRangeError(null);
    setRangeInputs(current => ({ ...current, [key]: value }));
  }
  function commitRange(index: number, key: string) {
    if (!doc) return;
    const raw = rangeInputs[key];
    if (raw == null) return;
    const editable = new Set(doc.blocks.filter(block => block.editable).map(block => block.id));
    const parsed = parseParagraphIds(raw, editable);
    if (!parsed.ids) { setRangeError(parsed.error || '段落编号无效。'); return; }
    const next: Selector = { ...selector, conditions: selector.conditions.map((condition, item) => item === index ? { ...condition, ids: parsed.ids } : condition) };
    setRangeInputs(current => { const copy = { ...current }; delete copy[key]; return copy; });
    changeSelector(next);
  }
  function acceptSelection(next: SelectionSession) {
    setSelectionSession(next); setTab('batch');
    if (!next.active) setOnlyMatches(false);
  }
  function exitSelection() {
    setSelectionSession(leaveSelection(selectionSession));
    setOnlyMatches(false); setRangeInputs({}); setRangeError(null);
  }
  function newDocument(document: DocumentView) {
    acceptDoc(document); setCurrent(null); clearFormatDraft(); setCompare(false); setTab('batch'); setOnlyMatches(false);
    setSelectionSession(emptySelectionSession());
    setRangeInputs({}); setRangeError(null);
    setSaveName('');
    setTemplate(null); setExtraction(null); setTemplateScope('all'); setTemplatePreviewEnabled(true); setBulkTagDraft('');
    setBulkAction('add_tag'); setBulkRole('body');
  }
  function guardSwitch(action: () => void) {
    if (busy) return;
    if (hasDraft) setPendingSwitch({ action });
    else action();
  }
  function pickObject(id: string) {
    if (busy) return;
    if (id === current) { changePanel('object'); return; }
    setCurrent(id); changePanel('object');
  }
  function pickParagraph(id: string, toggle = false) {
    if (busy || !doc) return;
    const block = doc.blocks.find(item => item.id === id);
    if (!block) return;
    const action = () => {
      setCurrent(id);
      if (!block.editable) {
        if (!selectionActive) changePanel('object');
        return;
      }
      if (rangeDirty) {
        setMessage({ text: '请先完成或取消段落编号输入，再点选调整范围。', error: true }); return;
      }
      if (selectionActive && !selectionSession.direct) {
        if (!toggle) return;
        if (!selection.canToggle) {
          setMessage({ text: selectorError || '正在匹配当前条件，请稍候再点选。', error: true }); return;
        }
        const base = selectionError ? { ...selectionSession, pendingChanges: [] } : selectionSession;
        acceptSelection(pointIntent(base, id, !matched.includes(id)));
      } else acceptSelection(selectParagraph(selectionSession, id, toggle));
    };
    action();
  }
  function importFile(file?: File) {
    if (file) guardSwitch(() => void run(async () => {
      newDocument(await api.import(file));
      setMessage({ text: '文档已打开；相同原文件会复用最近的本地项目', error: false });
    }));
  }
  function download(kind: 'docx' | 'project') {
    if (doc) void run(async () => {
      await api.download(doc, kind);
      setMessage({ text: kind === 'docx' ? '已导出当前已保存状态的 Word 文件' : '已导出项目包副本，不会新增本地项目', error: false });
    });
  }
  function inspectExport() {
    if (doc) void run(async () => {
      const result = await api.report(doc);
      if (result.revision !== doc.revision) acceptDoc(await api.get(doc.id));
      setReport(result);
    });
  }
  function changePanel(value: typeof tab) {
    if (busy) return;
    setTab(value);
  }
  function formatObject(id: string) {
    if (busy || !doc?.blocks.some(block => block.id === id && block.editable)) return;
    const action = () => {
      setCurrent(id);
      acceptSelection(selectParagraph(leaveSelection(selectionSession), id, false));
    };
    action();
  }
  function editTemplate(value: StoredTemplate | null, create = false) {
    const action = () => { setTemplate(value ? templateDraft(value) : create ? emptyTemplate() : null); setExtraction(null); setTemplatePreviewEnabled(true); setTab('templates'); };
    if (templateDirty(template, library?.items || []) || extraction) setPendingSwitch({ action, message: '模板还有未保存的编辑，继续会丢弃这份模板草稿。已应用的文档格式不受影响。' });
    else action();
  }
  function refreshTemplates() { void run(async () => { setLibrary(await api.templates()); templateLive.retry(); }); }
  function extractTemplate() {
    if (!doc) return;
    void run(async () => {
      const result = await api.extractTemplate(doc);
      setExtraction({ ...result, choices: Object.fromEntries(result.groups.map(group => [group.role, group.suggested])) });
    });
  }
  function adoptExtraction() {
    if (!doc || !extraction || extraction.revision !== doc.revision) return;
    const entries = extractedEntries(extraction);
    if (!entries?.length) return;
    setTemplate({ template: { version: 1, name: (doc.name.replace(/\.docx$/i, '') + ' · 模板').slice(0, 60), entries } });
    setExtraction(null); setTemplatePreviewEnabled(true);
  }
  function saveTemplate(copy = false) {
    if (!template || !library) return;
    void run(async () => {
      const updated = await api.saveTemplate(library.revision, template.template, copy ? undefined : template.id);
      setLibrary(updated);
      const saved = updated.items.find(item => item.name === template.template.name.trim());
      if (saved) setTemplate(templateDraft(saved));
      setMessage({ text: '模板已保存到本机模板库，可在其他文档使用；文档未因保存而改变', error: false });
    });
  }
  function deleteTemplate(id: string, restore = false) {
    if (!library) return;
    void run(async () => { setLibrary(await api.deleteTemplate(library.revision, id, restore)); setMessage({ text: restore ? '模板已恢复' : '模板已删除，可在最近删除中恢复；已应用的文档不变', error: false }); });
  }
  function importTemplate(file: File) {
    if (!library) return;
    void run(async () => { setLibrary(await api.importTemplate(library.revision, file)); setMessage({ text: '模板已导入本机模板库', error: false }); });
  }
  function applyTemplate() {
    if (!doc || !templateLive.ready || !templateLive.preview) return;
    const frozen = templateLive.preview;
    void run(async () => {
      acceptDoc(await api.applyTemplate({ ...doc, revision: frozen.revision }, frozen.request.template, frozen.request.selector));
      setTemplatePreviewEnabled(false);
      setMessage({ text: `模板已应用到 ${frozen.ids.length} 段，可整体撤销；之后改类别不会自动重排`, error: false });
    });
  }
  async function bulkAnnotate(action: BulkAnnotation) {
    if (!doc || !selectionActive || matching || selectorError || !matched.length) return false;
    const count = matched.length;
    return run(async () => {
      acceptDoc(await api.bulkAnnotate(doc, selector, action));
      setMessage({ text: `已对原筛选范围 ${count} 段执行标注，可撤销`, error: false });
    });
  }
  function clearOverrides(id: string, keys: string[]) {
    if (!doc) return;
    void run(async () => {
      acceptDoc(await api.clearOverrides(doc, id, keys));
      setMessage({ text: '已清除本项目局部覆盖，恢复原文档对应格式，可撤销', error: false });
    });
  }

  async function saveCurrentSelector() {
    if (!doc || busy || matching || selectorError || !selectionActive || !selectorComplete(selector) || !saveName.trim()) return;
    await run(async () => {
      acceptDoc(await api.saveSelector(doc, saveName.trim(), selector)); setSaveName('');
      setMessage({ text: '筛选已保存到左侧，可撤销；没有应用格式', error: false });
    });
  }

  function deleteSavedSelector(id: string) {
    if (!doc) return;
    void run(async () => {
      acceptDoc(await api.deleteSelector(doc, id));
      setMessage({ text: '已删除保存的筛选，可撤销', error: false });
    });
  }
  async function applyPreview() {
    if (!doc || !preview || !live.ready) return;
    const request = preview.request;
    await run(async () => {
      acceptDoc(await api.apply({ ...doc, revision: preview.revision }, request.selector, request.draft.patch, request.draft.sizeChange));
      clearFormatDraft();
      setMessage({ text: `已调整 ${preview.ids.length} 个段落，可撤销`, error: false });
    });
  }

  const allTags = useMemo(() => [...new Set(doc?.blocks.flatMap(b => b.tags) || [])], [doc]);
  const currentBlock = doc?.blocks.find(b => b.id === current) || null;
  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><div className="brand-mark"><span /><span /><span /></div><strong>文序</strong><span className="brand-caption">结构化文档工作台</span></div>
      <div className="header-actions">
        <span className="save-status">{busy ? <><LoaderCircle size={13} className="spin" />处理中</> : <><CheckCheck size={14} />{hasDraft ? '已保存 · 有未提交草稿' : '已保存到本机'}</>}</span>
        <input ref={inputRef} type="file" hidden accept=".docx,.sdoc" onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
        <button className="secondary" disabled={busy} onClick={() => inputRef.current?.click()}><FileInput size={15} />导入文件</button>
        <button className="secondary project-save" disabled={busy || !doc} title="下载已保存状态的便携副本，本机项目自动保存" onClick={() => download('project')}><FolderDown size={15} />导出项目包</button>
        <button className="secondary" disabled={busy || !doc} onClick={inspectExport}>导出检查</button>
        <button className="primary" disabled={busy || !doc} onClick={() => download('docx')}><Download size={15} />导出 Word</button>
      </div>
    </header>
    {doc ? <div className="workspace">
      <Sidebar doc={doc} recent={recent}
        onOpen={id => guardSwitch(() => void run(async () => newDocument(await api.get(id))))}
        selector={selectionActive ? selector : null} onSelect={value => changeSelector(value, true)}
        onDeleteSelector={deleteSavedSelector}
        onDemo={() => guardSwitch(() => void run(async () => newDocument(await api.demo())))} disabled={busy} />
      <DocumentCanvas doc={doc} matched={tab === 'templates' ? [] : matched} current={current} busy={busy} focusMuted={selectionActive && !selectionSession.direct}
        onPick={pickParagraph} onInspect={pickObject} onAddCondition={id => pickParagraph(id, true)} onFormat={formatObject} preview={tab === 'templates' ? templateLive.preview : preview} patch={{}} livePreview={true} previewPending={tab === 'templates' ? templateLive.pending : live.pending} previewError={tab === 'templates' ? templateLive.error : live.error} compare={compare} onCompare={() => setCompare(!compare)} onExitPreview={() => { if (tab === 'templates') setTemplatePreviewEnabled(false); else clearFormatDraft(); }}
        showTags={showTags} onShowTags={() => setShowTags(!showTags)} onlyMatches={tab !== 'templates' && onlyMatches}
        onOnlyMatches={() => setOnlyMatches(!onlyMatches)} zoom={zoom} onZoom={setZoom} selectionActive={tab !== 'templates' && selectionActive} />
      <aside className="inspector">
        <div className="inspector-tabs" role="tablist" aria-label="工作面板">
          <button disabled={busy} role="tab" aria-selected={tab === 'batch'} className={tab === 'batch' ? 'active' : ''} onClick={() => changePanel('batch')}><SlidersHorizontal size={15} />操作</button>
          <button disabled={busy} role="tab" aria-selected={tab === 'object'} className={tab === 'object' ? 'active' : ''} onClick={() => changePanel('object')}><Fingerprint size={15} />对象属性</button>
          <button disabled={busy} role="tab" aria-selected={tab === 'templates'} className={tab === 'templates' ? 'active' : ''} onClick={() => changePanel('templates')}><Layers size={15} />模板</button>
        </div>
        <div className="inspector-scroll">{tab === 'batch' ? <fieldset className="batch-fieldset" disabled={busy}>
          <SelectorBuilder value={selector} onChange={value => changeSelector(value)} tags={allTags} count={matched.length} chapters={doc.chapters} sections={doc.sections}
            rangeInputs={rangeInputs} onRangeDraft={updateRangeDraft} onRangeCommit={commitRange}
            error={selectorError} direct={selectionSession.direct} saveName={saveName} onSaveName={setSaveName} onSave={() => void saveCurrentSelector()} savedCount={doc.saved_selectors.length}
            loading={matching} active={selectionActive} onExit={exitSelection} canResume={previousSelector !== null}
            onResume={() => { if (previousSelector) changeSelector(previousSelector, true); }}
            onStart={() => changeSelector({ mode: 'all', conditions: [{ field: 'role', op: 'is', value: 'body' }] })} />
          <BulkAnnotations count={matched.length} disabled={busy || matching || !selectionActive || !!selectorError} tags={allTags} draft={bulkTagDraft} onDraft={setBulkTagDraft} onApply={bulkAnnotate} action={bulkAction} onAction={setBulkAction} role={bulkRole} onRole={setBulkRole} />
          <FormatPanel draft={formatDraft} onChange={setFormatDraft} preview={preview}
            onApply={() => void applyPreview()} onCancel={clearFormatDraft}
            busy={busy} count={matched.length} ready={live.ready} pending={live.pending} error={live.error}
            selectionActive={selectionActive} blocks={doc.blocks} matched={matched}
            onRetry={() => { if (live.conflict) void run(async () => acceptDoc(await api.get(doc.id))); else live.retry(); }} />
        </fieldset> : tab === 'templates' ? <TemplatePanel doc={doc} library={library} draft={template} extraction={extraction} busy={busy}
          dirty={templateDirty(template, library?.items || [])} preview={templateLive.preview} ready={templateLive.ready} pending={templateLive.pending} error={templateLive.error}
          scope={templateScope} scopeReady={templateScopeReady} scopeCount={matched.length} onScope={value => { setTemplateScope(value); setTemplatePreviewEnabled(true); }}
          previewEnabled={templatePreviewEnabled} onPreviewToggle={() => setTemplatePreviewEnabled(value => !value)}
          onRefresh={refreshTemplates} onNew={() => editTemplate(null, true)} onEdit={editTemplate} onBack={() => editTemplate(null)}
          onRetry={() => { if (templateLive.conflict) void run(async () => acceptDoc(await api.get(doc.id))); else templateLive.retry(); }}
          onChange={value => { setTemplate(value); setTemplatePreviewEnabled(true); }} onExtract={extractTemplate} onExtraction={setExtraction} onAdopt={adoptExtraction}
          onSave={saveTemplate} onDelete={deleteTemplate} onImport={importTemplate} onApply={applyTemplate}
        /> : <ObjectInspector block={currentBlock} busy={busy} onFormat={formatObject} onClearOverrides={clearOverrides} chapters={doc.chapters} sections={doc.sections} />}</div>
      </aside>
    </div> : <main className="loading-screen">{busy ? <><LoaderCircle className="spin" size={32} /><h2>正在打开文档工作台</h2></> : <><FileInput size={36} /><h2>打开你的第一份文档</h2><p>导入 Word 文件，或从内置示例开始。</p><button className="primary" onClick={() => void run(async () => newDocument(await api.demo()))}>打开示例</button></>}</main>}
    <footer className="status-bar">
      <div><span className="status-dot" /><span>本地运行</span><span className="status-divider" />{doc && <><span>{doc.blocks.length} 个段落</span><span className="status-divider" /><span>{!selectionActive ? '未筛选' : matching ? '正在匹配…' : `筛选匹配 ${matched.length} 段`}</span>{selectionActive && <button disabled={busy} onClick={exitSelection}>退出筛选</button>}</>}</div>
      <div className="history-controls"><button disabled={busy || !doc?.undo_label} onClick={() => history('undo')} title={doc?.undo_label ? `撤销：${doc.undo_label} (Ctrl+Z)` : '没有可撤销操作'}><Undo2 size={14} />撤销</button><button disabled={busy || !doc?.redo_label} onClick={() => history('redo')} title={doc?.redo_label ? `重做：${doc.redo_label} (Ctrl+Shift+Z)` : '没有可重做操作'}><Redo2 size={14} />重做</button><span className="status-divider" /><span>即时格式预览</span></div>
    </footer>
    {pendingSwitch && <DraftDialog message={pendingSwitch.message} onCancel={() => setPendingSwitch(null)} onDiscard={() => { const action = pendingSwitch.action; setPendingSwitch(null); action(); }} />}
    {report && <ExportInspection report={report} onClose={() => setReport(null)} />}
    {message && <div className={`toast ${message.error ? 'error' : ''}`} role={message.error ? 'alert' : 'status'}><span>{message.error ? '!' : <Check size={16} />}</span><p>{message.text}</p><button className="icon-button" onClick={() => setMessage(null)} aria-label="关闭提示"><X size={14} /></button></div>}
  </div>;
}
