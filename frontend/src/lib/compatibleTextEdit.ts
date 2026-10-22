import type { DocumentView } from './types.ts';
import type { TextOperation } from './textEditing.ts';

export function createTextEditSender(
  send: (doc: DocumentView, operation: TextOperation) => Promise<DocumentView>,
  rejectsDraft: (error: unknown) => boolean,
) {
  let supportsDraft = true;
  return async (doc: DocumentView, operation: TextOperation, onSaved: (doc: DocumentView) => void = () => {}) => {
    if (operation.draft === undefined) return send(doc, operation);
    if (supportsDraft) {
      try { return await send(doc, operation); }
      catch (error) {
        // Only schema rejection guarantees that the combined request made no changes.
        if (!rejectsDraft(error)) throw error;
        supportsDraft = false;
      }
    }
    const { draft, ...structure } = operation;
    let saved = doc;
    if (doc.blocks.find(block => block.id === operation.id)?.text !== draft) {
      saved = await send(doc, { action: 'replace', id: operation.id, text: draft });
      onSaved(saved); // Preserve the revision even if the following structural action fails.
    }
    return send(saved, structure);
  };
}
