// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { chatWithModel, publicModels } from './models.mjs'

describe('production model gateway', () => {
  test('publishes availability without exposing API keys', () => {
    const models = publicModels({ DEEPSEEK_API_KEY: 'secret-value' })
    expect(models.find(model => model.id === 'deepseek-chat')?.available).toBe(true)
    expect(models.find(model => model.id === 'doubao-pro')?.available).toBe(false)
    expect(JSON.stringify(models)).not.toContain('secret-value')
  })

  test('rejects an unknown model', async () => {
    await expect(chatWithModel({ model: 'unknown', messages: [] }, {}, vi.fn())).rejects.toThrow('不支持的模型')
  })

  test('forwards compatible requests with server-side bearer auth', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '回答' } }] }) })
    await expect(chatWithModel({ model: 'deepseek-chat', messages: [{ role: 'user', content: '你好' }] }, { DEEPSEEK_API_KEY: 'secret' }, fetcher)).resolves.toBe('回答')
    expect(fetcher).toHaveBeenCalledWith('https://api.deepseek.com/chat/completions', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }))
  })
})
