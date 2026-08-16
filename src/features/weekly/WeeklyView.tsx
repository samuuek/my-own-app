import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react'
import { fetchWeekly, refreshWeekly, saveWeeklyAnalysis, type WeeklyAnalysis, type WeeklyCategory, type WeeklySnapshot } from './weekly-api'
import { buildWeeklyMaterial, compareWeeklyAnalyses, parseWeeklyAnalysis, WEEKLY_ANALYSTS } from './weekly-handoff'

const categories: Array<'全部' | WeeklyCategory> = ['全部', '模型', '产品', '研究', '开源', '政策']

export function WeeklyView() {
  const [snapshot, setSnapshot] = useState<WeeklySnapshot | null>(null)
  const [category, setCategory] = useState<(typeof categories)[number]>('全部')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [awaiting, setAwaiting] = useState<string[]>([])
  const [material, setMaterial] = useState<{ fingerprint: string; prompt: string } | null>(null)
  const [manualPrompt, setManualPrompt] = useState('')
  const [blockedAnalyst, setBlockedAnalyst] = useState('')
  const [importAnalyst, setImportAnalyst] = useState('')
  const [importValue, setImportValue] = useState('')
  const [importError, setImportError] = useState('')

  useEffect(() => { fetchWeekly().then(setSnapshot).catch(cause => setError(cause instanceof Error ? cause.message : '无法读取周报')).finally(() => setLoading(false)) }, [])

  async function refresh() {
    setRefreshing(true); setError('')
    try { setSnapshot(await refreshWeekly()) } catch (cause) { setError(cause instanceof Error ? cause.message : '刷新失败') }
    finally { setRefreshing(false) }
  }

  async function openAnalyst(id: string) {
    if (!snapshot?.items.length) return
    const nextMaterial = await buildWeeklyMaterial(snapshot.items)
    setMaterial(nextMaterial); setManualPrompt(''); setBlockedAnalyst('')
    try { await navigator.clipboard.writeText(nextMaterial.prompt) } catch { setManualPrompt(nextMaterial.prompt) }
    const analyst = WEEKLY_ANALYSTS.find(item => item.id === id)!
    if (!window.open(analyst.url, '_blank', 'noopener,noreferrer')) setBlockedAnalyst(id)
    setAwaiting(current => current.includes(id) ? current : [...current, id])
  }

  async function beginImport(id: string) {
    setImportAnalyst(id); setImportError('')
    try { setImportValue((await navigator.clipboard.readText()).trim()) }
    catch { setImportValue(''); setImportError('浏览器没有允许读取剪贴板，请在这里手动粘贴。') }
  }

  async function confirmImport() {
    const value = importValue.trim()
    if (!value) { setImportError('请先粘贴模型分析'); return }
    if (value.length > 200_000) { setImportError('分析不能超过 200000 个字'); return }
    if (!snapshot || !material) return
    const current = await buildWeeklyMaterial(snapshot.items)
    if (current.fingerprint !== material.fingerprint) { setImportError('官方材料已经更新，请重新打开模型分析'); return }
    try {
      const saved = await saveWeeklyAnalysis({ analystId: importAnalyst, fingerprint: material.fingerprint, markdown: value })
      setSnapshot(previous => previous ? { ...previous, analyses: [...previous.analyses.filter(item => !(item.analystId === saved.analystId && item.fingerprint === saved.fingerprint)), saved] } : previous)
      setImportAnalyst(''); setImportValue(''); setAwaiting(currentAwaiting => currentAwaiting.filter(id => id !== saved.analystId))
    } catch (cause) { setImportError(cause instanceof Error ? cause.message : '保存分析失败') }
  }

  const visible = (snapshot?.items || []).filter(item => category === '全部' || item.category === category)
  const failures = snapshot?.sources.filter(source => source.error) || []
  const activeFingerprint = material?.fingerprint || snapshot?.analyses[0]?.fingerprint
  const activeAnalyses = (snapshot?.analyses || []).filter(analysis => analysis.fingerprint === activeFingerprint)
  const parsed = activeAnalyses.map(analysis => ({ analystId: analysis.analystId, parsed: parseWeeklyAnalysis(analysis.markdown) }))
  const comparison = useMemo(() => compareWeeklyAnalyses(parsed), [activeAnalyses.map(item => `${item.analystId}:${item.updatedAt}`).join('|')])
  const itemByNumber = useMemo(() => new Map((snapshot?.items || []).map((item, index) => [`AI-${String(index + 1).padStart(3, '0')}`, item])), [snapshot])

  return <main className="overview weekly-view">
    <header className="overview-hero weekly-hero"><div><span className="eyebrow">最近 7 天 · 官方来源</span><h1>这一周，AI 又向前走了哪里？</h1><p>从官方发布出发，再用多个免费模型交叉审视影响与争议。</p></div><button className="primary" disabled={refreshing} onClick={refresh}><RefreshCw size={17}/>{refreshing ? '正在刷新…' : snapshot?.items.length ? '刷新官方消息' : '获取本周消息'}</button></header>
    {error && <p className="weekly-alert" role="alert"><AlertCircle size={16}/>{error}</p>}
    {failures.length > 0 && <p className="weekly-alert partial"><AlertCircle size={16}/>未更新：{failures.map(item => item.id).join('、')}。已保留上次成功结果。</p>}
    <div className="weekly-meta"><span><ShieldCheck size={15}/>事实以官方原文为准</span><span>{snapshot?.updatedAt ? `更新于 ${new Date(snapshot.updatedAt).toLocaleString('zh-CN')}` : '尚未获取官方消息'}</span></div>
    {loading ? <p className="weekly-empty">正在读取本地周报…</p> : !snapshot?.items.length ? <section className="weekly-empty"><h2>还没有本周消息</h2><p>点击“获取本周消息”，从六个官方来源建立第一份可核验周报。</p></section> : <>
      <section className="weekly-lead"><span className="eyebrow">本周关键进展</span>{snapshot.items.slice(0, 3).map(item => <article key={item.id}><span>{item.organization} · {new Date(item.publishedAt).toLocaleDateString('zh-CN')}</span><h2>{item.title}</h2><p>{item.summary || '请打开官方原文查看完整内容。'}</p><a href={item.url} target="_blank" rel="noreferrer">查看官方原文<ExternalLink size={14}/></a></article>)}</section>
      <section className="weekly-feed"><div className="section-head"><div><span className="eyebrow">官方消息时间线</span><h2>最近七天</h2></div><div className="weekly-filters">{categories.map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}</button>)}</div></div><div className="weekly-timeline">{visible.map(item => <article className="weekly-item" key={item.id}><div><span>{item.category}</span><time>{new Date(item.publishedAt).toLocaleDateString('zh-CN')}</time></div><div><small>{item.organization}</small><h3>{item.title}</h3><p>{item.summary || '官方页面未提供摘要。'}</p><a aria-label={`查看官方原文：${item.title}`} href={item.url} target="_blank" rel="noreferrer">官方原文<ExternalLink size={13}/></a></div></article>)}</div></section>
      <section className="weekly-analysis"><div className="section-head"><div><span className="eyebrow">多模型交叉验证</span><h2>同一份材料，三种判断</h2></div></div><p className="analysis-intro">模型只分析上面的公开材料，不读取你的私人内容。至少导入两个结果后形成对照。</p><div className="analyst-slots">{WEEKLY_ANALYSTS.map(analyst => { const saved = activeAnalyses.find(item => item.analystId === analyst.id); const waiting = awaiting.includes(analyst.id); return <article key={analyst.id}><div><h3>{analyst.name}</h3><span>{saved ? <><CheckCircle2 size={14}/>已导入</> : waiting ? '等待分析' : '网页版可用'}</span></div><button onClick={() => openAnalyst(analyst.id)}>{saved ? '重新分析' : `交给 ${analyst.name} 分析`}</button>{waiting && <button className="text-button" onClick={() => beginImport(analyst.id)}>粘贴 {analyst.name} 分析</button>}{blockedAnalyst === analyst.id && <a href={analyst.url} target="_blank" rel="noreferrer">打开 {analyst.name} 官网</a>}</article>})}</div>{manualPrompt && <textarea className="weekly-manual-prompt" aria-label="待复制的周报材料" value={manualPrompt} readOnly/>}
      {activeAnalyses.length >= 2 ? <Comparison comparison={comparison} itemByNumber={itemByNumber}/> : <p className="comparison-empty">再导入一个模型即可形成对照。</p>}</section>
    </>}
    {importAnalyst && <div className="import-backdrop" role="presentation"><section className="import-dialog" role="dialog" aria-modal="true" aria-labelledby="weekly-import-title"><h2 id="weekly-import-title">粘贴模型分析</h2><p>确认内容基于当前材料，可在保存前编辑。</p><textarea aria-label="模型分析预览" value={importValue} onChange={event => setImportValue(event.target.value)} autoFocus/>{importError && <p className="import-error" role="alert">{importError}</p>}<div className="import-actions"><button className="primary" onClick={confirmImport}>保存分析</button><button className="text-button" onClick={() => setImportAnalyst('')}>取消</button></div></section></div>}
  </main>
}

function Comparison({ comparison, itemByNumber }: { comparison: ReturnType<typeof compareWeeklyAnalyses>; itemByNumber: Map<string, { title: string }> }) {
  const group = (title: string, ids: string[]) => ids.length ? <div><h3>{title}</h3><ul>{ids.map(id => <li key={id}><b>{id}</b> {itemByNumber.get(id)?.title || '关联材料'}</li>)}</ul></div> : null
  return <section className="comparison-section" aria-label="模型交叉对照">{group('三模型共识', comparison.threeWayConsensus)}{group('至少两个模型认同', comparison.consensus)}{group('观点分歧', comparison.disagreements)}{group('单模型观察', comparison.singleModel)}{comparison.unverified.length > 0 && <div><h3>待核实</h3><ul>{comparison.unverified.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></div>}</section>
}
