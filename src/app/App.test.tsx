import { render, screen, within } from '@testing-library/react'
import { test, expect } from 'vitest'
import userEvent from '@testing-library/user-event'
import { App } from './App'
test('renders the thinking workspace home', () => {
  render(<App />)
  expect(screen.getByText('思屿')).toBeInTheDocument()
  expect(screen.getByRole('navigation')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '今天，想聊点什么？' })).toBeInTheDocument()
})

test('switches between all primary navigation views', async () => {
  const user = userEvent.setup()
  render(<App />)
  const navigation = within(screen.getByRole('navigation', { name: '主导航' }))

  await user.click(navigation.getByRole('link', { name: '思考空间' }))
  expect(screen.getByRole('heading', { name: '所有思考，都有迹可循' })).toBeInTheDocument()

  await user.click(navigation.getByRole('link', { name: '知识库' }))
  expect(screen.getByRole('heading', { name: '你的思想，正在形成自己的脉络' })).toBeInTheDocument()

  await user.click(navigation.getByRole('link', { name: '回顾' }))
  expect(screen.getByRole('heading', { name: '回到那些值得再想一次的地方' })).toBeInTheDocument()

  await user.click(navigation.getByRole('link', { name: '今日' }))
  expect(screen.getByRole('heading', { name: '今天，想聊点什么？' })).toBeInTheDocument()
})

test('restores the current view from the URL hash after refresh', () => {
  window.history.replaceState(null, '', '#library')
  render(<App />)
  expect(screen.getByRole('heading', { name: '你的思想，正在形成自己的脉络' })).toBeInTheDocument()
})

test('opens conversation services with free DeepSeek first and API settings collapsed', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: '对话服务' }))
  expect(screen.getByRole('heading', { name: '对话服务' })).toBeInTheDocument()
  expect(screen.getByText('登录自己的账号即可免费使用')).toBeInTheDocument()
  expect(screen.getByText('网页版可用')).toBeInTheDocument()
  expect(screen.queryByText('已连接')).not.toBeInTheDocument()
  expect(screen.getByText('API 高级配置').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText(/不会获取 DeepSeek 账号、密码或登录状态/)).toBeInTheDocument()
})

test('opens the weekly AI page and restores it from the hash', async () => {
  window.history.replaceState(null, '', '#weekly')
  render(<App />)
  expect(await screen.findByRole('heading', { name: '这一周，AI 又向前走了哪里？' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'AI 周报' })).toHaveAttribute('aria-current', 'page')
})
