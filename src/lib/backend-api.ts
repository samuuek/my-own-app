import type { Topic } from '../features/topics/topic-data'

export type StoredMessage = { id: string; role: 'user' | 'assistant' | 'system'; content: string; modelId?: string; createdAt: string }
export type WorkspaceData = {
  topicId: string
  note: string
  reflection: string
  resources: string
  summary: string
  mindMap: string
  selectedModel: string
  updatedAt: string
  messages: StoredMessage[]
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error || '本地服务请求失败')
  return data
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export async function fetchTopics(): Promise<Topic[]> {
  return (await request<{ topics: Topic[] }>('/api/topics')).topics
}

export async function createTopic(input: Partial<Topic> & { title: string }): Promise<Topic> {
  return (await request<{ topic: Topic }>('/api/topics', json('POST', input))).topic
}

export async function fetchWorkspace(topicId: string): Promise<WorkspaceData> {
  return (await request<{ workspace: WorkspaceData }>(`/api/workspaces/${encodeURIComponent(topicId)}`)).workspace
}

export async function updateWorkspace(topicId: string, input: Partial<Pick<WorkspaceData, 'note' | 'reflection' | 'resources' | 'summary' | 'mindMap' | 'selectedModel'>>): Promise<WorkspaceData> {
  return (await request<{ workspace: WorkspaceData }>(`/api/workspaces/${encodeURIComponent(topicId)}`, json('PATCH', input))).workspace
}

export async function addMessage(topicId: string, input: Pick<StoredMessage, 'id' | 'role' | 'content'> & Partial<StoredMessage>): Promise<StoredMessage> {
  return (await request<{ message: StoredMessage }>(`/api/workspaces/${encodeURIComponent(topicId)}/messages`, json('POST', input))).message
}
