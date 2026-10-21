import { Fingerprint, SlidersHorizontal, ToggleLeft } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Block } from '../lib/types';
import { formatValue, roles } from '../lib/types';

export type QuickMenuTarget = { id: string; x: number; y: number; anchor: HTMLElement };

export function ObjectQuickMenu({ block, target, onClose, onPick, onFormat, onAddCondition }: {
  block: Block; target: QuickMenuTarget; onClose: () => void;
  onPick: (id: string) => void; onFormat: (id: string) => void; onAddCondition: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  useLayoutEffect(() => {
    const box = ref.current!.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(target.x, window.innerWidth - box.width - 8)), top: Math.max(8, Math.min(target.y, window.innerHeight - box.height - 8)) });
    ref.current?.querySelector('button')?.focus();
  }, [target]);
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const scroll = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', onClose);
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', onClose); };
  }, [onClose]);
  function act(action: (id: string) => void) { onClose(); action(block.id); }
  return createPortal(<div ref={ref} role="dialog" aria-label={`段落 ${block.id.toUpperCase()} 快捷工具`} className="object-quick-menu" style={position}
    onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) onClose(); }}
    onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); target.anchor.focus(); }
      if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const buttons = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }
    }}>
    <div className="quick-menu-title"><strong>{block.id.toUpperCase()} · {roles[block.role]}</strong><span>{block.in_table ? '表格内' : '表格外'}{!block.editable && ' · 仅查看'}</span></div>
    <p>{block.text.slice(0, 70) || '空段落'}{block.text.length > 70 ? '…' : ''}</p>
    <div className="quick-menu-properties"><span>{block.mixed.includes('size_pt') ? '混合字号' : formatValue('size_pt', block.format.size_pt)}</span><span>{block.format.font_east_asia || '字体继承'}</span><span>{block.tags.length} 个标签</span></div>
    <div className="quick-menu-actions"><button onClick={() => act(onPick)}><Fingerprint size={15} />检查对象</button><button disabled={!block.editable} onClick={() => act(onFormat)}><SlidersHorizontal size={15} />此段格式</button><button disabled={!block.editable} onClick={() => act(onAddCondition)}><ToggleLeft size={15} />切换此段选择</button></div>
  </div>, document.body);
}
