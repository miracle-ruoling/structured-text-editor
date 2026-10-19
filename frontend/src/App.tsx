import { Check, CheckCheck, Download, FileInput, Fingerprint, FolderDown, LoaderCircle, Redo2, SlidersHorizontal, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentCanvas } from './components/DocumentCanvas';
import { DraftDialog } from './components/DraftDialog';
import { FormatPanel } from './components/FormatPanel';
import { ObjectInspector } from './components/ObjectInspector';
import { SelectorBuilder } from './components/SelectorBuilder';
import { Sidebar } from './components/Sidebar';
import { api, ApiError } from './lib/api';
import type { AnnotationPatch, DocumentView, FormatPatch, Preview, RecentProject, Selector } from './lib/types';
import { afterApply, scopedPatch, selectorComplete } from './lib/workspace';
import type { FormatTab } from './lib/workspace';
import { activateSelection, emptySelectionSession, leaveSelection, nextKey, rangeCondition } from './lib/selection';

const LAST_PROJECT = 'wenxu.last-project.v1';
type ActivePreview = Preview & { selector: Selector; patch: FormatPatch };

export default function App() {
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [selectionSession, setSelectionSession] = useState(emptySelectionSession);
  const { selector, active: selectionActive, previous: previousSelector } = selectionSession;
  const [matched, setMatched] = useState<string[]>([]);
  const [matching, setMatching] = useState(false);
  const [selectorError, setSelectorError] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState<string[]>([]);
  const [patch, setPatch] = useState<FormatPatch>({});
  const [formatTab, setFormatTab] = useState<FormatTab>('paragraph');
  const [includeOther, setIncludeOther] = useState(false);
  const [locked, setLocked] = useState(false);
  const [preview, setPreview] = useState<ActivePreview | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState('');
  const [tab, setTab] = useState<'batch' | 'object'>('batch');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [showTags, setShowTags] = useState(true);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pendingSwitch, setPendingSwitch] = useState<{ action: () => void; objectOnly: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const operationLock = useRef(false);
  const hasDraft = !!Object.keys(patch).length || !!tagDraft.trim() || !!preview || !!saveName.trim();

  const acceptDoc = useCallback((value: DocumentView) => {
    setDoc(value); setPreview(null);
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
      acceptDoc(await api.history(doc, direction));
      setMessage({ text: direction === 'undo' ? '已撤销上一次操作' : '已重做操作', error: false });
    });
  }, [doc, busy, run, acceptDoc]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.isComposing || pendingSwitch) return;
      if (event.key === 'Escape' && preview && !busy) {
        event.preventDefault(); setPreview(null); return;
      }
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select') || target.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, preview, busy, pendingSwitch]);

  function changeSelector(value: Selector, explicitAll = false) {
    const next = activateSelection(selectionSession, value, explicitAll);
    setPreview(null); setMatched([]); setSelectorError(null); setSelectionSession(next); setTab('batch');
    setMatching(next.active);
    if (!next.active) setOnlyMatches(false);
  }
  function exitSelection() {
    setSelectionSession(leaveSelection(selectionSession)); setMatched([]); setMatching(false);
    setSelectorError(null); setOnlyMatches(false); setPreview(null);
  }
  function newDocument(document: DocumentView) {
    acceptDoc(document); setCurrent(null); setTagDraft(''); setPatch({}); setLocked(false);
    setFormatTab('paragraph'); setIncludeOther(false); setTab('batch'); setOnlyMatches(false);
    setSelectionSession(emptySelectionSession()); setMatched([]);
    setSaveName(''); setMarking(false); setMarked([]); setSelectorError(null);
  }
  function guardSwitch(action: () => void, objectOnly = false) {
    if (busy) return;
    if (objectOnly ? !!tagDraft.trim() : hasDraft) setPendingSwitch({ action, objectOnly });
    else action();
  }
  function pickObject(id: string) {
    if (busy) return;
    if (id === current) { setTab('object'); return; }
    guardSwitch(() => { setCurrent(id); setTagDraft(''); setTab('object'); }, true);
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
  function annotate(id: string, annotation: AnnotationPatch): Promise<boolean> {
    if (!doc) return Promise.resolve(false);
    return run(async () => {
      acceptDoc(await api.annotate(doc, id, annotation));
      setMessage({ text: '标注已自动保存，可撤销', error: false });
    });
  }
  async function startPreview() {
    if (!doc || !selectionActive || !selectorComplete(selector) || matching || selectorError || !matched.length) return;
    const submitted = scopedPatch(patch, formatTab, includeOther);
    await run(async () => {
      const result = await api.preview(doc, selector, submitted);
      setPreview({ ...result, selector: structuredClone(selector), patch: { ...submitted } });
    });
  }

  function addMarkedRange() {
    if (busy || !marked.length) return;
    const base: Selector = selectionActive ? selector : { mode: 'all', conditions: [] };
    if (base.conditions.length >= 30) { setMessage({ text: '最多 30 个条件，请先删除不需要的条件再添加。', error: true }); return; }
    const condition = rangeCondition(marked, nextKey(base));
    changeSelector({ ...base, conditions: [...base.conditions, condition], expression: base.mode === 'expression' ? (base.expression?.trim() ? `(${base.expression}) AND $${condition.key}` : `$${condition.key}`) : '' });
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
    if (!doc || !preview) return;
    await run(async () => {
      acceptDoc(await api.apply({ ...doc, revision: preview.revision }, preview.selector, preview.patch));
      setPatch(afterApply(patch, locked));
      if (!locked) setIncludeOther(false);
      setMessage({ text: `已调整 ${preview.ids.length} 个段落${locked ? '，草稿已锁定保留' : '，格式草稿已清空'}`, error: false });
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
        <button className="primary" disabled={busy || !doc} onClick={() => download('docx')}><Download size={15} />导出 Word</button>
      </div>
    </header>
    {doc ? <div className="workspace">
      <Sidebar doc={doc} recent={recent}
        onOpen={id => guardSwitch(() => void run(async () => newDocument(await api.get(id))))}
        selector={selectionActive ? selector : null} onSelect={value => changeSelector(value, true)}
        onDeleteSelector={deleteSavedSelector}
        onDemo={() => guardSwitch(() => void run(async () => newDocument(await api.demo())))} disabled={busy} />
      <DocumentCanvas doc={doc} matched={matched} current={tab === 'object' && !preview ? current : null} busy={busy}
        onPick={pickObject} preview={preview} patch={preview?.patch || {}} onExitPreview={() => setPreview(null)}
        showTags={showTags} onShowTags={() => setShowTags(!showTags)} onlyMatches={onlyMatches}
        marking={marking} marked={marked} onMarking={() => setMarking(!marking)}
        onMark={id => setMarked(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])}
        onClearMarks={() => setMarked([])} onAddRange={addMarkedRange}
        onOnlyMatches={() => setOnlyMatches(!onlyMatches)} zoom={zoom} onZoom={setZoom} selectionActive={selectionActive} />
      <aside className="inspector">
        <div className="inspector-tabs" role="tablist" aria-label="工作面板">
          <button role="tab" aria-selected={tab === 'batch'} className={tab === 'batch' ? 'active' : ''} onClick={() => setTab('batch')}><SlidersHorizontal size={15} />批量操作</button>
          <button role="tab" aria-selected={tab === 'object'} className={tab === 'object' ? 'active' : ''} onClick={() => setTab('object')}><Fingerprint size={15} />对象属性</button>
        </div>
        <div className="inspector-scroll">{tab === 'batch' ? <fieldset className="batch-fieldset" disabled={busy}>
          <SelectorBuilder value={selector} onChange={value => changeSelector(value)} tags={allTags} count={matched.length}
            error={selectorError} marked={marked} saveName={saveName} onSaveName={setSaveName} onSave={() => void saveCurrentSelector()} savedCount={doc.saved_selectors.length}
            loading={matching} active={selectionActive} onExit={exitSelection} canResume={previousSelector !== null}
            onResume={() => { if (previousSelector) changeSelector(previousSelector, true); }}
            onStart={() => changeSelector({ mode: 'all', conditions: [{ field: 'role', op: 'is', value: 'body' }] })} />
          <FormatPanel patch={patch} onChange={value => { setPreview(null); setPatch(value); }} preview={preview}
            onPreview={() => void startPreview()} onApply={() => void applyPreview()} onCancel={() => setPreview(null)}
            busy={busy || matching || !selectionActive || !!selectorError} count={matched.length} tab={formatTab}
            onTab={value => { setFormatTab(value); setIncludeOther(false); setPreview(null); }}
            locked={locked} onLock={setLocked} includeOther={includeOther}
            onIncludeOther={value => { setIncludeOther(value); setPreview(null); }} />
        </fieldset> : <ObjectInspector block={currentBlock} busy={busy} onSave={annotate} tagDraft={tagDraft} onTagDraft={setTagDraft} onFormat={id => changeSelector({ mode: 'all', conditions: [rangeCondition([id])] })} />}</div>
      </aside>
    </div> : <main className="loading-screen">{busy ? <><LoaderCircle className="spin" size={32} /><h2>正在打开文档工作台</h2></> : <><FileInput size={36} /><h2>打开你的第一份文档</h2><p>导入 Word 文件，或从内置示例开始。</p><button className="primary" onClick={() => void run(async () => newDocument(await api.demo()))}>打开示例</button></>}</main>}
    <footer className="status-bar">
      <div><span className="status-dot" /><span>本地运行</span><span className="status-divider" />{doc && <><span>{doc.blocks.length} 个段落</span><span className="status-divider" /><span>{!selectionActive ? '未筛选' : matching ? '正在匹配…' : `筛选匹配 ${matched.length} 段`}</span>{selectionActive && <button disabled={busy} onClick={exitSelection}>退出筛选</button>}</>}</div>
      <div className="history-controls"><button disabled={busy || !doc?.undo_label} onClick={() => history('undo')} title={doc?.undo_label ? `撤销：${doc.undo_label} (Ctrl+Z)` : '没有可撤销操作'}><Undo2 size={14} />撤销</button><button disabled={busy || !doc?.redo_label} onClick={() => history('redo')} title={doc?.redo_label ? `重做：${doc.redo_label} (Ctrl+Shift+Z)` : '没有可重做操作'}><Redo2 size={14} />重做</button><span className="status-divider" /><span>阶段 2A · 选择范围</span></div>
    </footer>
    {pendingSwitch && <DraftDialog objectOnly={pendingSwitch.objectOnly} onCancel={() => setPendingSwitch(null)} onDiscard={() => { const action = pendingSwitch.action; setPendingSwitch(null); action(); }} />}
    {message && <div className={`toast ${message.error ? 'error' : ''}`} role={message.error ? 'alert' : 'status'}><span>{message.error ? '!' : <Check size={16} />}</span><p>{message.text}</p><button className="icon-button" onClick={() => setMessage(null)} aria-label="关闭提示"><X size={14} /></button></div>}
  </div>;
}
