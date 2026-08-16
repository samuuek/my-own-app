export type WeeklyCategory = '模型' | '产品' | '研究' | '开源' | '政策'
export type WeeklyItem = { id: string; sourceId: string; organization: string; title: string; url: string; publishedAt: string; category: WeeklyCategory; summary: string; significance: string }
export type WeeklySourceStatus = { id: string; lastSuccessAt?: string; lastAttemptAt?: string; error?: string }
export type WeeklyAnalysis = { analystId: string; fingerprint: string; markdown: string; updatedAt: string }
export type WeeklySnapshot = { items: WeeklyItem[]; sources: WeeklySourceStatus[]; updatedAt?: string; stale: boolean; analyses: WeeklyAnalysis[] }

async function request(url: string, init?: RequestInit): Promise<WeeklySnapshot> {
  const response = await fetch(url, init)
  const data = await response.json() as WeeklySnapshot & { error?: string }
  if (!response.ok) throw new Error(data.error || '周报请求失败')
  return data
}

export const fetchWeekly = () => request('/api/weekly')
export const refreshWeekly = () => request('/api/weekly/refresh', { method: 'POST' })

export async function saveWeeklyAnalysis(input: { analystId: string; fingerprint: string; markdown: string }): Promise<WeeklyAnalysis> {
  const response = await fetch('/api/weekly/analyses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const data = await response.json() as { analysis?: WeeklyAnalysis; error?: string }
  if (!response.ok || !data.analysis) throw new Error(data.error || '保存分析失败')
  return data.analysis
}
