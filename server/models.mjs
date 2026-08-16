const registry = [
  { id: 'siyu-demo', name: '思屿演示模型', provider: '本地演示', demo: true },
  { id: 'doubao-pro', name: '豆包 Pro', provider: '豆包', key: 'DOUBAO_API_KEY', base: 'DOUBAO_BASE_URL', defaultBase: 'https://ark.cn-beijing.volces.com/api/v3', remoteModel: 'DOUBAO_MODEL' },
  { id: 'qwen-plus', name: '千问 Plus', provider: '千问', key: 'QWEN_API_KEY', base: 'QWEN_BASE_URL', defaultBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', remoteModel: 'QWEN_MODEL' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek', key: 'DEEPSEEK_API_KEY', base: 'DEEPSEEK_BASE_URL', defaultBase: 'https://api.deepseek.com', remoteModel: 'DEEPSEEK_MODEL' },
  { id: 'custom-model', name: '自定义模型', provider: '自定义 API', key: 'CUSTOM_API_KEY', base: 'CUSTOM_BASE_URL', defaultBase: '', remoteModel: 'CUSTOM_MODEL' },
]

export function publicModels(env) {
  return registry.map(model => ({ id: model.id, name: model.name, provider: model.provider, demo: Boolean(model.demo), available: Boolean(model.demo || env[model.key]) }))
}

export async function chatWithModel(request, env, fetcher = fetch) {
  const model = registry.find(item => item.id === request.model)
  if (!model) throw new Error('不支持的模型')
  if (model.demo) return '这是演示回复。你的消息已经安全保存在本机；配置模型 API Key 后，可以继续使用豆包、千问、DeepSeek 或自定义模型。'
  const apiKey = env[model.key]
  if (!apiKey) throw new Error(`${model.provider} 尚未配置 API Key`)
  const baseUrl = (env[model.base] || model.defaultBase).replace(/\/$/, '')
  if (!baseUrl) throw new Error('自定义 API 尚未配置 Base URL')
  const response = await fetcher(`${baseUrl}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: env[model.remoteModel] || model.id, messages: request.messages, stream: false }) })
  if (!response.ok) throw new Error(`${model.provider} 请求失败（${response.status}）`)
  const data = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error(`${model.provider} 未返回可读内容`)
  return content
}
