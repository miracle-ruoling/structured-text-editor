import type { Chapter, Section, Selector } from '../lib/types';
import { roles } from '../lib/types';

export function SelectorSummary({ selector, chapters = [], sections = [] }: { selector: Selector; chapters?: Chapter[]; sections?: Section[] }) {
  return <div className="selector-summary">
    {!selector.conditions.length ? <span>{selector.mode === 'all' ? '全部可编辑段落' : '无匹配范围'}</span> : <>
      <span className="help-text">{selector.mode === 'expression' ? '高级关系式' : selector.mode === 'all' ? '全部满足' : '任一满足'}</span>
      {selector.conditions.map((c, i) => <div key={c.key || i}>{selector.mode === 'expression' && <code>${c.key} </code>}{({ role: '类别', tag: '标签', context: '位置', text: '文字', ids: '点选快照', chapter: '章节', section: 'Word 分节' })[c.field]} {({ is: '是', is_not: '不是', contains: '包含', not_contains: '不包含' })[c.op]} <strong>{c.field === 'role' ? roles[c.value as keyof typeof roles] : c.field === 'context' ? (c.value === 'table' ? '表格内' : '表格外') : c.field === 'chapter' ? (chapters.find(item => item.id === c.value)?.name || `已失效 · ${c.value}`) : c.field === 'section' ? (sections.find(item => item.id === c.value)?.name || `已失效 · ${c.value}`) : c.field === 'ids' ? `${c.ids?.length || 0} 段` : c.value}</strong></div>)}
      {selector.mode === 'expression' && <code className="rule-expression">{selector.expression}</code>}
    </>}
  </div>;
}
