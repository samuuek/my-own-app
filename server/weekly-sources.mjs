import { createHash } from 'node:crypto'

export const WEEKLY_SOURCES = [
  { id: 'openai', organization: 'OpenAI', url: 'https://openai.com/news/', allowedHosts: ['openai.com'], category: '产品' },
  { id: 'anthropic', organization: 'Anthropic', url: 'https://www.anthropic.com/news', allowedHosts: ['anthropic.com'], category: '模型' },
  { id: 'deepmind', organization: 'Google DeepMind', url: 'https://deepmind.google/discover/blog/', allowedHosts: ['deepmind.google'], category: '研究' },
  { id: 'microsoft', organization: 'Microsoft', url: 'https://blogs.microsoft.com/', allowedHosts: ['blogs.microsoft.com'], category: '产品' },
  { id: 'meta', organization: 'Meta AI', url: 'https://ai.meta.com/blog/', allowedHosts: ['ai.meta.com'], category: '研究' },
  { id: 'huggingface', organization: 'Hugging Face', url: 'https://huggingface.co/blog', allowedHosts: ['huggingface.co'], category: '开源' },
]

const trustedHost = (host, allowed) => allowed.some(item => host === item || host.endsWith(`.${item}`))
const text = value => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()

function canonicalUrl(value) {
  const url = new URL(value)
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('utm_') || ['ref', 'source'].includes(key)) url.searchParams.delete(key)
  return url.toString()
}

export function normalizeWeeklyItems(source, entries, now = new Date()) {
  const latest = now.getTime()
  const earliest = latest - 7 * 24 * 60 * 60 * 1000
  const seen = new Set()
  const items = []
  for (const entry of entries) {
    try {
      const url = canonicalUrl(entry.url)
      const parsed = new URL(url)
      const published = new Date(entry.publishedAt).getTime()
      if (!entry.title || !Number.isFinite(published) || published > latest || published < earliest || parsed.protocol !== 'https:' || !trustedHost(parsed.hostname, source.allowedHosts) || seen.has(url)) continue
      seen.add(url)
      items.push({ id: createHash('sha256').update(url).digest('hex').slice(0, 24), sourceId: source.id, organization: source.organization, title: text(entry.title), url, publishedAt: new Date(published).toISOString(), category: entry.category || source.category, summary: text(entry.summary), significance: text(entry.significance) })
    } catch { /* invalid source entry is ignored */ }
  }
  return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

function parseJsonLd(body) {
  const entries = []
  for (const match of body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const decoded = JSON.parse(match[1])
      const nodes = Array.isArray(decoded) ? decoded : decoded['@graph'] || [decoded]
      for (const node of nodes) if (['BlogPosting', 'NewsArticle', 'Article'].includes(node['@type'])) entries.push({ title: node.headline || node.name, url: node.url || node.mainEntityOfPage?.['@id'], publishedAt: node.datePublished, summary: node.description })
    } catch { /* malformed JSON-LD is ignored */ }
  }
  return entries
}

function parseFeed(body) {
  const blocks = [...body.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(match => match[2])
  const value = (block, names) => { for (const name of names) { const match = block.match(new RegExp(`<${name}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${name}>`, 'i')); if (match) return text(match[1]) } return '' }
  return blocks.map(block => ({ title: value(block, ['title']), url: value(block, ['link']) || block.match(/<link[^>]+href=["']([^"']+)/i)?.[1], publishedAt: value(block, ['pubDate', 'published', 'updated']), summary: value(block, ['description', 'summary', 'content']) }))
}

function parseArticles(body, baseUrl) {
  return [...body.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(match => {
    const block = match[1]
    const href = block.match(/<a\b[^>]+href=["']([^"']+)["']/i)?.[1]
    const title = block.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1]
    const publishedAt = block.match(/<time\b[^>]+datetime=["']([^"']+)["']/i)?.[1]
    const summary = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]
    return { title: text(title), url: href ? new URL(href, baseUrl).toString() : '', publishedAt, summary: text(summary) }
  })
}

export async function fetchWeeklySource(source, { fetcher = fetch, now = new Date(), timeoutMs = 10_000, maxBytes = 2_000_000 } = {}) {
  const response = await fetcher(source.url, { headers: { Accept: 'application/rss+xml, application/atom+xml, text/html;q=0.9' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' })
  if (!response.ok) throw new Error(`${source.organization} 请求失败（${response.status || 'unknown'}）`)
  const finalUrl = new URL(response.url || source.url)
  if (finalUrl.protocol !== 'https:' || !trustedHost(finalUrl.hostname, source.allowedHosts)) throw new Error('来源域名不受信任')
  const declared = Number(response.headers?.get?.('content-length') || 0)
  if (declared > maxBytes) throw new Error('响应内容过大')
  const body = await response.text()
  if (body.length > maxBytes) throw new Error('响应内容过大')
  const entries = /<(rss|feed)\b/i.test(body) ? parseFeed(body) : [...parseJsonLd(body), ...parseArticles(body, finalUrl)]
  if (!entries.length) throw new Error('来源格式未识别')
  return normalizeWeeklyItems(source, entries, now)
}
