import { ArrowUpRight, Clock3 } from 'lucide-react'
import type { Topic } from './topic-data'
export function TopicCard({topic,onOpen}:{topic:Topic;onOpen:(t:Topic)=>void}){return <article className={`topic-card ${topic.color}`}>
 <div className="topic-meta"><span>{topic.kind}</span><span><Clock3 size={13}/>{topic.source}</span></div>
 <h2>{topic.title}</h2><p>{topic.summary}</p><div className="topic-footer"><small>{topic.reason}</small><button aria-label={`开始思考：${topic.title}`} onClick={()=>onOpen(topic)}><ArrowUpRight size={19}/></button></div>
 </article>}
