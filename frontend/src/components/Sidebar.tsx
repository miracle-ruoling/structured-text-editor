import { BookOpen, Braces, FileText, Hash, Layers3, ShieldCheck, Sparkles, Table2, Tags } from 'lucide-react';
import type { DocumentView, RecentProject, Selector } from '../lib/types';
import { bodySelector, roles } from '../lib/types';

type Props = { doc: DocumentView; recent: RecentProject[]; onOpen: (id: string) => void; selector: Selector | null; onSelect: (selector: Selector) => void; onDemo: () => void; disabled: boolean };
const presets = [
  { name: '全部内容', icon: Layers3, selector: { mode: 'all', conditions: [] } as Selector },
  { name: '正文 · 排除例外', icon: FileText, selector: bodySelector },
  { name: '所有小标题', icon: Hash, selector: { mode: 'all', conditions: [{ field: 'role', op: 'is', value: 'heading' }] } as Selector },
  { name: '表格内的文字', icon: Table2, selector: { mode: 'all', conditions: [{ field: 'context', op: 'is', value: 'table' }] } as Selector },
  { name: '保留原格式', icon: ShieldCheck, selector: { mode: 'all', conditions: [{ field: 'tag', op: 'is', value: '保留原格式' }] } as Selector },
];

export function Sidebar({ doc, recent, onOpen, selector, onSelect, onDemo, disabled }: Props) {
  return <aside className="sidebar">
    <div className="sidebar-label">当前文档</div>
    <div className="file-card"><div className="file-icon"><FileText size={19} /></div><div><strong title={doc.name}>{doc.name.replace(/\.docx$/i, '')}</strong><span>DOCX · {doc.blocks.length} 个段落</span></div></div>
    <select className="recent-projects" aria-label="打开最近文档" disabled={disabled} value="" onChange={e => { if (e.target.value) onOpen(e.target.value); }}><option value="">打开最近文档…</option>{recent.filter(p => p.id !== doc.id).map(project => <option key={project.id} value={project.id}>{project.name} · {new Date(project.updated_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} · r{project.revision} · {project.id.slice(0, 6)}</option>)}</select>
    <div className="sidebar-label spaced">快捷选择 <span>SELECT</span></div>
    <nav className="preset-list" aria-label="快捷选择器">
      {presets.map(({ name, icon: Icon, selector: value }) => <button disabled={disabled} key={name} className={`nav-item ${JSON.stringify(selector) === JSON.stringify(value) ? 'active' : ''}`} onClick={() => onSelect(structuredClone(value))}><Icon size={17} /><span>{name}</span>{JSON.stringify(selector) === JSON.stringify(value) && <i />}</button>)}
    </nav>
    <div className="sidebar-label spaced">文档类别 <Tags size={13} /></div>
    <nav className="role-list" aria-label="按类别筛选">
      {Object.entries(roles).map(([key, label]) => {
        const count = doc.blocks.filter(b => b.role === key).length;
        return count > 0 && <button disabled={disabled} key={key} onClick={() => onSelect({ mode: 'all', conditions: [{ field: 'role', op: 'is', value: key }] })}><span className={`role-dot ${key}`} /><span>{label}</span><span className="count">{count}</span></button>;
      })}
    </nav>
    <div className="sidebar-bottom">
      <button className="example-button" disabled={disabled} onClick={onDemo}><BookOpen size={16} /><span>打开一份新示例</span><Sparkles size={13} /></button>
      <div className="local-note"><Braces size={18} /><div><strong>结构清晰，修改有据</strong><span>文件只在你的电脑上处理</span></div></div>
    </div>
  </aside>;
}
