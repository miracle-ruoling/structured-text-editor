import { Check, CheckCheck, Download, FileInput, Fingerprint, FolderDown, LoaderCircle, Redo2, SlidersHorizontal, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocumentCanvas } from './components/DocumentCanvas';
import { FormatPanel } from './components/FormatPanel';
import { ObjectInspector } from './components/ObjectInspector';
import { SelectorBuilder } from './components/SelectorBuilder';
import { Sidebar } from './components/Sidebar';
import { api, ApiError } from './lib/api';
import type { DocumentView, FormatPatch, Preview, RecentProject, Role, Selector } from './lib/types';
import { bodySelector } from './lib/types';

const LAST_PROJECT = 'wenxu.last-project.v1';

export default function App() {
  const [doc, setDoc] = useState<DocumentView | null>(null);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [selector, setSelector] = useState<Selector>(structuredClone(bodySelector));
  const [matched, setMatched] = useState<string[]>([]);
  const [matching, setMatching] = useState(false);
  const [patch, setPatch] = useState<FormatPatch>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [tab, setTab] = useState<'batch' | 'object'>('batch');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [showTags, setShowTags] = useState(true);
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [zoom, setZoom] = useState(100);
  const inputRef = useRef<HTMLInputElement>(null);
  const operationLock = useRef(false);

  const acceptDoc = useCallback((value: DocumentView) => {
    setDoc(value); setPreview(null);
    void api.recent().then(setRecent).catch(() => { /* Failure to list older projects must not discard the current document. */ });
    try { localStorage.setItem(LAST_PROJECT, value.id); } catch { /* Saving the project itself uses the local service. */ }
  }, []);

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        let saved: string | null = null;
        try { saved = localStorage.getItem(LAST_PROJECT); } catch { /* Browser storage may be unavailable. */ }
        let document: DocumentView;
        try { document = saved ? await api.get(saved) : await api.demo(); }
        catch (error) { if (saved && error instanceof ApiError && error.status === 404) document = await api.demo(); else throw error; }
        if (active) acceptDoc(document);
      } catch (error) { if (active) setMessage({ text: String((error as Error).message), error: true }); }
      finally { if (active) setBusy(false); }
    }
    void start();
    return () => { active = false; };
  }, [acceptDoc]);

  useEffect(() => {
    if (!doc) return;
    let active = true;
    setMatching(true);
    const timer = setTimeout(() => {
      api.select(doc.id, selector).then(result => {
        if (!active) return;
        if (result.revision !== doc.revision) { void api.get(doc.id).then(value => { if (active) acceptDoc(value); }).catch(error => { if (active) setMessage({ text: error.message, error: true }); }); }
        else setMatched(result.ids);
      }).catch(error => { if (active) { setMatched([]); setMessage({ text: error.message, error: true }); } }).finally(() => { if (active) setMatching(false); });
    }, 120);
    return () => { active = false; clearTimeout(timer); };
  }, [doc, selector, acceptDoc]);

  useEffect(() => {
    if (!message || message.error) return;
    const timer = setTimeout(() => setMessage(null), 4500);
    return () => clearTimeout(timer);
  }, [message]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (operationLock.current) return;
    operationLock.current = true; setBusy(true); setMessage(null);
    try { await action(); }
    catch (error) {
      setMessage({ text: (error as Error).message || '操作失败，请重试。', error: true });
      if (error instanceof ApiError && error.status === 409 && doc) {
        try { acceptDoc(await api.get(doc.id)); } catch { /* Keep the original conflict message visible. */ }
      }
    } finally { operationLock.current = false; setBusy(false); }
  }, [doc, acceptDoc]);

  const history = useCallback((direction: 'undo' | 'redo') => {
    if (!doc || busy || !(direction === 'undo' ? doc.undo_label : doc.redo_label)) return;
    void run(async () => { acceptDoc(await api.history(doc, direction)); setMessage({ text: direction === 'undo' ? '已撤销上一次操作' : '已重做操作', error: false }); });
  }, [doc, busy, run, acceptDoc]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, select') || target.isContentEditable) return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); history(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history]);

  function changeSelector(value: Selector) { setPreview(null); setMatching(true); setSelector(value); setTab('batch'); }
  function changePatch(value: FormatPatch) { setPreview(null); setPatch(value); }
  function newDocument(document: DocumentView) { acceptDoc(document); setCurrent(null); setPatch({}); setTab('batch'); setOnlyMatches(false); }
  function importFile(file?: File) { if (file) void run(async () => { newDocument(await api.import(file)); setMessage({ text: '文档已导入并保存在本机', error: false }); }); }
  function download(kind: 'docx' | 'project') { if (doc) void run(async () => { await api.download(doc, kind); setMessage({ text: kind === 'docx' ? 'Word 文件已生成，请查看浏览器下载' : '项目包已生成，包含原文件、标注和操作历史', error: false }); }); }
  function annotate(id: string, role: Role, tags: string[]) { if (doc) void run(async () => { acceptDoc(await api.annotate(doc, id, role, tags)); setMessage({ text: '类别与标签已保存', error: false }); }); }
  const allTags = useMemo(() => [...new Set(doc?.blocks.flatMap(b => b.tags) || [])], [doc]);
  const currentBlock = doc?.blocks.find(b => b.id === current) || null;

  return <div className="app-shell">
    <header className="app-header"><div className="brand"><div className="brand-mark"><span /><span /><span /></div><strong>文序</strong><span className="brand-caption">结构化文档工作台</span></div><div className="header-actions"><span className="save-status">{busy ? <><LoaderCircle size={13} className="spin" />处理中</> : <><CheckCheck size={14} />已保存到本机</>}</span><input ref={inputRef} type="file" hidden accept=".docx,.sdoc" onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} /><button className="secondary" disabled={busy} onClick={() => inputRef.current?.click()}><FileInput size={15} />导入文件</button><button className="secondary project-save" disabled={busy || !doc} onClick={() => download('project')}><FolderDown size={15} />保存项目包</button><button className="primary" disabled={busy || !doc} onClick={() => download('docx')}><Download size={15} />导出 Word</button></div></header>
    {doc ? <div className="workspace"><Sidebar doc={doc} recent={recent} onOpen={id => void run(async () => newDocument(await api.get(id)))} selector={selector} onSelect={changeSelector} onDemo={() => void run(async () => { newDocument(await api.demo()); })} disabled={busy} /><DocumentCanvas doc={doc} matched={matched} current={current} onPick={id => { setCurrent(id); setTab('object'); }} preview={preview} patch={patch} showTags={showTags} onShowTags={() => setShowTags(!showTags)} onlyMatches={onlyMatches} onOnlyMatches={() => setOnlyMatches(!onlyMatches)} zoom={zoom} onZoom={setZoom} /><aside className="inspector"><div className="inspector-tabs" role="tablist" aria-label="工作面板"><button role="tab" aria-selected={tab === 'batch'} className={tab === 'batch' ? 'active' : ''} onClick={() => setTab('batch')}><SlidersHorizontal size={15} />批量操作</button><button role="tab" aria-selected={tab === 'object'} className={tab === 'object' ? 'active' : ''} onClick={() => setTab('object')}><Fingerprint size={15} />对象属性</button></div><div className="inspector-scroll">{tab === 'batch' ? <fieldset className="batch-fieldset" disabled={busy}><SelectorBuilder value={selector} onChange={changeSelector} tags={allTags} count={matched.length} loading={matching} /><FormatPanel patch={patch} onChange={changePatch} preview={preview} onPreview={() => void run(async () => setPreview(await api.preview(doc, selector, patch)))} onApply={() => void run(async () => { const total = preview?.ids.length; acceptDoc(await api.apply(doc, selector, patch)); setMessage({ text: `已调整 ${total} 个段落，支持整体撤销`, error: false }); })} onCancel={() => setPreview(null)} busy={busy || matching} count={matched.length} /></fieldset> : <ObjectInspector block={currentBlock} busy={busy} onSave={annotate} />}</div></aside></div> : <main className="loading-screen">{busy ? <><LoaderCircle className="spin" size={32} /><h2>正在打开文档工作台</h2></> : <><FileInput size={36} /><h2>打开你的第一份文档</h2><p>导入 Word 文件，或从内置示例开始。</p><button className="primary" onClick={() => void run(async () => newDocument(await api.demo()))}>打开示例</button></>}</main>}
    <footer className="status-bar"><div><span className="status-dot" /><span>本地运行</span><span className="status-divider" />{doc && <><span>{doc.blocks.length} 个段落</span><span className="status-divider" /><span>{matching ? '正在匹配…' : `匹配 ${matched.length} 段`}</span></>}</div><div className="history-controls"><button disabled={busy || !doc?.undo_label} onClick={() => history('undo')} title={doc?.undo_label ? `撤销：${doc.undo_label} (Ctrl+Z)` : '没有可撤销操作'}><Undo2 size={14} />撤销</button><button disabled={busy || !doc?.redo_label} onClick={() => history('redo')} title={doc?.redo_label ? `重做：${doc.redo_label} (Ctrl+Shift+Z)` : '没有可重做操作'}><Redo2 size={14} />重做</button><span className="status-divider" /><span>阶段 1 · 结构与格式</span></div></footer>
    {message && <div className={`toast ${message.error ? 'error' : ''}`} role={message.error ? 'alert' : 'status'}><span>{message.error ? '!' : <Check size={16} />}</span><p>{message.text}</p><button className="icon-button" onClick={() => setMessage(null)} aria-label="关闭提示"><X size={14} /></button></div>}
  </div>;
}
