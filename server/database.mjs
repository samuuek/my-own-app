import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

const seedTopics = [
  { id: 'ai-memory', kind: '热点', title: '当 AI 开始替我们记忆，我们会失去什么？', summary: '从便利、认知外包与个人叙事三个角度，重新审视人与记忆工具的关系。', reason: '与你近期关注的 AI 与独立思考相关', source: '2 个来源 · 更新于今天 08:30', color: 'blue' },
  { id: 'slow-thinking', kind: '为你推荐', title: '什么样的慢，反而能让思考更快？', summary: '讨论信息密度、留白与深度判断之间的关系，并形成可实践的方法。', reason: '延续你尚未解决的「信息过载」议题', source: '基于已授权的议题摘要', color: 'green' },
  { id: 'certainty', kind: '随机思想', title: '如果答案不再稀缺，我们还需要追求确定吗？', summary: '从学习、选择与创造三个场景，探索“不确定”是否也是一种能力。', reason: '随机思想题 · 近 30 天未出现相似主题', source: '思想题库 · 今日抽取', color: 'amber' },
]

const now = () => new Date().toISOString()
const cleanText = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback

function topicRow(row) {
  if (!row) return null
  return { id: row.id, kind: row.kind, title: row.title, summary: row.summary, reason: row.reason, source: row.source, color: row.color, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }
}

function messageRow(row) {
  return { id: row.id, role: row.role, content: row.content, modelId: row.model_id || undefined, createdAt: row.created_at }
}

export function createDatabase(filename = resolve('data', 'siyu.db'), options = {}) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', color TEXT NOT NULL DEFAULT 'green',
      status TEXT NOT NULL DEFAULT '讨论中', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      topic_id TEXT PRIMARY KEY REFERENCES topics(id) ON DELETE CASCADE,
      note TEXT NOT NULL DEFAULT '', reflection TEXT NOT NULL DEFAULT '', resources TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '', mind_map TEXT NOT NULL DEFAULT '', selected_model TEXT NOT NULL DEFAULT 'siyu-demo',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','system')), content TEXT NOT NULL,
      model_id TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_topic_sequence ON messages(topic_id, sequence);
    CREATE TABLE IF NOT EXISTS weekly_items (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, organization TEXT NOT NULL, title TEXT NOT NULL,
      url TEXT NOT NULL, published_at TEXT NOT NULL, category TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      significance TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS weekly_items_published ON weekly_items(published_at DESC);
    CREATE TABLE IF NOT EXISTS weekly_source_status (
      source_id TEXT PRIMARY KEY, last_success_at TEXT, last_attempt_at TEXT, error TEXT
    );
    CREATE TABLE IF NOT EXISTS weekly_analyses (
      analyst_id TEXT NOT NULL, fingerprint TEXT NOT NULL, markdown TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (analyst_id, fingerprint)
    );
  `)

  const ensureWorkspace = db.prepare(`INSERT OR IGNORE INTO workspaces (topic_id, updated_at) VALUES (?, ?)`)
  const insertTopic = db.prepare(`INSERT OR IGNORE INTO topics (id, kind, title, summary, reason, source, color, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  if (options.seed !== false) {
    for (const topic of seedTopics) {
      const timestamp = now()
      insertTopic.run(topic.id, topic.kind, topic.title, topic.summary, topic.reason, topic.source, topic.color, '讨论中', timestamp, timestamp)
      ensureWorkspace.run(topic.id, timestamp)
    }
  }

  const api = {
    close: () => db.close(),
    listTopics({ query = '', status = '' } = {}) {
      const clauses = []
      const params = []
      if (query) { clauses.push('(title LIKE ? OR summary LIKE ?)'); params.push(`%${query}%`, `%${query}%`) }
      if (status && status !== '全部') { clauses.push('status = ?'); params.push(status) }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
      return db.prepare(`SELECT * FROM topics ${where} ORDER BY updated_at DESC`).all(...params).map(topicRow)
    },
    getTopic(id) { return topicRow(db.prepare('SELECT * FROM topics WHERE id = ?').get(id)) },
    createTopic(input) {
      const timestamp = now()
      const topic = {
        id: cleanText(input.id) || randomUUID(), kind: cleanText(input.kind, '为你推荐'), title: cleanText(input.title),
        summary: cleanText(input.summary), reason: cleanText(input.reason, '你创建的议题'), source: cleanText(input.source, '私人议题'),
        color: cleanText(input.color, 'green'), status: cleanText(input.status, '讨论中'), createdAt: timestamp, updatedAt: timestamp,
      }
      db.prepare(`INSERT INTO topics (id, kind, title, summary, reason, source, color, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(topic.id, topic.kind, topic.title, topic.summary, topic.reason, topic.source, topic.color, topic.status, timestamp, timestamp)
      ensureWorkspace.run(topic.id, timestamp)
      return topic
    },
    updateTopic(id, input) {
      const current = api.getTopic(id)
      if (!current) return null
      const next = { ...current, ...Object.fromEntries(Object.entries(input).filter(([key]) => ['kind', 'title', 'summary', 'reason', 'source', 'color', 'status'].includes(key))), updatedAt: now() }
      db.prepare(`UPDATE topics SET kind=?, title=?, summary=?, reason=?, source=?, color=?, status=?, updated_at=? WHERE id=?`)
        .run(next.kind, next.title, next.summary, next.reason, next.source, next.color, next.status, next.updatedAt, id)
      return api.getTopic(id)
    },
    deleteTopic(id) { return db.prepare('DELETE FROM topics WHERE id = ?').run(id).changes > 0 },
    getWorkspace(topicId) {
      if (!api.getTopic(topicId)) return null
      ensureWorkspace.run(topicId, now())
      const row = db.prepare('SELECT * FROM workspaces WHERE topic_id = ?').get(topicId)
      if (!row) return null
      return { topicId: row.topic_id, note: row.note, reflection: row.reflection, resources: row.resources, summary: row.summary, mindMap: row.mind_map, selectedModel: row.selected_model, updatedAt: row.updated_at, messages: api.listMessages(topicId) }
    },
    updateWorkspace(topicId, input) {
      if (!api.getTopic(topicId)) return null
      ensureWorkspace.run(topicId, now())
      const current = api.getWorkspace(topicId)
      const allowed = ['note', 'reflection', 'resources', 'summary', 'mindMap', 'selectedModel']
      const next = { ...current, ...Object.fromEntries(Object.entries(input).filter(([key]) => allowed.includes(key))), updatedAt: now() }
      db.prepare(`UPDATE workspaces SET note=?, reflection=?, resources=?, summary=?, mind_map=?, selected_model=?, updated_at=? WHERE topic_id=?`)
        .run(next.note, next.reflection, next.resources, next.summary, next.mindMap, next.selectedModel, next.updatedAt, topicId)
      db.prepare('UPDATE topics SET updated_at=? WHERE id=?').run(next.updatedAt, topicId)
      return api.getWorkspace(topicId)
    },
    listMessages(topicId) { return db.prepare('SELECT * FROM messages WHERE topic_id = ? ORDER BY sequence').all(topicId).map(messageRow) },
    addMessage(topicId, input) {
      if (!api.getTopic(topicId)) return null
      const message = { id: cleanText(input.id) || randomUUID(), role: input.role, content: cleanText(input.content), modelId: cleanText(input.modelId) || null, createdAt: cleanText(input.createdAt) || now() }
      const existing = db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id)
      if (existing) return messageRow(existing)
      db.prepare('INSERT INTO messages (id, topic_id, role, content, model_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(message.id, topicId, message.role, message.content, message.modelId, message.createdAt)
      db.prepare('UPDATE topics SET updated_at=? WHERE id=?').run(message.createdAt, topicId)
      return message
    },
    replaceWeeklySource(sourceId, items, refreshedAt = now()) {
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('DELETE FROM weekly_items WHERE source_id=?').run(sourceId)
        const insert = db.prepare('INSERT INTO weekly_items (id, source_id, organization, title, url, published_at, category, summary, significance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        for (const item of items) insert.run(item.id, sourceId, item.organization, item.title, item.url, item.publishedAt, item.category, item.summary || '', item.significance || '')
        db.prepare(`INSERT INTO weekly_source_status (source_id, last_success_at, last_attempt_at, error) VALUES (?, ?, ?, NULL) ON CONFLICT(source_id) DO UPDATE SET last_success_at=excluded.last_success_at,last_attempt_at=excluded.last_attempt_at,error=NULL`).run(sourceId, refreshedAt, refreshedAt)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    markWeeklySourceError(sourceId, message, attemptedAt = now()) {
      db.prepare(`INSERT INTO weekly_source_status (source_id, last_attempt_at, error) VALUES (?, ?, ?) ON CONFLICT(source_id) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,error=excluded.error`).run(sourceId, attemptedAt, cleanText(message, '刷新失败'))
    },
    getWeeklySnapshot(reference = new Date()) {
      const cutoff = new Date(reference.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const items = db.prepare('SELECT * FROM weekly_items WHERE published_at>=? AND published_at<=? ORDER BY published_at DESC').all(cutoff, reference.toISOString()).map(row => ({ id: row.id, sourceId: row.source_id, organization: row.organization, title: row.title, url: row.url, publishedAt: row.published_at, category: row.category, summary: row.summary, significance: row.significance }))
      const sources = db.prepare('SELECT * FROM weekly_source_status ORDER BY source_id').all().map(row => ({ id: row.source_id, lastSuccessAt: row.last_success_at || undefined, lastAttemptAt: row.last_attempt_at || undefined, error: row.error || undefined }))
      const updatedAt = sources.map(source => source.lastSuccessAt).filter(Boolean).sort().at(-1)
      return { items, sources, updatedAt, stale: !updatedAt || reference.getTime() - new Date(updatedAt).getTime() > 6 * 60 * 60 * 1000 }
    },
    saveWeeklyAnalysis(input) {
      const updatedAt = cleanText(input.updatedAt) || now()
      db.prepare(`INSERT INTO weekly_analyses (analyst_id, fingerprint, markdown, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(analyst_id, fingerprint) DO UPDATE SET markdown=excluded.markdown,updated_at=excluded.updated_at`).run(input.analystId, input.fingerprint, input.markdown, updatedAt)
      return { analystId: input.analystId, fingerprint: input.fingerprint, markdown: input.markdown, updatedAt }
    },
    listWeeklyAnalyses(fingerprint) {
      const rows = fingerprint ? db.prepare('SELECT * FROM weekly_analyses WHERE fingerprint=? ORDER BY updated_at DESC').all(fingerprint) : db.prepare('SELECT * FROM weekly_analyses ORDER BY updated_at DESC').all()
      return rows.map(row => ({ analystId: row.analyst_id, fingerprint: row.fingerprint, markdown: row.markdown, updatedAt: row.updated_at }))
    },
    exportBackup() {
      return { version: 1, exportedAt: now(), topics: api.listTopics().map(topic => ({ ...topic, workspace: api.getWorkspace(topic.id) })) }
    },
    restoreBackup(backup) {
      if (!backup || backup.version !== 1 || !Array.isArray(backup.topics)) throw new Error('备份文件格式不受支持')
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const item of backup.topics) {
          const existing = api.getTopic(item.id)
          if (existing) api.updateTopic(item.id, item)
          else api.createTopic(item)
          if (item.workspace) {
            api.updateWorkspace(item.id, item.workspace)
            for (const message of item.workspace.messages || []) {
              if (!db.prepare('SELECT id FROM messages WHERE id=?').get(message.id)) api.addMessage(item.id, message)
            }
          }
        }
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return { restored: true, topics: backup.topics.length }
    },
  }
  return api
}
