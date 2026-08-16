import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { fallbackModels } from '../models/model-api'
import { WorkspaceView } from './WorkspaceView'

const addMessage = vi.fn()
vi.mock('../../lib/backend-api', () => ({
  fetchWorkspace: vi.fn().mockResolvedValue({ topicId: 'topic-1', note: '', reflection: '', resources: '', summary: '', mindMap: '', selectedModel: 'siyu-demo', updatedAt: '', messages: [] }),
  updateWorkspace: vi.fn().mockResolvedValue({}),
  addMessage: (...args: unknown[]) => addMessage(...args),
}))
vi.mock('../../lib/storage', () => ({ loadWorkspace: () => ({}) }))

const topic = { id: 'topic-1', kind: '随机思想', title: '是否继续追求确定性？', summary: '', reason: '', source: '', color: 'green' as const }

beforeEach(() => {
  vi.restoreAllMocks()
  addMessage.mockReset()
  addMessage.mockImplementation(async (_topicId, input) => ({ ...input, createdAt: '2026-08-15T00:00:00.000Z' }))
})

test('copies the question, opens DeepSeek, and waits for the answer', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, readText: vi.fn() } })
  const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
  render(<WorkspaceView topic={topic} models={fallbackModels} onBack={() => {}} />)
  await waitFor(() => expect(screen.getByLabelText('选择对话模型')).toHaveValue('siyu-demo'))

  await user.selectOptions(screen.getByLabelText('选择对话模型'), 'deepseek-web')
  await user.type(screen.getByLabelText('对话内容'), '请反驳我的结论')
  await user.click(screen.getByRole('button', { name: '打开并提问' }))

  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('请反驳我的结论'))
  expect(open).toHaveBeenCalledWith('https://chat.deepseek.com/', '_blank', 'noopener,noreferrer')
  expect(screen.getByText('问题已复制。获得回答后，回到这里继续。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '粘贴 DeepSeek 回答' })).toBeInTheDocument()
})

test('previews, edits, and saves a copied DeepSeek answer', async () => {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockResolvedValue('  一个可编辑的回答  ') } })
  vi.spyOn(window, 'open').mockReturnValue({} as Window)
  render(<WorkspaceView topic={topic} models={fallbackModels} onBack={() => {}} />)
  await waitFor(() => expect(screen.getByLabelText('选择对话模型')).toHaveValue('siyu-demo'))
  await user.selectOptions(screen.getByLabelText('选择对话模型'), 'deepseek-web')
  await user.type(screen.getByLabelText('对话内容'), '我的问题')
  await user.click(screen.getByRole('button', { name: '打开并提问' }))
  await user.click(screen.getByRole('button', { name: '粘贴 DeepSeek 回答' }))

  const preview = screen.getByRole('textbox', { name: 'DeepSeek 回答预览' })
  expect(preview).toHaveValue('一个可编辑的回答')
  await user.clear(preview)
  await user.type(preview, '编辑后的回答')
  await user.click(screen.getByRole('button', { name: '保存为 AI 回复' }))

  expect(await screen.findByText('编辑后的回答')).toBeInTheDocument()
  expect(addMessage).toHaveBeenCalledWith('topic-1', expect.objectContaining({ role: 'assistant', content: '编辑后的回答', modelId: 'deepseek-web' }))
})

test('falls back to manual paste when clipboard reading is denied', async () => {
  const user = userEvent.setup()
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined), readText: vi.fn().mockRejectedValue(new Error('denied')) } })
  vi.spyOn(window, 'open').mockReturnValue({} as Window)
  render(<WorkspaceView topic={topic} models={fallbackModels} onBack={() => {}} />)
  await waitFor(() => expect(screen.getByLabelText('选择对话模型')).toHaveValue('siyu-demo'))
  await user.selectOptions(screen.getByLabelText('选择对话模型'), 'deepseek-web')
  await user.type(screen.getByLabelText('对话内容'), '我的问题')
  await user.click(screen.getByRole('button', { name: '打开并提问' }))
  await user.click(screen.getByRole('button', { name: '粘贴 DeepSeek 回答' }))

  expect(screen.getByText('浏览器没有允许读取剪贴板，请在这里手动粘贴。')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'DeepSeek 回答预览' })).toHaveValue('')
})
