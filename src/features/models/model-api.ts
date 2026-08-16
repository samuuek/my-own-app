import { DEEPSEEK_WEB_ID } from './web-handoff'

export type ModelKind = 'demo' | 'api' | 'web-handoff'
export type ModelInfo = { id: string; name: string; provider: string; available: boolean; kind: ModelKind; demo?: boolean }
export const fallbackModels: ModelInfo[] = [
  { id: DEEPSEEK_WEB_ID, name: '免费网页版', provider: 'DeepSeek', available: true, kind: 'web-handoff' },
  { id: 'siyu-demo', name: '思屿演示模型', provider: '本地演示', available: true, kind: 'demo', demo: true },
  { id: 'doubao-pro', name: '豆包 Pro', provider: '豆包', available: false, kind: 'api' },
  { id: 'qwen-plus', name: '千问 Plus', provider: '千问', available: false, kind: 'api' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', available: false, kind: 'api' },
  { id: 'custom-model', name: '自定义模型', provider: '自定义 API', available: false, kind: 'api' },
]

export async function fetchModels(): Promise<ModelInfo[]> {
  const response = await fetch('/api/models')
  if (!response.ok) throw new Error('无法读取模型配置')
  const models = (await response.json() as { models: Array<Omit<ModelInfo, 'kind'> & { demo?: boolean }> }).models
  return [fallbackModels[0], ...models.map(model => ({ ...model, kind: model.demo ? 'demo' as const : 'api' as const }))]
}

export async function sendChat(topicId: string, model: string, messageId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<{ content: string; message?: { id: string; createdAt: string } }> {
  const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId, model, messageId, messages }) })
  const data = await response.json() as { content?: string; message?: { id: string; createdAt: string }; error?: string }
  if (!response.ok || !data.content) throw new Error(data.error || '模型请求失败')
  return { content: data.content, message: data.message }
}
