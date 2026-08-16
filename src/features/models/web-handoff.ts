export const DEEPSEEK_WEB_ID = 'deepseek-web'
export const DEEPSEEK_WEB_URL = 'https://chat.deepseek.com/'
export const MAX_IMPORTED_ANSWER_LENGTH = 200_000

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export function buildWebPrompt({ topicTitle, messages, question }: { topicTitle: string; messages: ChatMessage[]; question: string }) {
  const history = messages.filter(message => message.content.trim()).slice(-10)
  const lines = history.map(message => `${message.role === 'user' ? '我' : '对话助手'}：${message.content.trim()}`)
  return [`议题：${topicTitle.trim()}`, '', '此前对话：', ...lines, '', `我的新问题：${question.trim()}`, '', '请直接回应这个问题，并指出我可能忽略的前提或反例。'].join('\n')
}

export function validateImportedAnswer(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return { ok: false as const, error: '请先粘贴 DeepSeek 的回答' }
  if (trimmed.length > MAX_IMPORTED_ANSWER_LENGTH) return { ok: false as const, error: '回答不能超过 200000 个字' }
  return { ok: true as const, value: trimmed }
}
