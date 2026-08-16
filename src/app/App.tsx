import { useState } from 'react'
import { BookOpen, Compass, Library, Newspaper, PenLine, Settings2 } from 'lucide-react'
import {TodayView} from '../features/topics/TodayView'
import type {Topic} from '../features/topics/topic-data'
import {WorkspaceView} from '../features/workspace/WorkspaceView'
import { SpacesView } from '../features/overview/SpacesView'
import { LibraryView } from '../features/overview/LibraryView'
import { ReviewView } from '../features/overview/ReviewView'
import { useEffect } from 'react'
import { fetchModels, fallbackModels, type ModelInfo } from '../features/models/model-api'
import { ModelSettings } from '../features/models/ModelSettings'
import { createTopic, fetchTopics } from '../lib/backend-api'
import { topics as fallbackTopics } from '../features/topics/topic-data'
import { WeeklyView } from '../features/weekly/WeeklyView'

type View = 'today' | 'spaces' | 'weekly' | 'library' | 'review'
const views = new Set<View>(['today', 'spaces', 'weekly', 'library', 'review'])
function initialView(): View {
 const hash = window.location.hash.slice(1) as View
 return views.has(hash) ? hash : 'today'
}
const navigation = [
  { id: 'today', label: '今日', icon: Compass },
  { id: 'spaces', label: '思考空间', icon: PenLine },
  { id: 'weekly', label: 'AI 周报', icon: Newspaper },
  { id: 'library', label: '知识库', icon: Library },
  { id: 'review', label: '回顾', icon: BookOpen },
] as const

export function App(){
 const [topic,setTopic]=useState<Topic|null>(null)
 const [view,setView]=useState<View>(initialView)
 const [models,setModels]=useState<ModelInfo[]>(fallbackModels)
 const [topicList,setTopicList]=useState<Topic[]>(fallbackTopics)
 const [settingsOpen,setSettingsOpen]=useState(false)
 useEffect(()=>{fetchModels().then(setModels).catch(()=>setModels(fallbackModels));fetchTopics().then(setTopicList).catch(()=>setTopicList(fallbackTopics))},[])
 function navigate(next: View){setTopic(null);setView(next);window.history.replaceState(null,'',`#${next}`)}
 async function makeTopic(title:string){try{const created=await createTopic({title,kind:'为你推荐',summary:'',reason:'你创建的议题',source:'私人议题',color:'green'});setTopicList(current=>[created,...current]);setTopic(created)}catch{setTopic({id:`local-${Date.now()}`,kind:'为你推荐',title,summary:'',reason:'你创建的议题',source:'私人议题',color:'green'})}}
 function content(){if(topic)return <WorkspaceView topic={topic} models={models} onBack={()=>navigate('spaces')}/>;if(view==='spaces')return <SpacesView topics={topicList} onCreateTopic={()=>makeTopic('一个新的思考空间')} onOpenTopic={setTopic}/>;if(view==='weekly')return <WeeklyView/>;if(view==='library')return <LibraryView/>;if(view==='review')return <ReviewView/>;return <TodayView topics={topicList.slice(0,3)} onCreateTopic={()=>makeTopic('一个还没有名字的新想法')} onOpenTopic={setTopic}/>} 
 return <div className="app"><header className="topbar"><a className="brand" href="#today" onClick={event=>{event.preventDefault();navigate('today')}}><span>屿</span>思屿</a><nav aria-label="主导航">{navigation.map(({id,label,icon:Icon})=><a key={id} className={!topic&&view===id?'active':''} aria-current={!topic&&view===id?'page':undefined} href={`#${id}`} onClick={event=>{event.preventDefault();navigate(id)}}><Icon size={17}/>{label}</a>)}</nav><button className="model-settings-button" aria-label="对话服务" onClick={()=>setSettingsOpen(true)}><Settings2 size={17}/><span>服务</span></button><button className="avatar" aria-label="个人设置">思</button></header>{content()}{settingsOpen&&<ModelSettings models={models} onClose={()=>setSettingsOpen(false)}/>}</div>
}
