import { useState } from 'react'
import { ArrowUpRight, Filter, Plus, Search } from 'lucide-react'
import type { Topic } from '../topics/topic-data'

const states = ['全部', '讨论中', '待整理', '已沉淀'] as const

export function SpacesView({ topics, onOpenTopic, onCreateTopic }: { topics: Topic[]; onOpenTopic: (topic: Topic) => void; onCreateTopic: () => void }) {
  const [state, setState] = useState<(typeof states)[number]>('全部')
  const [query, setQuery] = useState('')
  const rows = topics.filter(topic => topic.title.includes(query))

  return <main className="overview">
    <header className="overview-hero"><div><span className="eyebrow">思考空间</span><h1>所有思考，都有迹可循</h1><p>从最初的问题到最后的结论，保留每一次观点变化。</p></div><button className="primary" onClick={onCreateTopic}><Plus size={18}/>新建空间</button></header>
    <div className="toolbar"><label className="search"><Search size={17}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索标题与内容"/></label><div className="filters" aria-label="空间状态">{states.map(item => <button key={item} className={state === item ? 'active' : ''} onClick={() => setState(item)}>{item}</button>)}</div><button className="filter-button"><Filter size={16}/>筛选</button></div>
    <section className="space-table" aria-label="思考空间列表">
      {rows.map((topic, index) => <article key={topic.id} className="space-row"><div className="space-state"><span className={`state-dot state-${index}`}/>{index === 0 ? '讨论中' : index === 1 ? '待整理' : '已沉淀'}</div><div><h2>{topic.title}</h2><p>{topic.summary}</p><small>{index === 0 ? '今天更新 · 4 条对话' : index === 1 ? '昨天更新 · 1 条感思' : '8 月 10 日 · 已生成纪要'}</small></div><button aria-label={`打开空间：${topic.title}`} onClick={() => onOpenTopic(topic)}><ArrowUpRight size={18}/></button></article>)}
      {rows.length === 0 && <div className="empty-state"><h2>没有找到相关思考</h2><p>换一个关键词，或创建一个新的思考空间。</p></div>}
    </section>
  </main>
}
