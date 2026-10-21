import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { newNodeId } from './native.ts';
import type { NativeContent } from './native.ts';

export function identityPlugin() {
  return new Plugin({
    props: {
      transformPasted(slice) {
        const clear = (node: PMNode): PMNode => node.isText ? node : node.type.create(
          { ...node.attrs, nodeId: null }, Fragment.fromArray(Array.from({ length: node.childCount }, (_, i) => clear(node.child(i)))), node.marks,
        );
        return new Slice(Fragment.fromArray(Array.from({ length: slice.content.childCount }, (_, i) => clear(slice.content.child(i)))), slice.openStart, slice.openEnd);
      },
    },
    appendTransaction(transactions, _old, state) {
      if (!transactions.some(t => t.docChanged)) return null;
      const seen = new Set<string>();
      const tr = state.tr;
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
        let id = node.attrs.nodeId;
        if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id) || seen.has(id)) {
          id = newNodeId(); tr.setNodeMarkup(pos, undefined, { ...node.attrs, nodeId: id });
        }
        seen.add(id);
      });
      return tr.docChanged ? tr : null;
    },
  });
}

export const NativeIdentity = Extension.create({
  name: 'nativeIdentity',
  addGlobalAttributes() {
    return [{ types: ['paragraph', 'heading'], attributes: {
      nodeId: { default: null, keepOnSplit: false, parseHTML: () => null, renderHTML: () => ({}) },
    } }];
  },
  addProseMirrorPlugins: () => [identityPlugin()],
});

export function toEditor(content: NativeContent) {
  return { type: 'doc', content: content.blocks.map(block => ({
    type: block.kind, attrs: { nodeId: block.id, ...(block.level ? { level: block.level } : {}) },
    ...(block.text ? { content: [{ type: 'text', text: block.text }] } : {}),
  })) };
}

export function fromEditor(doc: PMNode, name: string): NativeContent {
  const blocks: NativeContent['blocks'] = [];
  doc.forEach(node => blocks.push({ id: node.attrs.nodeId, kind: node.type.name as 'paragraph' | 'heading',
    level: node.type.name === 'heading' ? node.attrs.level : null, text: node.textContent }));
  return { name, blocks };
}
