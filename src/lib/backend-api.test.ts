import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTopic, fetchTopics, fetchWorkspace, updateWorkspace } from './backend-api'

afterEach(() => vi.unstubAllGlobals())

describe('backend API client', () => {
  test('loads topics from the local backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ topics: [{ id: 'one', title: '议题' }] }) }))
    await expect(fetchTopics()).resolves.toEqual([{ id: 'one', title: '议题' }])
  })

  test('creates topics and saves workspace fields', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ topic: { id: 'new', title: '新议题' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workspace: { topicId: 'new', note: '旁注', messages: [] } }) })
    vi.stubGlobal('fetch', fetcher)
    await expect(createTopic({ title: '新议题' })).resolves.toMatchObject({ id: 'new' })
    await expect(updateWorkspace('new', { note: '旁注' })).resolves.toMatchObject({ note: '旁注' })
    expect(fetcher).toHaveBeenLastCalledWith('/api/workspaces/new', expect.objectContaining({ method: 'PATCH' }))
  })

  test('loads a complete workspace and exposes backend errors', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workspace: { topicId: 'one', messages: [] } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: '保存失败' }) }))
    await expect(fetchWorkspace('one')).resolves.toMatchObject({ topicId: 'one' })
    await expect(updateWorkspace('one', { note: 'x' })).rejects.toThrow('保存失败')
  })
})
