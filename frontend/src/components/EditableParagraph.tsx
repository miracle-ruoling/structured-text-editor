import { memo, useEffect, useRef, useState } from 'react';
import type { Block } from '../lib/types';
import { caretOffset, chooserKey, focusText, paragraphChoices, selectedTextRange } from '../lib/textEditing';
import type { TextOperation } from '../lib/textEditing';
import { paragraphInsets } from '../lib/workspace';

export type TextEditorProps = {
  onEdit: (operation: TextOperation) => Promise<{ id: string; text: string } | null>;
  onTextState: (id: string, dirty: boolean, saving: boolean) => void;
  editorFocus?: { id: string; offset: number; choose: boolean; token: number } | null;
  onHistory: (direction: 'undo' | 'redo') => Promise<void>;
};

export const EditableParagraph = memo(function EditableParagraph({ block, busy, onEdit, onTextState, editorFocus, onHistory }: TextEditorProps & { block: Block; busy: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(block.text);
  const draft = useRef(block.text);
  const persisted = useRef(block.text);
  const pending = useRef<Promise<boolean> | null>(null);
  const latest = useRef(onEdit); latest.current = onEdit;
  const report = useRef(onTextState); report.current = onTextState;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  const digitInput = useRef({ value: '', time: 0 });
  const [chooser, setChooser] = useState(false);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const [failedPaste, setFailedPaste] = useState<TextOperation | null>(null);
  const failedPasteRef = useRef<TextOperation | null>(null);
  const categoryPending = useRef<Promise<boolean> | null>(null);
  const failedCategory = useRef<TextOperation | null>(null);
  const categoryChosen = useRef(false);
  const actingRef = useRef(false);
  const focusedToken = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (acting || draft.current !== persisted.current || pending.current) return;
    const element = ref.current;
    const focused = element === document.activeElement;
    const offset = element && focused ? caretOffset(element) : 0;
    draft.current = persisted.current = block.text; setText(block.text);
    if (element) {
      element.replaceChildren();
      if (block.runs.length) for (const run of block.runs) {
        const span = document.createElement('span'); span.textContent = run.text;
        if (run.format.size_pt) span.style.fontSize = `${run.format.size_pt}pt`;
        if (run.format.bold != null) span.style.fontWeight = run.format.bold ? '700' : '400';
        if (run.format.italic != null) span.style.fontStyle = run.format.italic ? 'italic' : 'normal';
        if (run.format.color) span.style.color = run.format.color;
        span.style.fontFamily = [run.format.font_east_asia, run.format.font_latin].filter(Boolean).join(',');
        element.append(span);
      } else element.textContent = block.text;
      if (focused) focusText(element, offset);
    }
  }, [block.text, block.runs, acting]);
  useEffect(() => {
    if (busy || acting || editorFocus?.id !== block.id || !ref.current || focusedToken.current === editorFocus.token) return;
    focusText(ref.current, editorFocus.offset);
    focusedToken.current = editorFocus.token;
    categoryChosen.current = !editorFocus.choose;
    setChooser(editorFocus.choose); setSelected(0);
  }, [editorFocus, block.id, busy, acting]);
  useEffect(() => () => { clearTimeout(timer.current); report.current(block.id, false, false); }, [block.id]);

  async function save(): Promise<boolean> {
    clearTimeout(timer.current);
    if (categoryPending.current && !await categoryPending.current) return false;
    if (failedCategory.current) return false;
    if (pending.current) return pending.current;
    if (draft.current === persisted.current) return true;
    pending.current = (async () => {
      report.current(block.id, true, true); setError('');
      while (draft.current !== persisted.current) {
        const value = draft.current;
        const result = await latest.current({ action: 'replace', id: block.id, text: value });
        if (!result) { setError('保存失败，本地输入已保留。可重试或复制正文。'); return false; }
        persisted.current = value;
      }
      return true;
    })().finally(() => { pending.current = null; report.current(block.id, hasUnsaved(), !!categoryPending.current); });
    return pending.current;
  }
  function schedule() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (composing.current) schedule(); else void save(); }, 650);
  }
  function changed() {
    draft.current = ref.current?.textContent || ''; setText(draft.current);
    report.current(block.id, hasUnsaved(), !!pending.current || !!categoryPending.current); schedule();
  }
  function hasUnsaved() {
    return draft.current !== persisted.current || !!failedPasteRef.current || !!categoryPending.current || !!failedCategory.current;
  }
  async function action(operation: TextOperation) {
    if (actingRef.current || composing.current) return;
    actingRef.current = true; setActing(true);
    try {
      clearTimeout(timer.current);
      if (categoryPending.current) await categoryPending.current;
      if (failedCategory.current) {
        if (operation.action === 'paste') { failedPasteRef.current = operation; setFailedPaste(operation); }
        return;
      }
      const combined = operation.action === 'split' || operation.action === 'paste';
      const ready = combined ? (!pending.current || await pending.current) : await save();
      if (ready) {
        if (combined && draft.current !== persisted.current) operation = { ...operation, draft: draft.current };
        report.current(block.id, true, true);
        const result = await latest.current(operation);
        if (result) {
          if (combined) {
            persisted.current = draft.current;
            if (result.id === block.id) draft.current = persisted.current = result.text;
          }
          setChooser(false); setError('');
          failedPasteRef.current = null; setFailedPaste(null);
        } else if (operation.action === 'paste') {
          failedPasteRef.current = operation; setFailedPaste(operation);
          setError('粘贴未成功，文字已保留，可重试或下载。');
        }
      } else if (operation.action === 'paste') {
        failedPasteRef.current = operation; setFailedPaste(operation);
      }
    } finally { actingRef.current = false; setActing(false); report.current(block.id, hasUnsaved(), !!categoryPending.current); }
  }
  function applyCategory(operation: TextOperation) {
    if (categoryPending.current) return;
    failedCategory.current = null; setError('');
    report.current(block.id, true, true);
    categoryPending.current = latest.current(operation).then(result => {
      if (!result) {
        failedCategory.current = operation;
        setError('类别保存失败，输入文字已保留，请重试保存。');
      }
      return !!result;
    }).finally(() => {
      categoryPending.current = null;
      report.current(block.id, hasUnsaved(), !!pending.current);
      if (!failedCategory.current && !actingRef.current && draft.current !== persisted.current) schedule();
    });
  }
  function category(index: number) {
    if (actingRef.current || categoryPending.current) return;
    setSelected(index);
    setChooser(false); categoryChosen.current = true;
    digitInput.current = { value: '', time: 0 };
    const choice = paragraphChoices[index];
    // Newly created paragraphs already have the default body category and format.
    if (choice.role === 'body' && block.role === 'body') return;
    applyCategory({ action: 'category', id: block.id, role: choice.role, level: choice.level });
  }
  return <div className="inline-writing" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <div ref={ref} className="paragraph-text editable-text" role="textbox" aria-label={`${block.id.toUpperCase()} 文字编辑`} aria-multiline="true"
      contentEditable={!busy && !acting && !failedPaste} suppressContentEditableWarning
      style={{ fontSize: `${block.format.size_pt || 12}pt`, fontWeight: block.format.bold ? 700 : 400,
        ...paragraphInsets(block.format), marginTop: `${block.format.space_before_pt || 0}pt`, marginBottom: `${block.format.space_after_pt ?? 4}pt`,
        fontStyle: block.format.italic ? 'italic' : 'normal', whiteSpace: 'pre-wrap',
        textAlign: block.format.alignment === 'both' ? 'justify' : block.format.alignment as 'left' | 'center' | 'right',
        fontFamily: [block.format.font_east_asia, block.format.font_latin, 'serif'].filter(Boolean).join(','),
        lineHeight: block.format.line_spacing || 1.6 }}
      onFocus={() => { if (!draft.current && !chooser && !categoryChosen.current) { setChooser(true); setSelected(0); } }}
      onBlur={() => { setChooser(false); if (!composing.current && !actingRef.current) void save(); }}
      onInput={changed} onCompositionStart={() => { composing.current = true; setChooser(false); }}
      onCompositionEnd={() => { composing.current = false; changed(); }}
      onPaste={event => {
        event.preventDefault(); setChooser(false);
        if (busy || actingRef.current || composing.current || failedPasteRef.current) return;
        const value = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n');
        const range = selectedTextRange(ref.current!);
        if (!range) { setError('暂不支持跨段粘贴替换，请在一个段落内选择插入位置。'); return; }
        if (value && !value.includes('\n')) {
          const selection = window.getSelection()!;
          const domRange = selection.getRangeAt(0);
          domRange.deleteContents();
          const node = document.createTextNode(value); domRange.insertNode(node);
          domRange.setStartAfter(node); domRange.collapse(true);
          selection.removeAllRanges(); selection.addRange(domRange); changed(); return;
        }
        if (value) void action({ action: 'paste', id: block.id, text: value, ...range });
      }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing.current) return;
        if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
          event.preventDefault();
          if (!actingRef.current) void (async () => { if (await save()) await onHistory(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo'); })();
          return;
        }
        if (chooser) {
          if (/^[0-9]$/.test(event.key)) {
            event.preventDefault();
            const now = Date.now();
            const combined = (now - digitInput.current.time < 800 ? digitInput.current.value : '') + event.key;
            const value = Number(combined) >= 1 && Number(combined) <= paragraphChoices.length ? combined : event.key;
            if (Number(value) >= 1 && Number(value) <= paragraphChoices.length) setSelected(Number(value) - 1);
            digitInput.current = { value, time: now }; return;
          }
          digitInput.current = { value: '', time: 0 };
          const result = chooserKey(event.key, selected, false);
          if (result.action === 'select') { event.preventDefault(); setSelected(result.selected); return; }
          if (result.action === 'confirm') { event.preventDefault(); category(selected); return; }
          if (result.action === 'close') { event.preventDefault(); setChooser(false); return; }
          if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete') setChooser(false);
        }
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          const selection = window.getSelection();
          if (selection?.rangeCount && !selection.isCollapsed) { selection.getRangeAt(0).deleteContents(); changed(); }
          const offset = caretOffset(ref.current!);
          void action({ action: 'split', id: block.id, offset });
        } else if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault(); const selection = window.getSelection(); if (!selection?.rangeCount) return;
          const range = selection.getRangeAt(0); range.deleteContents(); const node = document.createTextNode('\n'); range.insertNode(node);
          range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range); changed();
        } else if (event.key === 'Backspace' && caretOffset(ref.current!) === 0 && window.getSelection()?.isCollapsed) {
          event.preventDefault(); void action({ action: 'join', id: block.id });
        }
      }} />
    {chooser && <div className="paragraph-chooser" role="group" aria-label="新段落类别" onMouseDown={event => event.preventDefault()}>
      {paragraphChoices.map((choice, index) => <button key={choice.label} type="button" tabIndex={-1} aria-pressed={selected === index}
        className={selected === index ? 'selected' : ''} disabled={busy || acting} onClick={() => category(index)}>{index + 1}.{choice.label}</button>)}
    </div>}
    {error && <div className="inline-edit-error" role="alert">{error}<button onClick={() => failedCategory.current ? applyCategory(failedCategory.current) : failedPaste ? void action(failedPaste) : void save()}>重试保存</button><button onClick={() => {
      const url = URL.createObjectURL(new Blob([failedPaste?.text ?? text], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `${block.id}-本地输入.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>下载本地文字</button>{failedPaste && <button onClick={() => {
      if (!window.confirm('放弃本次未成功的粘贴？已保存正文不会改变。')) return;
      failedPasteRef.current = null; setFailedPaste(null); setError('');
      report.current(block.id, draft.current !== persisted.current, false);
    }}>放弃粘贴</button>}</div>}
  </div>;
});
