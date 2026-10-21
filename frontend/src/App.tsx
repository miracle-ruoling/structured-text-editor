import { Check, CheckCheck, Download, FileInput, Fingerprint, FolderDown, Layers, LoaderCircle, Redo2, SlidersHorizontal, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentCanvas } from './components/DocumentCanvas';
import { DraftDialog } from './components/DraftDialog';
import { ExportInspection } from './components/ExportInspection';
import { FormatPanel } from './components/FormatPanel';
import { BulkAnnotations } from './components/BulkAnnotations';
import { RulePanel } from './components/RulePanel';
import { ObjectInspector } from './components/ObjectInspector';
import { SelectorBuilder } from './components/SelectorBuilder';
import { Sidebar } from './components/Sidebar';
import { api, ApiError } from './lib/api';
import type { AnnotationPatch, BulkAnnotation, DocumentView, ExportReport, FormatRule, RecentProject, Role, RuleAction, RulePreview, Selector } from './lib/types';
import { selectorComplete } from './lib/workspace';
import { emptyFormatDraft } from './lib/formatDraft';
import { useFormatPreview } from './lib/useFormatPreview';
import { activateSelection, emptySelectionSession, endPointerGesture, leaveSelection, selectParagraph } from './lib/selection';
import type { SelectionSession } from './lib/selection';
import { newRule, ruleDraft, ruleIsDirty } from './lib/rules';

const LAST_PROJECT = 'wenxu.last-project.v1';

export default function App() {
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [selectionSession, setSelectionSession] = useState(emptySelectionSession);
  const { selector, active: selectionActive, previous: previousSelector } = selectionSession;
  const [matched, setMatched] = useState<string[]>([]);
  const [matching, setMatching] = useState(false);
  const [selectorError, setSelectorError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [formatDraft, setFormatDraft] = useState(emptyFormatDraft);
  const { patch, sizeChange } = formatDraft;
  const [report, setReport] = useState<ExportReport | null>(null);
  const [compare, setCompare] = useState(false);
  const [rule, setRule] = useState<FormatRule | null>(null);
  const [rulePreview, setRulePreview] = useState<RulePreview | null>(null);
  const [bulkTagDraft, setBulkTagDraft] = useState('');
  const [bulkAction, setBulkAction] = useState<BulkAnnotation['action']>('add_tag');
  const [bulkRole, setBulkRole] = useState<Role>('body');
  const [current, setCurrent] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [tab, setTab] = useState<'batch' | 'object' | 'rules'>('batch');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [showTags, setShowTags] = useState(true);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pendingSwitch, setPendingSwitch] = useState<{ action: () => void; objectOnly: boolean; message?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const operationLock = useRef(false);
  const hasDraft = !!Object.keys(patch).length || !!sizeChange || !!tagDraft.trim() || !!saveName.trim() || !!bulkTagDraft.trim() || !!rulePreview || ruleIsDirty(rule, doc?.rules || []);

  const live = useFormatPreview(doc, selector, formatDraft, tab === 'batch' && !busy && selectionActive && selectorComplete(selector) && !matching && !selectorError && matched.length > 0);
  const preview = live.preview;
  const clearFormatDraft = useCallback(() => { setFormatDraft(emptyFormatDraft()); }, []);

  useEffect(() => {
    const finish = () => setSelectionSession(endPointerGesture);
    const release = (event: KeyboardEvent) => { if (event.key === 'Control' || event.key === 'Meta') finish(); };
    const visibility = () => { if (document.hidden) finish(); };
    window.addEventListener('keyup', release);
    window.addEventListener('blur', finish);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keyup', release); window.removeEventListener('blur', finish);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  const acceptDoc = useCallback((value: DocumentView) => {
    setDoc(value); setRulePreview(null); setReport(null);
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
      } catch (error) { if (active) setMessage({ text: (error as Error).message, error: true }); }
      finally { if (active) setBusy(false); }
    }
    void start();
    return () => { active = false; };
  }, [acceptDoc]);

  useEffect(() => {
    setSelectorError(null);
    if (!doc || !selectionActive || !selectorComplete(selector)) { setMatched([]); setMatching(false); return; }
    let active = true;
    setMatching(true); setMatched([]);
    const timer = setTimeout(() => {
      api.select(doc.id, selector).then(async result => {
        if (!active) return;
        if (result.revision !== doc.revision) {
          const updated = await api.get(doc.id);
          if (active) acceptDoc(updated);
        } else setMatched(result.ids);
      }).catch(error => {
        if (active) { setMatched([]); setSelectorError(error.message); }
      }).finally(() => { if (active) setMatching(false); });
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [doc, selector, selectionActive, acceptDoc]);

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
      acceptDoc(await api.history(doc, direction)); clearFormatDraft();
      setMessage({ text: direction === 'undo' ? '已撤销上一次操作' : '已重做操作', error: false });
    });
  }, [doc, busy, run, acceptDoc, clearFormatDraft]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.isComposing || pendingSwitch || report) return;
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && (rulePreview || (tab === 'batch' && (Object.keys(patch).length || sizeChange))) && !busy) {
        event.preventDefault(); if (rulePreview) setRulePreview(null); else clearFormatDraft(); return;
      }
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select') || target.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, patch, sizeChange, tab, rulePreview, busy, pendingSwitch, report, clearFormatDraft]);

  function changeSelector(value: Selector, explicitAll = false) {
    const next = activateSelection(selectionSession, value, explicitAll);
    acceptSelection(next);
  }
  function acceptSelection(next: SelectionSession) {
    setRulePreview(null); setMatched([]); setSelectorError(null); setSelectionSession(next); setTab('batch');
    setMatching(next.active);
    if (!next.active) setOnlyMatches(false);
  }
  function exitSelection() {
    setSelectionSession(leaveSelection(selectionSession)); setMatched([]); setMatching(false);
    setSelectorError(null); setOnlyMatches(false);
  }
  function newDocument(document: DocumentView) {
    acceptDoc(document); setCurrent(null); setTagDraft(''); clearFormatDraft(); setCompare(false); setTab('batch'); setOnlyMatches(false);
    setSelectionSession(emptySelectionSession()); setMatched([]);
    setSaveName(''); setSelectorError(null);
    setRule(null); setRulePreview(null); setBulkTagDraft('');
    setBulkAction('add_tag'); setBulkRole('body');
  }
  function guardSwitch(action: () => void, objectOnly = false) {
    if (busy) return;
    if (objectOnly ? !!tagDraft.trim() : hasDraft) setPendingSwitch({ action, objectOnly });
    else action();
  }
  function pickObject(id: string) {
    if (busy) return;
    if (id === current) { changePanel('object'); return; }
    guardSwitch(() => { setCurrent(id); setTagDraft(''); changePanel('object'); }, true);
  }
  function pickParagraph(id: string, extend = false, independentGesture = false) {
    if (busy || !doc) return;
    const block = doc.blocks.find(item => item.id === id);
    if (!block) return;
    const isolated = independentGesture || (id !== current && !!tagDraft.trim());
    const action = () => {
      setCurrent(id); if (id !== current) setTagDraft('');
      if (!block.editable) {
        setSelectionSession(endPointerGesture);
        if (!selectionActive) changePanel('object');
        return;
      }
      try {
        const base = isolated ? endPointerGesture(selectionSession) : selectionSession;
        const next = selectParagraph(base, id, extend);
        if (next.selector !== selectionSession.selector) acceptSelection(isolated ? endPointerGesture(next) : next);
        else setSelectionSession(next);
      } catch (error) { setMessage({ text: (error as Error).message, error: true }); }
    };
    if (id === current) action(); else guardSwitch(action, true);
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
  function annotate(id: string, annotation: AnnotationPatch): Promise<boolean> {
    if (!doc) return Promise.resolve(false);
    return run(async () => {
      acceptDoc(await api.annotate(doc, id, annotation));
      setMessage({ text: '标注已自动保存，可撤销', error: false });
    });
  }
  function changePanel(value: typeof tab) {
    if (busy) return;
    setTab(value); setRulePreview(null); setSelectionSession(endPointerGesture);
  }
  function formatObject(id: string) {
    if (busy || !doc?.blocks.some(block => block.id === id && block.editable)) return;
    const action = () => {
      setCurrent(id); if (id !== current) setTagDraft('');
      acceptSelection(selectParagraph(leaveSelection(selectionSession), id, false));
    };
    if (id === current) action(); else guardSwitch(action, true);
  }
  function editRule(value: FormatRule | null) {
    const action = () => { setRule(value ? ruleDraft(value) : null); setRulePreview(null); setTab('rules'); setSelectionSession(endPointerGesture); };
    if (ruleIsDirty(rule, doc?.rules || [])) setPendingSwitch({ action, objectOnly: false, message: '此规则还有未保存的编辑。继续会丢弃规则草稿；批量格式草稿和已保存的内容不受影响。' });
    else action();
  }
  async function previewRule() {
    if (!doc || !rule) return;
    const request: RuleAction = { action: 'save', rule: ruleDraft(rule) };
    await run(async () => {
      const result = await api.previewRule(doc, request);
      setOnlyMatches(false); setRulePreview({ ...result, request });
    });
  }
  async function saveRulePreview() {
    if (!doc || !rulePreview) return;
    await run(async () => {
      acceptDoc(await api.applyRule({ ...doc, revision: rulePreview.revision }, rulePreview.request));
      setRule(null); setMessage({ text: '持续规则已保存，类别与标签变化后自动重新匹配，可撤销', error: false });
    });
  }
  function changeRule(action: RuleAction) {
    if (!doc) return;
    void run(async () => {
      acceptDoc(await api.applyRule(doc, action));
      setMessage({ text: '规则已更新，格式已重新计算，可撤销', error: false });
    });
  }
  async function bulkAnnotate(action: BulkAnnotation) {
    if (!doc || !selectionActive || matching || selectorError || !matched.length) return false;
    const count = matched.length;
    return run(async () => {
      acceptDoc(await api.bulkAnnotate(doc, selector, action));
      setMessage({ text: `已对原筛选范围 ${count} 段执行标注，持续规则已重新匹配，可撤销`, error: false });
    });
  }
  function clearOverrides(id: string, keys: string[]) {
    if (!doc) return;
    void run(async () => {
      acceptDoc(await api.clearOverrides(doc, id, keys));
      setMessage({ text: '已清除本项目局部覆盖，恢复规则或原文档格式，可撤销', error: false });
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
      <DocumentCanvas doc={doc} matched={tab === 'rules' ? [] : matched} current={current} busy={busy} focusMuted={selectionActive && !selectionSession.direct}
        onPick={pickParagraph} onInspect={pickObject} onAddCondition={id => pickParagraph(id, true, true)} onFormat={formatObject} preview={rulePreview || preview} patch={{}} livePreview={tab === 'batch'} previewPending={live.pending} previewError={live.error} compare={compare} onCompare={() => setCompare(!compare)} onExitPreview={() => { if (rulePreview) setRulePreview(null); else clearFormatDraft(); }}
        showTags={showTags} onShowTags={() => setShowTags(!showTags)} onlyMatches={tab !== 'rules' && onlyMatches}
        onOnlyMatches={() => setOnlyMatches(!onlyMatches)} zoom={zoom} onZoom={setZoom} selectionActive={tab !== 'rules' && selectionActive} />
      <aside className="inspector">
        <div className="inspector-tabs" role="tablist" aria-label="工作面板">
          <button disabled={busy} role="tab" aria-selected={tab === 'batch'} className={tab === 'batch' ? 'active' : ''} onClick={() => changePanel('batch')}><SlidersHorizontal size={15} />操作</button>
          <button disabled={busy} role="tab" aria-selected={tab === 'object'} className={tab === 'object' ? 'active' : ''} onClick={() => changePanel('object')}><Fingerprint size={15} />对象属性</button>
          <button disabled={busy} role="tab" aria-selected={tab === 'rules'} className={tab === 'rules' ? 'active' : ''} onClick={() => changePanel('rules')}><Layers size={15} />规则</button>
        </div>
        <div className="inspector-scroll">{tab === 'batch' ? <fieldset className="batch-fieldset" disabled={busy}>
          <SelectorBuilder value={selector} onChange={value => changeSelector(value)} tags={allTags} count={matched.length} chapters={doc.chapters} sections={doc.sections}
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
        </fieldset> : tab === 'rules' ? <RulePanel rules={doc.rules} draft={rule} preview={rulePreview} busy={busy} chapters={doc.chapters} sections={doc.sections}
          canUseScope={selectionActive && selectorComplete(selector) && !matching && !selectorError}
          onCreate={() => editRule(newRule(crypto.randomUUID().replaceAll('-', ''), selector))} onEdit={editRule}
          onChange={value => { setRule(value); setRulePreview(null); }} onDiscard={() => editRule(null)}
          onUseScope={() => { if (rule) { setRule({ ...rule, selector: structuredClone(selector) }); setRulePreview(null); } }}
          onLoadScope={() => { if (rule) changeSelector(structuredClone(rule.selector), true); }}
          onPreview={() => void previewRule()} onApply={() => void saveRulePreview()} onCancel={() => setRulePreview(null)} onAction={changeRule}
        /> : <ObjectInspector block={currentBlock} busy={busy} onSave={annotate} tagDraft={tagDraft} onTagDraft={setTagDraft} onFormat={formatObject} onClearOverrides={clearOverrides} chapters={doc.chapters} sections={doc.sections} />}</div>
      </aside>
    </div> : <main className="loading-screen">{busy ? <><LoaderCircle className="spin" size={32} /><h2>正在打开文档工作台</h2></> : <><FileInput size={36} /><h2>打开你的第一份文档</h2><p>导入 Word 文件，或从内置示例开始。</p><button className="primary" onClick={() => void run(async () => newDocument(await api.demo()))}>打开示例</button></>}</main>}
    <footer className="status-bar">
      <div><span className="status-dot" /><span>本地运行</span><span className="status-divider" />{doc && <><span>{doc.blocks.length} 个段落</span><span className="status-divider" /><span>{!selectionActive ? '未筛选' : matching ? '正在匹配…' : `筛选匹配 ${matched.length} 段`}</span>{selectionActive && <button disabled={busy} onClick={exitSelection}>退出筛选</button>}</>}</div>
      <div className="history-controls"><button disabled={busy || !doc?.undo_label} onClick={() => history('undo')} title={doc?.undo_label ? `撤销：${doc.undo_label} (Ctrl+Z)` : '没有可撤销操作'}><Undo2 size={14} />撤销</button><button disabled={busy || !doc?.redo_label} onClick={() => history('redo')} title={doc?.redo_label ? `重做：${doc.redo_label} (Ctrl+Shift+Z)` : '没有可重做操作'}><Redo2 size={14} />重做</button><span className="status-divider" /><span>即时格式预览</span></div>
    </footer>
    {pendingSwitch && <DraftDialog objectOnly={pendingSwitch.objectOnly} message={pendingSwitch.message} onCancel={() => setPendingSwitch(null)} onDiscard={() => { const action = pendingSwitch.action; setPendingSwitch(null); action(); }} />}
    {report && <ExportInspection report={report} onClose={() => setReport(null)} />}
    {message && <div className={`toast ${message.error ? 'error' : ''}`} role={message.error ? 'alert' : 'status'}><span>{message.error ? '!' : <Check size={16} />}</span><p>{message.text}</p><button className="icon-button" onClick={() => setMessage(null)} aria-label="关闭提示"><X size={14} /></button></div>}
  </div>;
}
