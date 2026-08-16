import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chatWithModel, publicModels } from './models.mjs'
import { fetchWeeklySource, WEEKLY_SOURCES } from './weekly-sources.mjs'

class ApiError extends Error {
  constructor(message, status = 400, code = 'VALIDATION_ERROR') { super(message); this.status = status; this.code = code }
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (body.length > 1_000_000) throw new ApiError('请求内容过大', 413, 'PAYLOAD_TOO_LARGE')
  }
  try { return JSON.parse(body || '{}') } catch { throw new ApiError('请求格式无效') }
}

const send = (response, status, data) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(data))
}

function validateTopic(input) {
  if (typeof input.title !== 'string' || !input.title.trim()) throw new ApiError('议题标题不能为空')
  if (input.title.trim().length > 200) throw new ApiError('议题标题不能超过 200 个字')
}

function validateWorkspace(input) {
  const allowed = new Set(['note', 'reflection', 'resources', 'summary', 'mindMap', 'selectedModel'])
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) throw new ApiError(`不支持字段：${key}`)
    if (typeof value !== 'string') throw new ApiError(`${key} 必须是文本`)
    if (value.length > 200_000) throw new ApiError(`${key} 内容过长`)
  }
}

async function serveStatic(request, response, distDir) {
  if (!distDir || request.method !== 'GET') return false
  const url = new URL(request.url, 'http://localhost')
  const relative = url.pathname === '/' ? 'index.html' : normalize(url.pathname).replace(/^[/\\]+/, '')
  if (relative.includes('..')) return false
  const file = join(distDir, relative)
  try {
    const content = await readFile(file)
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
    response.end(content)
    return true
  } catch {
    if (extname(relative)) return false
    try { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(await readFile(join(distDir, 'index.html'))); return true } catch { return false }
  }
}

export function createApiServer({ store, env = process.env, fetcher = fetch, distDir, weeklySources = WEEKLY_SOURCES, weeklyFetcher = fetchWeeklySource } = {}) {
  return createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost')
    const path = decodeURIComponent(url.pathname)
    try {
      if (request.method === 'GET' && path === '/api/health') return send(response, 200, { ok: true, database: 'ready' })
      if (request.method === 'GET' && path === '/api/models') return send(response, 200, { models: publicModels(env) })
      if (request.method === 'GET' && path === '/api/weekly') {
        const snapshot = store.getWeeklySnapshot(new Date())
        return send(response, 200, { ...snapshot, analyses: store.listWeeklyAnalyses() })
      }
      if (request.method === 'POST' && path === '/api/weekly/refresh') {
        const attemptedAt = new Date().toISOString()
        await Promise.all(weeklySources.map(async source => {
          try { store.replaceWeeklySource(source.id, await weeklyFetcher(source, { fetcher, now: new Date() }), attemptedAt) }
          catch (error) { store.markWeeklySourceError(source.id, error instanceof Error ? error.message : '刷新失败', attemptedAt) }
        }))
        const snapshot = store.getWeeklySnapshot(new Date())
        return send(response, 200, { ...snapshot, analyses: store.listWeeklyAnalyses() })
      }
      if (request.method === 'POST' && path === '/api/weekly/analyses') {
        const input = await readJson(request)
        if (!['deepseek-web', 'qwen-web', 'kimi-web'].includes(input.analystId)) throw new ApiError('不支持的分析模型')
        if (typeof input.fingerprint !== 'string' || !input.fingerprint.trim()) throw new ApiError('材料版本不能为空')
        if (typeof input.markdown !== 'string' || !input.markdown.trim() || input.markdown.length > 200_000) throw new ApiError('分析内容无效')
        return send(response, 201, { analysis: store.saveWeeklyAnalysis({ analystId: input.analystId, fingerprint: input.fingerprint.trim(), markdown: input.markdown.trim() }) })
      }
      if (request.method === 'GET' && path === '/api/topics') return send(response, 200, { topics: store.listTopics({ query: url.searchParams.get('q') || '', status: url.searchParams.get('status') || '' }) })
      if (request.method === 'POST' && path === '/api/topics') {
        const input = await readJson(request); validateTopic(input)
        return send(response, 201, { topic: store.createTopic(input) })
      }
      const topicMatch = path.match(/^\/api\/topics\/([^/]+)$/)
      if (topicMatch) {
        const id = topicMatch[1]
        if (request.method === 'GET') { const topic = store.getTopic(id); if (!topic) throw new ApiError('议题不存在', 404, 'NOT_FOUND'); return send(response, 200, { topic }) }
        if (request.method === 'PATCH') { const input = await readJson(request); if (input.title !== undefined) validateTopic({ title: input.title }); const topic = store.updateTopic(id, input); if (!topic) throw new ApiError('议题不存在', 404, 'NOT_FOUND'); return send(response, 200, { topic }) }
        if (request.method === 'DELETE') { if (!store.deleteTopic(id)) throw new ApiError('议题不存在', 404, 'NOT_FOUND'); return send(response, 200, { deleted: true }) }
      }
      const workspaceMatch = path.match(/^\/api\/workspaces\/([^/]+)$/)
      if (workspaceMatch) {
        const topicId = workspaceMatch[1]
        if (request.method === 'GET') { const workspace = store.getWorkspace(topicId); if (!workspace) throw new ApiError('思考空间不存在', 404, 'NOT_FOUND'); return send(response, 200, { workspace }) }
        if (request.method === 'PATCH') { const input = await readJson(request); validateWorkspace(input); const workspace = store.updateWorkspace(topicId, input); if (!workspace) throw new ApiError('思考空间不存在', 404, 'NOT_FOUND'); return send(response, 200, { workspace }) }
      }
      const messagesMatch = path.match(/^\/api\/workspaces\/([^/]+)\/messages$/)
      if (messagesMatch) {
        const topicId = messagesMatch[1]
        if (request.method === 'GET') return send(response, 200, { messages: store.listMessages(topicId) })
        if (request.method === 'POST') {
          const input = await readJson(request)
          if (!['user', 'assistant', 'system'].includes(input.role) || typeof input.content !== 'string' || !input.content.trim() || input.content.length > 200_000) throw new ApiError('消息内容无效')
          const message = store.addMessage(topicId, input); if (!message) throw new ApiError('思考空间不存在', 404, 'NOT_FOUND')
          return send(response, 201, { message })
        }
      }
      if (request.method === 'POST' && path === '/api/chat') {
        const input = await readJson(request)
        if (!input.model || !Array.isArray(input.messages) || input.messages.length === 0) throw new ApiError('请选择模型并输入消息')
        if (input.messages.length > 500 || input.messages.some(message => !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim() || message.content.length > 200_000)) throw new ApiError('消息格式无效')
        if (input.topicId && !store.getTopic(input.topicId)) throw new ApiError('思考空间不存在', 404, 'NOT_FOUND')
        const lastUser = [...input.messages].reverse().find(message => message.role === 'user')
        if (input.topicId && lastUser) store.addMessage(input.topicId, { id: input.messageId || randomUUID(), role: 'user', content: lastUser.content })
        const content = await chatWithModel(input, env, fetcher)
        const message = input.topicId ? store.addMessage(input.topicId, { role: 'assistant', content, modelId: input.model }) : null
        return send(response, 200, { content, message })
      }
      if (request.method === 'GET' && path === '/api/backup') return send(response, 200, store.exportBackup())
      if (request.method === 'POST' && path === '/api/restore') return send(response, 200, store.restoreBackup(await readJson(request)))
      if (!path.startsWith('/api/') && await serveStatic(request, response, distDir)) return
      throw new ApiError('接口不存在', 404, 'NOT_FOUND')
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 400
      const code = error instanceof ApiError ? error.code : 'REQUEST_FAILED'
      const message = error instanceof Error ? error.message : '请求失败'
      send(response, status, { error: message, code })
    }
  })
}
