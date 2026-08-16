import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, Brain, FileText, Link2, MessageCircle, Send, Sparkles } from 'lucide-react'
import type { Topic } from '../topics/topic-data'
import { loadWorkspace } from '../../lib/storage'
import { addMessage, fetchWorkspace, updateWorkspace, type StoredMessage } from '../../lib/backend-api'
import { sendChat, type ModelInfo } from '../models/model-api'
import { buildWebPrompt, DEEPSEEK_WEB_ID, DEEPSEEK_WEB_URL, validateImportedAnswer } from '../models/web-handoff'

const tabs = [['讨论', MessageCircle], ['感思', BookOpen], ['资料', Link2], ['纪要', FileText], ['导图', Brain]] as const
type SaveState = 'loading' | 'saving' | 'saved' | 'error'

const emptyFields = { note: '', reflection: '', resources: '', summary: '', mindMap: '', selectedModel: 'siyu-demo' }

export function WorkspaceView({ topic, models, onBack }: { topic: Topic; models: ModelInfo[]; onBack: () => void }) {
  const [tab, setTab] = useState('讨论')
  const [input, setInput] = useState('')
  const [fields, setFields] = useState(emptyFields)
  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('loading')
  const [handoffPrompt, setHandoffPrompt] = useState('')
  const [manualCopy, setManualCopy] = useState(false)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importValue, setImportValue] = useState('')
  const [importError, setImportError] = useState('')
  const [manualPaste, setManualPaste] = useState(false)
  const [importSaving, setImportSaving] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    let active = true
    loaded.current = false
    setSaveState('loading')
    fetchWorkspace(topic.id).then(async workspace => {
      if (!active) return
      const legacy = loadWorkspace<{ msgs?: Array<{ id: number; role: '你' | 'AI'; text: string }>; note?: string }>(topic.id, {})
      if (!workspace.messages.length && (legacy.msgs?.length || legacy.note)) {
        const migrated = await updateWorkspace(topic.id, { note: legacy.note || '' })
        for (const message of legacy.msgs || []) {
          await addMessage(topic.id, { id: `legacy-${message.id}`, role: message.role === '你' ? 'user' : 'assistant', content: message.text })
        }
        workspace = await fetchWorkspace(topic.id)
        workspace.note = migrated.note
      }
      if (!active) return
      setFields({ note: workspace.note, reflection: workspace.reflection, resources: workspace.resources, summary: workspace.summary, mindMap: workspace.mindMap, selectedModel: workspace.selectedModel })
      setMessages(workspace.messages)
      loaded.current = true
      setSaveState('saved')
    }).catch(cause => {
      if (!active) return
      setError(cause instanceof Error ? cause.message : '无法连接本地后端')
      setSaveState('error')
    })
    return () => { active = false }
  }, [topic.id])

  useEffect(() => {
    if (!loaded.current) return
    setSaveState('saving')
    const timer = window.setTimeout(() => {
      updateWorkspace(topic.id, fields).then(() => setSaveState('saved')).catch(() => setSaveState('error'))
    }, 450)
    return () => window.clearTimeout(timer)
  }, [topic.id, fields])

  function changeField(key: keyof typeof emptyFields, value: string) {
    setFields(current => ({ ...current, [key]: value }))
  }

  async function send() {
    const value = input.trim()
    if (!value || sending) return
    const selectedModel = models.find(model => model.id === fields.selectedModel)
    if (selectedModel?.kind === 'web-handoff') {
      const prompt = buildWebPrompt({ topicTitle: topic.title, messages: messages.filter(message => message.role !== 'system').map(message => ({ role: message.role as 'user' | 'assistant', content: message.content })), question: value })
      setHandoffPrompt(prompt)
      setInput('')
      setError('')
      setManualCopy(false)
      setPopupBlocked(false)
      try { await navigator.clipboard.writeText(prompt) } catch { setManualCopy(true) }
      if (!window.open(DEEPSEEK_WEB_URL, '_blank', 'noopener,noreferrer')) setPopupBlocked(true)
      return
    }
    const messageId = crypto.randomUUID()
    const userMessage: StoredMessage = { id: messageId, role: 'user', content: value, createdAt: new Date().toISOString() }
    const next = [...messages, userMessage]
    setMessages(next)
    setInput('')
    setSending(true)
    setError('')
    try {
      const result = await sendChat(topic.id, fields.selectedModel, messageId, next.filter(message => message.role !== 'system').map(message => ({ role: message.role as 'user' | 'assistant', content: message.content })))
      setMessages(current => [...current, { id: result.message?.id || crypto.randomUUID(), role: 'assistant', content: result.content, modelId: fields.selectedModel, createdAt: result.message?.createdAt || new Date().toISOString() }])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型请求失败')
    } finally { setSending(false) }
  }

  async function copyHandoffPrompt() {
    try { await navigator.clipboard.writeText(handoffPrompt); setManualCopy(false) } catch { setManualCopy(true) }
  }

  async function beginImport() {
    setImportOpen(true)
    setImportError('')
    setManualPaste(false)
    try {
      const answer = await navigator.clipboard.readText()
      setImportValue(answer.trim())
    } catch {
      setImportValue('')
      setManualPaste(true)
    }
  }

  async function confirmImport() {
    const result = validateImportedAnswer(importValue)
    if (!result.ok) { setImportError(result.error); return }
    setImportSaving(true)
    setImportError('')
    try {
      const saved = await addMessage(topic.id, { id: crypto.randomUUID(), role: 'assistant', content: result.value, modelId: DEEPSEEK_WEB_ID })
      setMessages(current => [...current, saved])
      setImportOpen(false)
      setImportValue('')
      setHandoffPrompt('')
      setManualCopy(false)
      setPopupBlocked(false)
    } catch { setImportError('保存失败，请重试') } finally { setImportSaving(false) }
  }

  const statusText = saveState === 'loading' ? '正在读取' : saveState === 'saving' ? '保存中' : saveState === 'error' ? '保存失败' : '已保存到本机'
  const selectedModel = models.find(model => model.id === fields.selectedModel)
  const isWebHandoff = selectedModel?.kind === 'web-handoff'

  return <main className="workspace">
    <header className="workspace-head"><button className="icon-button" onClick={onBack} aria-label="返回今日议题"><ArrowLeft /></button><div><span>{topic.kind} · 思考空间</span><h1>{topic.title}</h1></div><span className={`saved ${saveState === 'error' ? 'save-error' : ''}`}>● {statusText}</span></header>
    <nav className="tabs" aria-label="思考空间视图">{tabs.map(([name, Icon]) => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}><Icon size={17} />{name}</button>)}</nav>
    {tab === '讨论' ? <div className="workspace-grid"><section className="conversation"><div className="modelbar"><label><Sparkles size={15} /><select aria-label="选择对话模型" value={fields.selectedModel} onChange={event => changeField('selectedModel', event.target.value)}>{models.map(model => <option key={model.id} value={model.id} disabled={!model.available}>{model.provider} · {model.name}{!model.available ? '（待配置）' : ''}</option>)}</select></label><span>{selectedModel?.kind === 'demo' ? '演示模式' : isWebHandoff ? '免费网页版' : '真实 API'} · 当前议题</span></div><div className="messages">{messages.length === 0 ? <div className="opening"><span>从这里开始</span><h2>你对这个问题最初的直觉是什么？</h2><p>不用急着给出完整答案，先写下此刻最真实的判断。</p></div> : messages.filter(message => message.role !== 'system').map(message => <article className={`message ${message.role === 'assistant' ? 'ai' : ''}`} key={message.id}><b>{message.role === 'assistant' ? 'AI' : '你'}{message.role === 'assistant' && <small> · {models.find(model => model.id === message.modelId)?.name || '思屿'}</small>}</b><p>{message.content}</p></article>)}</div>{handoffPrompt && <section className="handoff-status" aria-label="等待 DeepSeek 回答"><p>问题已复制。获得回答后，回到这里继续。</p>{manualCopy && <textarea className="handoff-manual-copy" aria-label="待复制的问题" value={handoffPrompt} readOnly/>}{popupBlocked && <a className="handoff-open-link" href={DEEPSEEK_WEB_URL} target="_blank" rel="noreferrer">打开 DeepSeek 官网</a>}<div><button className="primary" onClick={beginImport}>粘贴 DeepSeek 回答</button><button className="text-button" onClick={copyHandoffPrompt}>再次复制问题</button></div></section>}{error && <p className="chat-error" role="alert">{error} · 你的消息已保留，可以稍后重试。</p>}<div className="composer"><textarea value={input} onChange={event => setInput(event.target.value)} placeholder="写下你的想法……" aria-label="对话内容" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send() } }} /><div><span>{sending ? '正在思考…' : isWebHandoff ? 'Enter 打开并提问 · Shift + Enter 换行' : 'Enter 发送 · Shift + Enter 换行'}</span><button disabled={sending} onClick={send} aria-label={isWebHandoff ? '打开并提问' : '发送消息'}><Send size={18} /></button></div></div></section><aside className="notes"><span className="eyebrow">私人旁注</span><h2>只写给自己</h2><p>默认不会发送给 AI，也不会自动进入纪要。</p><textarea value={fields.note} onChange={event => changeField('note', event.target.value)} placeholder="记下犹豫、灵感或还没想清楚的部分……" /></aside></div> : <Panel tab={tab} fields={fields} onChange={changeField} />}
    {importOpen && <div className="import-backdrop" role="presentation"><section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="import-title"><h2 id="import-title">带回答回到思屿</h2><p>{manualPaste ? '浏览器没有允许读取剪贴板，请在这里手动粘贴。' : '确认并按需要编辑回答，再保存到当前议题。'}</p><textarea aria-label="DeepSeek 回答预览" value={importValue} onChange={event => setImportValue(event.target.value)} autoFocus/>{importError && <p className="import-error" role="alert">{importError}</p>}<div className="import-actions"><button className="primary" disabled={importSaving} onClick={confirmImport}>保存为 AI 回复</button><button className="text-button" disabled={importSaving} onClick={() => setImportOpen(false)}>取消</button></div></section></div>}
  </main>
}

function Panel({ tab, fields, onChange }: { tab: string; fields: typeof emptyFields; onChange: (key: keyof typeof emptyFields, value: string) => void }) {
  const config: Record<string, { title: string; key: 'reflection' | 'resources' | 'summary' | 'mindMap'; placeholder: string }> = {
    感思: { title: '写下此刻的感思', key: 'reflection', placeholder: '从一句还不完整的话开始……' },
    资料: { title: '议题资料', key: 'resources', placeholder: '收藏来源、引用与待核实的信息……' },
    纪要: { title: '本次思考纪要', key: 'summary', placeholder: '记录核心观点、分歧和未解决问题……' },
    导图: { title: '思维导图', key: 'mindMap', placeholder: '议题\n├─ 核心观点\n├─ 反对理由\n└─ 未解决问题' },
  }
  const current = config[tab]
  return <section className="panel"><span className="eyebrow">{tab === '纪要' ? '可编辑纪要' : '思考空间'}</span><h2>{current.title}</h2><textarea className={tab === '导图' ? 'tree panel-editor' : 'panel-editor'} value={fields[current.key]} onChange={event => onChange(current.key, event.target.value)} placeholder={current.placeholder} /></section>
}
