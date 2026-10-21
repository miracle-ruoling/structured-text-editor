import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { NativeSaveQueue, nativeBackup } from '../src/lib/native.ts';
import type { NativeView } from '../src/lib/native.ts';
import { identityPlugin, toEditor, fromEditor } from '../src/lib/nativeEditor.ts';

const view = (): NativeView => ({ format: 'wenxu-native', version: 1, id: 'a'.repeat(32), revision: 1,
  updated_at: '', can_undo: false, can_redo: false,
  content: { name: '文档', blocks: [{ id: 'b'.repeat(32), kind: 'paragraph', level: null, text: '原文' }] } });

test('保存期间继续输入：串行使用新 revision，旧响应不覆盖新输入', async () => {
  const pending: ((view: NativeView) => void)[] = [];
  const sent: { revision: number; text: string }[] = [];
  const q = new NativeSaveQueue(view(), (saved, content) => {
    sent.push({ revision: saved.revision, text: content.blocks[0].text });
    return new Promise(resolve => pending.push(resolve));
  }, () => {});
  const first = { ...q.draft, blocks: [{ ...q.draft.blocks[0], text: '第一笔' }] };
  q.edit(first);
  const done = q.flush();
  assert.equal(q.flush(), done);
  q.edit({ ...first, blocks: [{ ...first.blocks[0], text: '继续输入' }] });
  pending.shift()!({ ...view(), revision: 2, content: first });
  await Promise.resolve();
  assert.equal(q.draft.blocks[0].text, '继续输入');
  assert.deepEqual(sent, [{ revision: 1, text: '第一笔' }, { revision: 2, text: '继续输入' }]);
  pending.shift()!({ ...view(), revision: 3, content: q.draft });
  await done;
  assert.equal(q.dirty, false);
});

test('保存冲突保留输入和原 revision，本地草稿备份可恢复', async () => {
  const q = new NativeSaveQueue(view(), async () => { throw new Error('冲突'); }, () => {});
  q.edit({ ...q.draft, name: '保留草稿' });
  await assert.rejects(q.flush(), /冲突/);
  assert.equal(q.saved.revision, 1);
  assert.equal(q.dirty, true);
  assert.equal(q.draft.name, '保留草稿');
  assert.equal(q.flight, null);
  const backup = nativeBackup(q.saved, q.draft);
  assert.equal(backup.content.name, '保留草稿');
  assert.equal('can_undo' in backup, false);
});

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  paragraph: { group: 'block', content: 'text*', attrs: { nodeId: { default: null } } },
  heading: { group: 'block', content: 'text*', attrs: { nodeId: { default: null }, level: { default: 1 } } },
} });

test('真实 ProseMirror 拆分与合并：原 ID 保留，新增 ID 唯一，序列化往返稳定', () => {
  const initial = view().content;
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(toEditor(initial)), plugins: [identityPlugin()] });
  state = state.applyTransaction(state.tr.split(2)).state;
  const content = fromEditor(state.doc, initial.name);
  assert.equal(content.blocks.length, 2);
  assert.equal(content.blocks[0].id, initial.blocks[0].id);
  assert.notEqual(content.blocks[1].id, content.blocks[0].id);
  assert.match(content.blocks[1].id, /^[0-9a-f]{32}$/);
  assert.deepEqual(fromEditor(schema.nodeFromJSON(toEditor(content)), initial.name), content);
  state = state.applyTransaction(state.tr.join(state.doc.child(0).nodeSize)).state;
  assert.deepEqual(fromEditor(state.doc, initial.name), initial);
});

test('新增和重复节点不会挪用原节点 ID，正文改标题仍保留 ID', () => {
  const initial = view().content;
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(toEditor(initial)), plugins: [identityPlugin()] });
  state = state.applyTransaction(state.tr.insert(state.doc.content.size, state.doc.firstChild!)).state;
  assert.notEqual(state.doc.child(0).attrs.nodeId, state.doc.child(1).attrs.nodeId);
  state = state.applyTransaction(state.tr.setNodeMarkup(0, schema.nodes.heading, { nodeId: initial.blocks[0].id, level: 2 })).state;
  assert.equal(state.doc.firstChild!.attrs.nodeId, initial.blocks[0].id);
});
