import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Heading from '@tiptap/extension-heading';
import { NativeIdentity, fromEditor, toEditor } from '../lib/nativeEditor';
import { NativeSaveQueue, nativeBackup } from '../lib/native';
import type { NativeView } from '../lib/native';
import { request } from '../lib/api';
import '../styles/native.css';

const LAST = 'wenxu.last-native.v1';
type Recent = { id: string; name: string; updated_at: string };

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function NativeWorkspace() {
  const [, refresh] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const queue = useRef<NativeSaveQueue | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const actionLock = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const historyRef = useRef<(direction: 'undo' | 'redo') => void>(() => {});
  const notify = () => {
    refresh(n => n + 1);
    const saved = queue.current?.saved;
    if (saved) setRecent(items => items.map(item => item.id === saved.id
      ? { ...item, name: saved.content.name, updated_at: saved.updated_at } : item));
  };
  const editor = useEditor({
    extensions: [Document, Paragraph, Text, Heading.configure({ levels: [1, 2, 3] }), NativeIdentity,
      Extension.create({ name: 'nativeHistoryKeys', addKeyboardShortcuts: () => ({
        'Mod-z': () => { historyRef.current('undo'); return true; },
        'Mod-Shift-z': () => { historyRef.current('redo'); return true; },
        'Mod-y': () => { historyRef.current('redo'); return true; },
      }) })],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editable: false,
    editorProps: { attributes: { 'aria-label': '原生文档正文', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor }) => {
      const q = queue.current;
      if (!q) return;
      q.edit(fromEditor(editor.state.doc, q.draft.name));
      scheduleSave();
    },
    onSelectionUpdate: notify,
  });

  function scheduleSave() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (editor?.view.composing) { scheduleSave(); return; }
      const q = queue.current;
      if (q && !q.error) void q.flush().catch(() => {});
    }, 700);
  }

  function accept(view: NativeView) {
    clearTimeout(timer.current);
    queue.current = new NativeSaveQueue(view, (saved, content) => request(`/native/${saved.id}/save`, { revision: saved.revision, content }), notify);
    editor?.commands.setContent(toEditor(view.content), { emitUpdate: false });
    localStorage.setItem(LAST, view.id);
    setError(''); notify();
    void request<Recent[]>('/native').then(setRecent).catch(e => setError(e.message));
  }

  useEffect(() => {
    if (!editor) return;
    let active = true;
    void (async () => {
      try {
        const items = await request<Recent[]>('/native');
        if (!active) return;
        setRecent(items);
        const last = localStorage.getItem(LAST);
        const id = items.some(item => item.id === last) ? last : items[0]?.id;
        if (id) { const view = await request<NativeView>(`/native/${id}`); if (active) accept(view); }
      } catch (e) { if (active) setError((e as Error).message); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; clearTimeout(timer.current); };
  }, [editor]); // The editor instance is stable across keystrokes.

  useEffect(() => { editor?.setEditable(!loading && !acting && !!queue.current); }, [editor, loading, acting, queue.current?.saved.id]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (queue.current?.dirty || queue.current?.flight || actionLock.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, []);

  async function act(action: () => Promise<void>, flush = true) {
    if (actionLock.current || editor?.view.composing) return;
    actionLock.current = true; setActing(true); setError(''); clearTimeout(timer.current);
    editor?.setEditable(false);
    try { if (flush) await queue.current?.flush(); await action(); }
    catch (e) { setError((e as Error).message); }
    finally { actionLock.current = false; setActing(false); }
  }

  function history(direction: 'undo' | 'redo') {
    void act(async () => {
      const q = queue.current;
      if (!q) return;
      accept(await request<NativeView>(`/native/${q.saved.id}/history/${direction}`, { revision: q.saved.revision }));
    });
  }
  historyRef.current = history;

  function download(kind: 'docx' | 'project') {
    void act(async () => {
      const view = queue.current!.saved;
      const response = await fetch(`/api/native/${view.id}/export/${kind}?revision=${view.revision}`);
      if (!response.ok) throw new Error((await response.json()).detail || '导出失败');
      downloadBlob(await response.blob(), view.content.name + (kind === 'docx' ? '.docx' : '.wnative.json'));
    });
  }

  const q = queue.current;
  const blocked = loading || acting;
  return <div className="app-shell native-shell">
    <header className="app-header">
      <div className="brand"><strong>文序</strong><span className="brand-caption">原生写作</span></div>
      <div className="header-actions">
        <span className="save-status" role="status">{loading ? '正在打开' : acting ? '处理中' : q?.error ? '保存失败 · 本地输入保留' : q?.flight ? '正在保存' : q?.dirty ? '尚未保存' : q ? '已保存到本机' : '未打开文档'}</span>
        <button className="secondary" disabled={blocked} onClick={() => void act(async () => accept(await request<NativeView>('/native', {})))}>新建</button>
        <button className="secondary" disabled={blocked} onClick={() => input.current?.click()}>打开原生备份</button>
        <input ref={input} type="file" hidden accept=".json" onChange={e => {
          const file = e.target.files?.[0]; e.target.value = '';
          if (file) void act(async () => { const data = new FormData(); data.append('file', file); accept(await request<NativeView>('/native/import', undefined, data)); });
        }} />
        <button className="secondary" disabled={blocked || !q} onClick={() => download('project')}>导出原生备份</button>
        <button className="primary" disabled={blocked || !q} onClick={() => download('docx')}>导出 Word</button>
      </div>
    </header>
    <main className="native-layout">
      <aside className="native-sidebar"><a href="/" target="_blank" rel="noopener noreferrer">DOCX 格式工作台 ↗</a><h2>最近原生文档</h2>
        {recent.map(item => <button key={item.id} disabled={blocked} aria-current={q?.saved.id === item.id ? 'page' : undefined}
          onClick={() => void act(async () => accept(await request<NativeView>(`/native/${item.id}`)))} title={`${item.name} · ${item.id.slice(0, 8)}`}>{item.name}<small>{new Date(item.updated_at).toLocaleString('zh-CN')}</small></button>)}
      </aside>
      <section className="native-content">
        {(error || q?.error) && <div className="native-error" role="alert"><span>{error || q?.error?.message}</span>
          {q?.error && <><button disabled={blocked} onClick={() => void act(async () => {})}>重试保存</button>
            <button onClick={() => downloadBlob(new Blob([JSON.stringify(nativeBackup(q.saved, q.draft))], { type: 'application/json' }), '本地草稿.wnative.json')}>下载本地草稿</button></>}
        </div>}
        {q ? <>
          <div className="native-toolbar">
            <input aria-label="文档名称" maxLength={120} value={q.draft.name} disabled={blocked} onChange={e => { q.edit({ ...q.draft, name: e.target.value }); scheduleSave(); }} />
            <select aria-label="段落类型" disabled={blocked} value={editor?.isActive('heading') ? String(editor.getAttributes('heading').level) : '0'} onChange={e => {
              const level = Number(e.target.value);
              if (level) editor?.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run();
              else editor?.chain().focus().setParagraph().run();
            }}><option value="0">正文</option><option value="1">一级标题</option><option value="2">二级标题</option><option value="3">三级标题</option></select>
            <button disabled={blocked || (!q.dirty && !q.saved.can_undo)} onClick={() => history('undo')} title="Ctrl+Z">撤销</button>
            <button disabled={blocked || q.dirty || !q.saved.can_redo} onClick={() => history('redo')} title="Ctrl+Shift+Z">重做</button>
          </div>
        </> : !loading && <div className="native-empty"><h1>从一段文字开始</h1><button className="primary" onClick={() => void act(async () => accept(await request<NativeView>('/native', {})))}>新建原生文档</button></div>}
        <div className="native-paper" hidden={!q}><EditorContent editor={editor} /></div>
      </section>
    </main>
    <footer className="status-bar"><span>原生写作 · 正文与三级标题</span><span>{q ? `${q.draft.blocks.length} 段 · ${q.draft.blocks.reduce((n, b) => n + b.text.length, 0)} 字符` : ''}</span></footer>
  </div>;
}
