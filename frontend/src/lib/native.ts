export interface NativeBlock { id: string; kind: 'paragraph' | 'heading'; level: number | null; text: string }
export interface NativeContent { name: string; blocks: NativeBlock[] }
export interface NativeView {
  format: 'wenxu-native'; version: 1; id: string; revision: number; updated_at: string;
  content: NativeContent; can_undo: boolean; can_redo: boolean;
}
export const newNodeId = () => crypto.randomUUID().replaceAll('-', '');
export const sameContent = (a: NativeContent, b: NativeContent) => JSON.stringify(a) === JSON.stringify(b);

/** Single writer; a response never replaces input typed while it was in flight. */
export class NativeSaveQueue {
  saved: NativeView;
  draft: NativeContent;
  flight: Promise<void> | null = null;
  error: Error | null = null;
  send: (view: NativeView, content: NativeContent) => Promise<NativeView>;
  notify: () => void;
  constructor(view: NativeView, send: NativeSaveQueue['send'], notify: () => void) {
    this.saved = view; this.draft = view.content; this.send = send; this.notify = notify;
  }
  get dirty() { return !sameContent(this.saved.content, this.draft); }
  edit(content: NativeContent) { this.draft = content; this.notify(); }
  flush(): Promise<void> {
    if (this.flight) return this.flight;
    this.error = null;
    this.flight = this.drain().catch(error => { this.error = error; throw error; })
      .finally(() => { this.flight = null; this.notify(); });
    this.notify();
    return this.flight;
  }
  private async drain() {
    while (this.dirty) {
      const sent = this.draft;
      this.saved = await this.send(this.saved, sent);
      // Server may normalize a name; only adopt it if there is no newer input.
      if (this.draft === sent) this.draft = this.saved.content;
      this.notify();
    }
  }
}

export function nativeBackup(view: NativeView, content = view.content) {
  const { can_undo: _undo, can_redo: _redo, ...project } = view;
  return { ...project, content, undo: [], redo: [] };
}
