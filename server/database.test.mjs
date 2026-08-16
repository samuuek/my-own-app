// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createDatabase } from './database.mjs'

describe('local database', () => {
  let store

  beforeEach(() => { store = createDatabase(':memory:') })
  afterEach(() => store.close())

  test('seeds topics and creates a matching workspace', () => {
    expect(store.listTopics()).toHaveLength(3)
    const topic = store.createTopic({ title: '测试议题', kind: '为你推荐' })
    expect(store.getTopic(topic.id)?.title).toBe('测试议题')
    expect(store.getWorkspace(topic.id)).toMatchObject({ topicId: topic.id, note: '', messages: [] })
  })

  test('updates workspace fields and keeps messages ordered', () => {
    store.updateWorkspace('ai-memory', { note: '私人想法', reflection: '进一步感思', selectedModel: 'deepseek-chat' })
    store.addMessage('ai-memory', { id: 'm2', role: 'assistant', content: '第二条', createdAt: '2026-08-15T10:00:02.000Z' })
    store.addMessage('ai-memory', { id: 'm1', role: 'user', content: '第一条', createdAt: '2026-08-15T10:00:01.000Z' })
    expect(store.getWorkspace('ai-memory')).toMatchObject({ note: '私人想法', reflection: '进一步感思', selectedModel: 'deepseek-chat' })
    expect(store.listMessages('ai-memory').map(message => message.id)).toEqual(['m2', 'm1'])
  })

  test('searches, updates and deletes topics', () => {
    expect(store.listTopics({ query: '记忆' })).toHaveLength(1)
    expect(store.updateTopic('ai-memory', { status: '已沉淀' })?.status).toBe('已沉淀')
    expect(store.deleteTopic('ai-memory')).toBe(true)
    expect(store.getTopic('ai-memory')).toBeNull()
  })

  test('exports and restores a versioned backup without secrets', () => {
    store.updateWorkspace('ai-memory', { note: '要备份的内容' })
    const backup = store.exportBackup()
    expect(backup.version).toBe(1)
    expect(JSON.stringify(backup)).not.toContain('API_KEY')
    const target = createDatabase(':memory:', { seed: false })
    target.restoreBackup(backup)
    expect(target.getWorkspace('ai-memory').note).toBe('要备份的内容')
    target.close()
  })

  test('preserves cached weekly items when a source refresh fails', () => {
    store.replaceWeeklySource('openai', [{ id: 'a', sourceId: 'openai', organization: 'OpenAI', title: 'A', url: 'https://openai.com/a', publishedAt: '2026-08-15T00:00:00Z', category: '产品', summary: 's', significance: '' }], '2026-08-16T00:00:00Z')
    store.replaceWeeklySource('meta', [{ id: 'b', sourceId: 'meta', organization: 'Meta AI', title: 'B', url: 'https://ai.meta.com/blog/b', publishedAt: '2026-08-15T00:00:00Z', category: '研究', summary: 's', significance: '' }], '2026-08-16T00:00:00Z')
    store.markWeeklySourceError('openai', 'timeout', '2026-08-16T01:00:00Z')
    const snapshot = store.getWeeklySnapshot(new Date('2026-08-16T02:00:00Z'))
    expect(snapshot.items.map(item => item.id).sort()).toEqual(['a', 'b'])
    expect(snapshot.sources.find(source => source.id === 'openai')?.error).toBe('timeout')
  })

  test('isolates model analyses by material fingerprint', () => {
    store.saveWeeklyAnalysis({ analystId: 'deepseek-web', fingerprint: 'v1', markdown: 'old' })
    store.saveWeeklyAnalysis({ analystId: 'deepseek-web', fingerprint: 'v2', markdown: 'new' })
    expect(store.listWeeklyAnalyses('v2')).toEqual([expect.objectContaining({ analystId: 'deepseek-web', fingerprint: 'v2', markdown: 'new' })])
  })
})
