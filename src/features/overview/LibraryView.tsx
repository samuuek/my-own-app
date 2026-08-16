import { useState } from 'react'
import { BookOpen, FileText, MessageSquareText, Search } from 'lucide-react'

const items = [
  { type: '纪要', title: 'AI 与记忆：我们究竟把什么交给了工具？', excerpt: '工具改变的不只是记忆容量，也改变了我们决定什么值得被记住的方式。', date: '今天', icon: FileText },
  { type: '感思', title: '慢不是降低效率，而是重新获得判断权', excerpt: '真正稀缺的也许不是答案，而是停下来辨认问题的时间。', date: '昨天', icon: BookOpen },
  { type: '对话', title: '确定性是否仍然值得追求？', excerpt: '当获取答案的成本趋近于零，提出好问题的能力开始变得更重要。', date: '8 月 10 日', icon: MessageSquareText },
]

export function LibraryView() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const visible = items.filter(item => `${item.title}${item.excerpt}`.includes(query))
  return <main className="overview library-view">
    <header className="overview-hero"><div><span className="eyebrow">个人知识库</span><h1>你的思想，正在形成自己的脉络</h1><p>搜索、连接并重新发现散落在对话与感思中的观点。</p></div></header>
    <label className="library-search"><Search size={19}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索议题、观点、纪要和感思"/></label>
    <div className="library-layout"><aside><span>内容类型</span>{['全部内容', '纪要', '感思', '对话', '资料'].map((item, index) => <button className={index === 0 ? 'active' : ''} key={item}>{item}<small>{index === 0 ? 12 : index === 4 ? 2 : 3}</small></button>)}</aside><section className="library-results"><div className="results-head"><span>{visible.length} 条结果</span><button>按最近更新</button></div>{visible.map(({ icon: Icon, ...item }) => <button className={`knowledge-row ${selected === item.title ? 'selected' : ''}`} key={item.title} onClick={() => setSelected(item.title)}><Icon size={20}/><div><span>{item.type} · {item.date}</span><h2>{item.title}</h2><p>{item.excerpt}</p></div></button>)}{selected && <div className="selection-note">已选择：{selected}</div>}</section></div>
  </main>
}
