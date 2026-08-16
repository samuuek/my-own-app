import { expect, test } from 'vitest'
import { buildWeeklyMaterial, compareWeeklyAnalyses, parseWeeklyAnalysis } from './weekly-handoff'
import type { WeeklyItem } from './weekly-api'

const itemA: WeeklyItem = { id: 'a', sourceId: 'openai', organization: 'OpenAI', title: 'A', url: 'https://openai.com/a', publishedAt: '2026-08-15T00:00:00Z', category: '产品', summary: 'A summary', significance: '' }
const itemB: WeeklyItem = { id: 'b', sourceId: 'meta', organization: 'Meta AI', title: 'B', url: 'https://ai.meta.com/blog/b', publishedAt: '2026-08-14T00:00:00Z', category: '研究', summary: 'B summary', significance: '' }

test('builds one stable material prompt independent of input order', async () => {
  const first = await buildWeeklyMaterial([itemB, itemA])
  const second = await buildWeeklyMaterial([itemA, itemB])
  expect(first.fingerprint).toBe(second.fingerprint)
  expect(first.prompt).toBe(second.prompt)
  expect(first.prompt).toContain('[AI-001]')
  expect(first.prompt).toContain('只分析以下官方材料')
})

test('separates consensus, disagreement, and unverified claims', () => {
  const deepseek = parseWeeklyAnalysis('## 三项关键进展\n- [AI-001] 很重要\n## 趋势判断\n- 没有编号的判断')
  const qwen = parseWeeklyAnalysis('## 三项关键进展\n- [AI-001] 值得关注')
  const kimi = parseWeeklyAnalysis('## 可能被高估的进展及理由\n- [AI-001] 影响可能有限')
  const result = compareWeeklyAnalyses([
    { analystId: 'deepseek-web', parsed: deepseek },
    { analystId: 'qwen-web', parsed: qwen },
    { analystId: 'kimi-web', parsed: kimi },
  ])
  expect(result.consensus).toContain('AI-001')
  expect(result.disagreements).toContain('AI-001')
  expect(result.unverified.join(' ')).toContain('没有编号的判断')
})
