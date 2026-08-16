import type { WeeklyItem } from './weekly-api'

export const WEEKLY_ANALYSTS = [
  { id: 'deepseek-web', name: 'DeepSeek', url: 'https://chat.deepseek.com/' },
  { id: 'qwen-web', name: '通义千问', url: 'https://www.qianwen.com/' },
  { id: 'kimi-web', name: 'Kimi', url: 'https://www.kimi.com/' },
] as const

export type ParsedAnalysis = { status: 'recognized' | 'unrecognized'; sections: Record<string, string[]>; references: Record<string, string[]>; unverified: string[]; raw: string }

export async function buildWeeklyMaterial(items: WeeklyItem[]) {
  const sorted = [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.url.localeCompare(b.url))
  const material = sorted.map((item, index) => `[AI-${String(index + 1).padStart(3, '0')}]\n机构：${item.organization}\n日期：${item.publishedAt.slice(0, 10)}\n标题：${item.title}\n摘要：${item.summary || '官方页面未提供摘要'}\n原文：${item.url}`).join('\n\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material))
  const fingerprint = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')
  const prompt = `你是 AI 行业周报分析员。只分析以下官方材料，不要添加清单之外的最新消息，也不要把自身知识当作来源。每个判断必须引用 [AI-001] 形式的编号。\n\n请严格使用以下 Markdown 标题：\n## 三项关键进展\n## 趋势判断\n## 可能被高估的进展及理由\n## 尚待核实的问题\n## 一句总结\n\n${material}`
  return { fingerprint, prompt }
}

const headings = ['三项关键进展', '趋势判断', '可能被高估的进展及理由', '尚待核实的问题', '一句总结']

export function parseWeeklyAnalysis(markdown: string): ParsedAnalysis {
  const sections: Record<string, string[]> = Object.fromEntries(headings.map(heading => [heading, []]))
  const references: Record<string, string[]> = Object.fromEntries(headings.map(heading => [heading, []]))
  const unverified: string[] = []
  let current = ''
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/)?.[1]
    if (heading && headings.includes(heading)) { current = heading; continue }
    const content = line.replace(/^[-*]\s*/, '').trim()
    if (!current || !content) continue
    sections[current].push(content)
    const ids = [...content.matchAll(/AI-\d{3}/g)].map(match => match[0])
    references[current].push(...ids)
    if (!ids.length && current !== '一句总结') unverified.push(content)
  }
  const recognized = Object.values(sections).some(lines => lines.length)
  return { status: recognized ? 'recognized' : 'unrecognized', sections, references, unverified, raw: markdown }
}

export function compareWeeklyAnalyses(analyses: Array<{ analystId: string; parsed: ParsedAnalysis }>) {
  const positive = new Map<string, Set<string>>()
  const overestimated = new Map<string, Set<string>>()
  const unverified = analyses.flatMap(analysis => analysis.parsed.unverified)
  for (const analysis of analyses) {
    for (const id of [...analysis.parsed.references['三项关键进展'], ...analysis.parsed.references['趋势判断']]) {
      if (!positive.has(id)) positive.set(id, new Set())
      positive.get(id)!.add(analysis.analystId)
    }
    for (const id of analysis.parsed.references['可能被高估的进展及理由']) {
      if (!overestimated.has(id)) overestimated.set(id, new Set())
      overestimated.get(id)!.add(analysis.analystId)
    }
  }
  const consensus = [...positive].filter(([, models]) => models.size >= 2).map(([id]) => id)
  const threeWayConsensus = [...positive].filter(([, models]) => models.size >= 3).map(([id]) => id)
  const disagreements = [...positive.keys()].filter(id => overestimated.has(id))
  const singleModel = [...new Set([...positive.keys(), ...overestimated.keys()])].filter(id => (positive.get(id)?.size || 0) + (overestimated.get(id)?.size || 0) === 1)
  return { consensus, threeWayConsensus, disagreements, singleModel, unverified }
}
