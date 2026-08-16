import { describe, expect, test } from 'vitest'
import { buildWebPrompt, validateImportedAnswer } from './web-handoff'

describe('DeepSeek 网页往返', () => {
  test('只带议题、最近十条消息和本次问题', () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `历史 ${index + 1}`,
    }))
    const prompt = buildWebPrompt({ topicTitle: '是否继续追求确定性？', messages, question: '请挑战我的判断' })

    expect(prompt).not.toContain('历史 1\n')
    expect(prompt).not.toContain('历史 2\n')
    expect(prompt).toContain('历史 3')
    expect(prompt).toContain('历史 12')
    expect(prompt.match(/请挑战我的判断/g)).toHaveLength(1)
    expect(prompt).toContain('是否继续追求确定性？')
  })

  test('拒绝空回答和超过本地消息上限的回答', () => {
    expect(validateImportedAnswer('  ')).toEqual({ ok: false, error: '请先粘贴 DeepSeek 的回答' })
    expect(validateImportedAnswer('a'.repeat(200_001))).toEqual({ ok: false, error: '回答不能超过 200000 个字' })
    expect(validateImportedAnswer('  可保存  ')).toEqual({ ok: true, value: '可保存' })
  })
})
