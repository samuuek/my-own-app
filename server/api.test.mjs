// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDatabase } from './database.mjs'
import { createApiServer } from './http.mjs'

describe('local HTTP API', () => {
  let store
  let server
  let origin

  beforeEach(async () => {
    store = createDatabase(':memory:')
    server = createApiServer({ store, env: {}, fetcher: vi.fn() })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${server.address().port}`
  })

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve))
    store.close()
  })

  test('reports health and returns topics', async () => {
    expect(await fetch(`${origin}/api/health`).then(response => response.json())).toMatchObject({ ok: true, database: 'ready' })
    const payload = await fetch(`${origin}/api/topics`).then(response => response.json())
    expect(payload.topics).toHaveLength(3)
  })

  test('validates writes and uses a consistent error shape', async () => {
    const response = await fetch(`${origin}/api/topics`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '' }) })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: '议题标题不能为空', code: 'VALIDATION_ERROR' })
  })

  test('persists workspace changes through the API', async () => {
    const response = await fetch(`${origin}/api/workspaces/ai-memory`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: '只写给自己' }) })
    expect(response.status).toBe(200)
    const workspace = await fetch(`${origin}/api/workspaces/ai-memory`).then(result => result.json())
    expect(workspace.workspace.note).toBe('只写给自己')
  })

  test('returns not found for a missing workspace', async () => {
    const response = await fetch(`${origin}/api/workspaces/missing-topic`)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: '思考空间不存在', code: 'NOT_FOUND' })
  })

  test('returns model content and stores both sides of a chat', async () => {
    const response = await fetch(`${origin}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId: 'ai-memory', model: 'siyu-demo', messages: [{ role: 'user', content: '你好' }] }) })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.content).toContain('演示回复')
    expect(store.listMessages('ai-memory').map(message => message.role)).toEqual(['user', 'assistant'])
  })

  test('exports and restores backup data', async () => {
    const backup = await fetch(`${origin}/api/backup`).then(response => response.json())
    const response = await fetch(`${origin}/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(backup) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ restored: true })
  })

  test('refreshes weekly sources independently and preserves partial success', async () => {
    await new Promise(resolve => server.close(resolve))
    const sources = [
      { id: 'openai', organization: 'OpenAI', url: 'https://openai.com/news/', allowedHosts: ['openai.com'], category: '产品' },
      { id: 'meta', organization: 'Meta AI', url: 'https://ai.meta.com/blog/', allowedHosts: ['ai.meta.com'], category: '研究' },
    ]
    server = createApiServer({ store, env: {}, weeklySources: sources, weeklyFetcher: vi.fn(async source => {
      if (source.id === 'meta') throw new Error('timeout')
      return [{ id: 'weekly-a', sourceId: 'openai', organization: 'OpenAI', title: 'A', url: 'https://openai.com/a', publishedAt: new Date().toISOString(), category: '产品', summary: 's', significance: '' }]
    }) })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${server.address().port}`

    const response = await fetch(`${origin}/api/weekly/refresh`, { method: 'POST' })
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.items.map(item => item.id)).toContain('weekly-a')
    expect(payload.sources.find(source => source.id === 'meta')?.error).toBe('timeout')
  })
})
