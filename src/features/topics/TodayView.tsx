import { Plus, Sparkles } from 'lucide-react'
import { TopicCard } from './TopicCard'
import type { Topic } from './topic-data'
export function TodayView({topics,onOpenTopic,onCreateTopic}:{topics:Topic[];onOpenTopic:(t:Topic)=>void;onCreateTopic:()=>void}){return <main className="today">
 <header className="hero"><div><p className="date">8 月 15 日 · 星期六</p><h1>今天，想聊点什么？</h1><p>从一个问题开始，和 AI 一起把模糊的想法慢慢想清楚。</p></div><button className="primary" onClick={onCreateTopic}><Plus size={18}/>新建议题</button></header>
 <section aria-labelledby="daily-title"><div className="section-head"><div><span className="eyebrow"><Sparkles size={14}/>今日三题</span><h2 id="daily-title">为今天留一个值得想的问题</h2></div><button className="text-button">换一组</button></div><div className="topic-list">{topics.map(t=><TopicCard key={t.id} topic={t} onOpen={onOpenTopic}/>)}</div></section>
 {topics[1]&&<section className="continue"><div><span className="eyebrow">继续思考</span><h2>{topics[1].title}</h2><p>{topics[1].summary}</p></div><button onClick={()=>onOpenTopic(topics[1])}>继续上次对话</button></section>}
 </main>}
