export type Topic={id:string;kind:'热点'|'为你推荐'|'随机思想';title:string;summary:string;reason:string;source:string;color:string;status?:string;createdAt?:string;updatedAt?:string}
export const topics:Topic[]=[
 {id:'ai-memory',kind:'热点',title:'当 AI 开始替我们记忆，我们会失去什么？',summary:'从便利、认知外包与个人叙事三个角度，重新审视人与记忆工具的关系。',reason:'与你近期关注的 AI 与独立思考相关',source:'2 个来源 · 更新于今天 08:30',color:'blue'},
 {id:'slow-thinking',kind:'为你推荐',title:'什么样的慢，反而能让思考更快？',summary:'讨论信息密度、留白与深度判断之间的关系，并形成可实践的方法。',reason:'延续你尚未解决的「信息过载」议题',source:'基于已授权的议题摘要',color:'green'},
 {id:'certainty',kind:'随机思想',title:'如果答案不再稀缺，我们还需要追求确定吗？',summary:'从学习、选择与创造三个场景，探索“不确定”是否也是一种能力。',reason:'随机思想题 · 近 30 天未出现相似主题',source:'思想题库 · 今日抽取',color:'amber'}]
