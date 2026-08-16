import { useState } from 'react'
import { ArrowRight, CalendarDays, RotateCcw } from 'lucide-react'

export function ReviewView() {
  const [range, setRange] = useState('本周')
  return <main className="overview review-view">
    <header className="overview-hero"><div><span className="eyebrow">回顾</span><h1>回到那些值得再想一次的地方</h1><p>不是为了重复过去，而是看见自己的观点正在怎样变化。</p></div><div className="range-picker" aria-label="回顾时间">{['本周', '本月', '今年'].map(item => <button className={range === item ? 'active' : ''} onClick={() => setRange(item)} key={item}>{item}</button>)}</div></header>
    <section className="review-lead"><div><span><CalendarDays size={15}/> {range}回顾</span><h2>你持续关注的主题，是“技术如何改变人的主体性”</h2><p>过去 7 天，你围绕这个主题展开了 3 次讨论，写下 2 条感思。一个反复出现的问题是：当工具替我们完成越来越多判断，人还如何保留主动选择？</p><button>查看主题脉络<ArrowRight size={17}/></button></div><blockquote>“也许真正要保护的，不是不用工具，而是在使用之前仍然知道自己为什么选择。”<cite>8 月 12 日的感思</cite></blockquote></section>
    <section className="review-grid"><article><span className="eyebrow">未解决问题</span><h2>效率节省下来的时间，为什么总被新的任务填满？</h2><p>上次讨论停在“效率并不天然带来自由”。</p><button>继续思考<ArrowRight size={16}/></button></article><article><span className="eyebrow"><RotateCcw size={14}/>随机重访</span><h2>三个月前，你如何理解“独立思考”？</h2><p>重新读一遍旧观点，看看哪些判断已经发生变化。</p><button>打开旧感思<ArrowRight size={16}/></button></article></section>
  </main>
}
