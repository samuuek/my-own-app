import { expect, test } from 'vitest'
import { fetchWeeklySource, normalizeWeeklyItems } from './weekly-sources.mjs'

const source = { id: 'openai', organization: 'OpenAI', url: 'https://openai.com/news/', allowedHosts: ['openai.com'], category: '产品' }

test('keeps the last seven days, drops future items, and deduplicates canonical URLs', () => {
  const entries = [
    { title: 'A', url: 'https://openai.com/index/a/?utm_source=x', publishedAt: '2026-08-15T03:00:00Z', summary: 'one' },
    { title: 'A copy', url: 'https://openai.com/index/a/', publishedAt: '2026-08-15T03:00:00Z', summary: 'two' },
    { title: 'old', url: 'https://openai.com/index/old/', publishedAt: '2026-08-07T00:00:00Z', summary: '' },
    { title: 'future', url: 'https://openai.com/index/future/', publishedAt: '2026-08-17T00:00:00Z', summary: '' },
  ]
  const result = normalizeWeeklyItems(source, entries, new Date('2026-08-16T12:00:00+08:00'))
  expect(result).toHaveLength(1)
  expect(result[0].url).toBe('https://openai.com/index/a/')
  expect(result[0].organization).toBe('OpenAI')
})

test('rejects redirects outside the source allowlist', async () => {
  await expect(fetchWeeklySource(source, { fetcher: async () => ({ ok: true, url: 'https://evil.example/feed', headers: new Headers(), text: async () => '<html></html>' }) })).rejects.toThrow('来源域名不受信任')
})

test('parses JSON-LD official articles', async () => {
  const body = `<script type="application/ld+json">{"@type":"BlogPosting","headline":"New model","datePublished":"2026-08-15T00:00:00Z","url":"https://openai.com/index/new-model/","description":"Official summary"}</script>`
  const items = await fetchWeeklySource(source, { now: new Date('2026-08-16T00:00:00Z'), fetcher: async () => ({ ok: true, url: source.url, headers: new Headers({ 'content-type': 'text/html' }), text: async () => body }) })
  expect(items[0].title).toBe('New model')
  expect(items[0].summary).toBe('Official summary')
})

test('parses semantic article cards from official HTML pages', async () => {
  const body = `<article><a href="/index/card-model/"><h2>Card model</h2></a><time datetime="2026-08-14T00:00:00Z">August 14</time><p>Card summary</p></article>`
  const items = await fetchWeeklySource(source, { now: new Date('2026-08-16T00:00:00Z'), fetcher: async () => ({ ok: true, url: source.url, headers: new Headers({ 'content-type': 'text/html' }), text: async () => body }) })
  expect(items[0].title).toBe('Card model')
  expect(items[0].url).toBe('https://openai.com/index/card-model/')
  expect(items[0].summary).toBe('Card summary')
})
