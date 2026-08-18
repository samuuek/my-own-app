import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle, Lightbulb, Plus, Trash } from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { localDate, formatDate } from "../utils";
import { Badge, Button, EntityForm, Modal, PageHeader, Section } from "../components/ui";
import { ModuleArtwork } from "../components/ModuleArtwork";
import type { Entity } from "../types";

const sources = [
  { value: "work", label: "工作" }, { value: "life", label: "生活" }, { value: "reading", label: "读书" },
  { value: "conversation", label: "对话" }, { value: "event", label: "事件" }, { value: "inspiration", label: "灵感" }, { value: "other", label: "其他" },
];
const sourceLabel = Object.fromEntries(sources.map((item) => [item.value, item.label]));

export function ReflectionPage() {
  const { data, run, registerSaveHandler } = useWorkspace();
  const today = localDate();
  const [date, setDate] = useState(today);
  const current = data.dailyReflections.find((item) => item.reflection_date === date);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [actions, setActions] = useState<Entity[]>([]);
  const [newAction, setNewAction] = useState("");
  const [note, setNote] = useState<Entity | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");

  useEffect(() => {
    setDraft({ reflection_date: date, source_category: current?.source_category || "work", source_detail: current?.source_detail || "", work_summary: current?.work_summary || "", life_summary: current?.life_summary || "", gains: current?.gains || "", problems: current?.problems || "", improvements: current?.improvements || "" });
    setActions(data.reflectionActions.filter((item) => item.reflection_id === current?.id));
  }, [current, date, data.reflectionActions]);

  const save = useCallback(async () => { await run(() => api.saveDailyReflection({ ...draft, reflection_date: date, actions: actions.map(({ id, content }) => ({ id, content })) })); }, [actions, date, draft, run]);
  useEffect(() => registerSaveHandler(save), [registerSaveHandler, save]);
  const fields = ["source_detail", "work_summary", "life_summary", "gains", "problems", "improvements"];
  const completion = Math.round(([draft.source_category, ...fields.map((field) => draft[field])].filter((value) => String(value || "").trim()).length / 7) * 100);
  const notes = useMemo(() => data.thoughtNotes.filter((item) => (source === "all" || item.source_category === source) && (!query.trim() || `${item.title} ${item.source_detail} ${item.content}`.toLowerCase().includes(query.trim().toLowerCase()))), [data.thoughtNotes, query, source]);
  const history = [...data.dailyReflections].sort((a, b) => String(b.reflection_date).localeCompare(String(a.reflection_date)));

  return <>
    <PageHeader icon={<ModuleArtwork module="reflection" />} eyebrow="复盘与沉淀" title="思考" description="每天总结工作与生活，把经历转化为下一步行动。" actions={<Button onClick={() => setNote(null)}><Plus size={17} />记录自由思考</Button>} />
    <div className="reflection-overview"><article><strong>{formatDate(date)}</strong><span>当前复盘日期</span></article><article><strong>{completion}%</strong><span>复盘完成度</span></article><article><strong>{actions.length}</strong><span>明日行动</span></article><article><strong>{data.thoughtNotes.filter((item) => item.note_date === date).length}</strong><span>当天思考</span></article></div>
    <Section title="今日主复盘" description="每天一份，可以随时回来补充" action={<div className="reflection-date-actions"><input aria-label="复盘日期" type="date" value={date} onChange={(event) => setDate(event.target.value)} /><Button size="sm" onClick={() => void save()}>保存复盘</Button></div>}>
      <div className="reflection-form">
        <label><span>思考来源</span><select aria-label="思考来源" value={draft.source_category || "work"} onChange={(event) => setDraft({ ...draft, source_category: event.target.value })}>{sources.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label><span>具体来源</span><input aria-label="具体来源" value={draft.source_detail || ""} onChange={(event) => setDraft({ ...draft, source_detail: event.target.value })} placeholder="哪件事、哪本书或哪次对话触发了思考" /></label>
        {[{ key: "work_summary", label: "今日工作总结", hint: "完成了什么，哪些事情值得记录？" }, { key: "life_summary", label: "今日生活总结", hint: "身体、关系、家庭或日常状态如何？" }, { key: "gains", label: "今日收获", hint: "哪些方法和认识值得保留？" }, { key: "problems", label: "问题与原因", hint: "哪里不顺，背后的原因是什么？" }, { key: "improvements", label: "可以改进", hint: "下一次准备做出什么调整？" }].map((field) => <label className="wide" key={field.key}><span>{field.label}</span><textarea aria-label={field.label} rows={3} value={draft[field.key] || ""} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} placeholder={field.hint} /></label>)}
      </div>
      <div className="reflection-actions"><h3>明日行动</h3>{actions.map((item, index) => <div key={item.id || index}><span>{item.content}</span>{item.plan_item_id ? <Badge tone="success"><CheckCircle size={13} />已加入计划</Badge> : item.id ? <Button size="sm" variant="secondary" onClick={() => void run(() => api.addReflectionActionToPlan(item.id))}>加入计划</Button> : <Badge>保存后可加入计划</Badge>}<button aria-label={`删除行动 ${item.content}`} onClick={() => setActions(actions.filter((_, actionIndex) => actionIndex !== index))}><Trash size={15} /></button></div>)}<div className="reflection-action-input"><input aria-label="新的明日行动" value={newAction} onChange={(event) => setNewAction(event.target.value)} placeholder="写下一件明天要做的事" /><Button size="sm" variant="secondary" onClick={() => { if (!newAction.trim()) return; setActions([...actions, { id: "", content: newAction.trim() }]); setNewAction(""); }}><Plus size={15} />添加</Button></div></div>
    </Section>
    <div className="reflection-lower">
      <Section title="自由思考" description="不限数量，记录随时出现的想法" action={<Button size="sm" variant="secondary" onClick={() => setNote(null)}><Plus size={15} />添加笔记</Button>}><div className="thought-toolbar"><input aria-label="搜索历史思考" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、来源或正文" /><select aria-label="筛选思考来源" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">全部来源</option>{sources.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div><div className="thought-list">{notes.map((item) => <article key={item.id}><header><div><Badge>{sourceLabel[item.source_category] || "其他"}</Badge><strong>{item.title}</strong></div><span>{formatDate(item.note_date)}</span></header><small>{item.source_detail || "未填写具体来源"}</small><p>{item.content}</p><footer><Button size="sm" variant="ghost" onClick={() => setNote(item)}>编辑</Button><Button size="sm" variant="ghost" onClick={() => void run(() => api.remove("thoughtNotes", item.id))}>删除</Button></footer></article>)}</div></Section>
      <Section title="历史回顾" description="切换日期查看过去的主复盘"><div className="reflection-history">{history.map((item) => <button key={item.id} onClick={() => setDate(item.reflection_date)} className={date === item.reflection_date ? "active" : ""}><Lightbulb size={18} /><span><strong>{formatDate(item.reflection_date)}</strong><small>{sourceLabel[item.source_category]} · {item.gains || item.work_summary || "继续补充这天的复盘"}</small></span></button>)}</div></Section>
    </div>
    {note !== undefined ? <ThoughtDialog note={note} date={date} close={() => setNote(undefined)} run={run} /> : null}
  </>;
}

function ThoughtDialog({ note, date, close, run }: { note: Entity | null; date: string; close: () => void; run: any }) {
  return <Modal open title={note ? "编辑自由思考" : "记录自由思考"} description="记录此刻最值得留下的想法。" onClose={close} wide><EntityForm fields={[{ name: "note_date", label: "记录日期", type: "date", required: true }, { name: "title", label: "标题", required: true }, { name: "source_category", label: "思考来源", type: "select", required: true, options: sources }, { name: "source_detail", label: "具体来源" }, { name: "content", label: "思考正文", type: "textarea", required: true }]} initial={{ note_date: date, source_category: "inspiration", ...note }} onCancel={close} onSubmit={async (values) => { if (note) await run(() => api.update("thoughtNotes", note.id, values)); else await run(() => api.create("thoughtNotes", values)); close(); }} /></Modal>;
}
