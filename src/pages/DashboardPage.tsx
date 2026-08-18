import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Check, Clock, ArrowRight, NotePencil, CalendarBlank, Plus, Barbell, ListPlus, Bug, ForkKnife, Timer, PencilSimple, Trash, ArrowUp, ArrowDown } from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { localDate, formatDate, classNames } from "../utils";
import { Badge, Button, EmptyState, ErrorState, PageHeader, Section, Skeleton } from "../components/ui";
import { ModuleArtwork, type ModuleArtworkName } from "../components/ModuleArtwork";
import { ProgressOverview } from "../features/workbench/ProgressOverview";
import { ImportantDatesPanel } from "../features/workbench/ImportantDatesPanel";
import { LongTermGoalsPanel } from "../features/workbench/LongTermGoalsPanel";
import { FocusTimerPanel } from "../features/workbench/FocusTimerPanel";
import { WorkbenchDialogs, type WorkbenchDialogState } from "../features/workbench/WorkbenchDialogs";
import { OnboardingModal } from "../features/workbench/OnboardingModal";
import type { CollectionName, Entity } from "../types";

const summaryMeta: Record<string, { title: string; route: string; module: ModuleArtworkName; empty: string }> = {
  media: { title: "自媒体", route: "/media", module: "media", empty: "暂无待发布内容" },
  development: { title: "开发工作", route: "/development", module: "development", empty: "暂无高优先级问题" },
  consulting: { title: "咨询工作", route: "/consulting", module: "consulting", empty: "暂无待跟进事项" },
  fitness: { title: "健身计划", route: "/fitness", module: "fitness", empty: "暂无近期训练" },
  diet: { title: "饮食计划", route: "/diet", module: "diet", empty: "今天还没有餐食记录" },
  entertainment: { title: "游戏娱乐", route: "/entertainment", module: "entertainment", empty: "暂无正在进行的游戏" },
};

export function DashboardPage() {
  const date = localDate();
  const dashboard = useQuery({ queryKey: ["dashboard", date], queryFn: () => api.dashboard(date) });
  const { data, registerSaveHandler, run } = useWorkspace();
  const navigate = useNavigate();
  const activeMemo = useMemo(() => data.quickMemos.find((item) => !item.archived_at && !item.converted_id), [data.quickMemos]);
  const [memo, setMemo] = useState(activeMemo?.content ?? "");
  const [memoId, setMemoId] = useState<string | null>(activeMemo?.id ?? null);
  const [savedMemo, setSavedMemo] = useState(activeMemo?.content ?? "");
  const [memoError, setMemoError] = useState("");
  const [workbenchDialog, setWorkbenchDialog] = useState<WorkbenchDialogState>(null);
  const memoInput = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (activeMemo && !memoId) { setMemo(activeMemo.content); setSavedMemo(activeMemo.content); setMemoId(activeMemo.id); }
  }, [activeMemo, memoId]);

  const persistMemo = useCallback(async () => {
    if (memo === savedMemo || (!memo.trim() && !memoId)) return;
    try {
      setMemoError("");
      if (memoId) await run(() => api.update("quickMemos", memoId, { content: memo }));
      else {
        const created = await run(() => api.create("quickMemos", { content: memo }));
        setMemoId(created.id);
      }
      setSavedMemo(memo);
    } catch (error) {
      setMemoError((error as Error).message);
      throw error;
    }
  }, [memo, memoId, run, savedMemo]);

  useEffect(() => {
    if (memo === savedMemo || (!memo.trim() && !memoId)) return;
    const timer = window.setTimeout(() => void persistMemo().catch(() => undefined), 700);
    return () => window.clearTimeout(timer);
  }, [memo, memoId, persistMemo, savedMemo]);

  useEffect(() => registerSaveHandler(persistMemo), [persistMemo, registerSaveHandler]);

  if (dashboard.isLoading) return <><PageHeader icon={<ModuleArtwork module="dashboard" />} eyebrow="今天" title="正在整理你的工作台" description="读取今天的计划和各模块状态" /><Skeleton lines={8} /></>;
  if (dashboard.error || !dashboard.data) return <ErrorState message={(dashboard.error as Error)?.message ?? "首页数据不可用"} onRetry={() => dashboard.refetch()} />;
  const value = dashboard.data;
  const importantDates = value.importantDates ?? [];
  const longTermGoals = value.longTermGoals ?? [];
  const timeline = value.timeline ?? [];
  const unscheduled = value.unscheduled ?? [];
  const allTodayItems = [...timeline, ...unscheduled];
  const activeFocusTimer = value.activeFocusTimer ?? null;
  const shouldOpenOnboarding = !["completed", "skipped"].includes(data.settings.progressWorkbenchOnboarding);
  const activeFocusTask = activeFocusTimer?.plan_item_id
    ? allTodayItems.find((item) => item.id === activeFocusTimer.plan_item_id) ?? data.planItems.find((item) => item.id === activeFocusTimer.plan_item_id)
    : null;

  const saveWorkbench = async (collection: Extract<CollectionName, "importantDates" | "longTermGoals" | "planItems">, item: Entity | null, values: Record<string, any>) => {
    const items = collection === "importantDates" ? importantDates : collection === "longTermGoals" ? longTermGoals : allTodayItems;
    const input = item ? values : { ...values, sort_order: items.length };
    await run(() => item ? api.update(collection, item.id, input) : api.create(collection, input));
  };

  const moveInList = async (collection: Extract<CollectionName, "importantDates" | "longTermGoals" | "planItems">, item: Entity, direction: -1 | 1, items: Entity[]) => {
    const index = items.findIndex((candidate) => candidate.id === item.id);
    const other = items[index + direction];
    if (index < 0 || !other) return;
    await run(() => Promise.all([
      api.update(collection, item.id, { sort_order: Number(other.sort_order ?? index + direction) }),
      api.update(collection, other.id, { sort_order: Number(item.sort_order ?? index) }),
    ]));
  };

  const startFocus = async (item: Entity) => {
    const requestedMinutes = Number(item.estimated_minutes);
    const plannedMinutes = Number.isFinite(requestedMinutes) && requestedMinutes >= 1 && requestedMinutes <= 480 ? Math.round(requestedMinutes) : 25;
    await run(() => api.startFocusTimer({ planItemId: item.id, plannedMinutes }));
  };
  return (
    <div className="dashboard-page">
      <PageHeader icon={<ModuleArtwork module="dashboard" />} eyebrow={new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(new Date())} title={`${new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date())}，从重点开始`} description="今天的行动、提醒和工作生活状态都在这里。" actions={<Button onClick={() => navigate("/today?new=1")}><Plus size={17} />添加今日事项</Button>} />
      <ProgressOverview date={value.date ?? date} overview={value.overview} onAddTask={() => navigate("/today?new=1")} />
      <nav className="dashboard-command-strip glass-clear" aria-label="快速操作">
        <span>快速操作</span>
        <button onClick={() => navigate("/today?new=1")}><ListPlus size={17} />新建计划</button>
        <button onClick={() => memoInput.current?.focus()}><NotePencil size={17} />记录备忘</button>
        <button onClick={() => navigate("/development?new=work-item")}><Bug size={17} />添加工作项</button>
        <button onClick={() => navigate("/fitness?new=workout")}><Barbell size={17} />记录训练</button>
        <button onClick={() => navigate("/diet?new=meal")}><ForkKnife size={17} />记录饮食</button>
      </nav>
      <div className="workbench-pair">
        <ImportantDatesPanel
          items={importantDates}
          error={value.sectionErrors?.importantDates ?? null}
          onRetry={() => void dashboard.refetch()}
          onAdd={() => setWorkbenchDialog({ type: "importantDate", item: null })}
          onEdit={(item) => setWorkbenchDialog({ type: "importantDate", item })}
          onDelete={(item) => setWorkbenchDialog({ type: "delete", collection: "importantDates", item })}
          onMove={(item, direction) => void moveInList("importantDates", item, direction, importantDates)}
        />
        <LongTermGoalsPanel
          items={longTermGoals}
          error={value.sectionErrors?.longTermGoals ?? null}
          onRetry={() => void dashboard.refetch()}
          onAdd={() => setWorkbenchDialog({ type: "longTermGoal", item: null })}
          onEdit={(item) => setWorkbenchDialog({ type: "longTermGoal", item })}
          onDelete={(item) => setWorkbenchDialog({ type: "delete", collection: "longTermGoals", item })}
          onMove={(item, direction) => void moveInList("longTermGoals", item, direction, longTermGoals)}
        />
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-primary">
          <Section title="今日时间线" description="有明确开始时间的事项" action={<Button variant="ghost" size="sm" onClick={() => navigate("/today")}>打开计划<ArrowRight size={15} /></Button>}>
            {timeline.length ? <div className="timeline-list">{timeline.map((item, index) => <PlanRow key={item.id} item={item} onComplete={() => run(() => api.completePlan(item.id))} onOpenSource={item.source_module ? () => navigate(sourceRoutes[item.source_module] ?? "/today") : undefined} onEdit={() => setWorkbenchDialog({ type: "planItem", item })} onDelete={() => setWorkbenchDialog({ type: "delete", collection: "planItems", item })} onMove={(direction) => void moveInList("planItems", item, direction, timeline)} canMoveUp={index > 0} canMoveDown={index < timeline.length - 1} onStartFocus={() => void startFocus(item)} />)}</div> : <EmptyState title="今天还没有时间安排" description="把最重要的一件事放进时间线。" action={<Button variant="secondary" size="sm" onClick={() => navigate("/today?new=1")}>添加事项</Button>} />}
          </Section>
          <Section title="待安排" description="属于今天，但还没有具体时间">
            {unscheduled.length ? <div className="plain-list">{unscheduled.map((item, index) => <PlanRow key={item.id} item={item} onComplete={() => run(() => api.completePlan(item.id))} onOpenSource={item.source_module ? () => navigate(sourceRoutes[item.source_module] ?? "/today") : undefined} onEdit={() => setWorkbenchDialog({ type: "planItem", item })} onDelete={() => setWorkbenchDialog({ type: "delete", collection: "planItems", item })} onMove={(direction) => void moveInList("planItems", item, direction, unscheduled)} canMoveUp={index > 0} canMoveDown={index < unscheduled.length - 1} onStartFocus={() => void startFocus(item)} />)}</div> : <p className="quiet-line">所有今日事项都已经安排妥当。</p>}
          </Section>
        </div>
        <aside className="dashboard-aside">
          <FocusTimerPanel timer={activeFocusTimer} taskTitle={activeFocusTask?.display_title || activeFocusTask?.title || null} error={value.sectionErrors?.focusTimer ?? null} onRetry={() => void dashboard.refetch()} onPause={() => { if (activeFocusTimer) void run(() => api.pauseFocusTimer(activeFocusTimer.id)); }} onResume={() => { if (activeFocusTimer) void run(() => api.resumeFocusTimer(activeFocusTimer.id)); }} onFinish={() => { if (activeFocusTimer) void run(() => api.finishFocusTimer(activeFocusTimer.id)); }} />
          <Section title="快速备忘" description="停顿后自动保存" className="memo-section">
            <div className="memo-pad"><NotePencil size={19} /><textarea ref={memoInput} aria-label="快速备忘" value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="记下一闪而过的想法……" />{memoError ? <small className="field-error">{memoError}</small> : null}</div>
            {memoId ? <div className="memo-actions"><Button size="sm" variant="ghost" onClick={async () => { await run(() => api.convertMemo(memoId, "planItems", { plan_date: date })); setMemo(""); setSavedMemo(""); setMemoId(null); }}>转为今日事项</Button><Button size="sm" variant="ghost" onClick={async () => { await run(() => api.convertMemo(memoId, "mediaContents", { stage: "idea" })); setMemo(""); setSavedMemo(""); setMemoId(null); }}>转为内容灵感</Button></div> : null}
          </Section>
          <Section title="需要关注" description="到期、跟进与今日提醒">
            {value.attention.length ? <div className="attention-list">{value.attention.map((item) => <button key={`${item.attention_type}-${item.id}`} onClick={() => navigate(item.module === "today" ? "/today" : `/${item.module}`)}><span className="attention-mark" /><div><strong>{item.display_title || item.title || item.name || item.content}</strong><small>{item.due_date ? `截止 ${formatDate(item.due_date)}` : item.followup_at ? `跟进 ${formatDate(item.followup_at)}` : "需要处理"}</small></div><ArrowRight size={16} /></button>)}</div> : <p className="quiet-line">目前没有紧急事项。</p>}
          </Section>
        </aside>
      </div>
      <Section title="各模块摘要" description="只展示近期真正需要留意的内容">
        <div className="summary-grid">{Object.entries(summaryMeta).filter(([key]) => !Array.isArray(data.settings.dashboardModules) || data.settings.dashboardModules.includes(key)).map(([key, meta]) => {
          const items = value.summaries[key] ?? [];
          return <button className="summary-tile" data-module={key} key={key} onClick={() => navigate(meta.route)}><div className="summary-top"><ModuleArtwork module={meta.module} loading="lazy" /><span>{meta.title}</span><ArrowRight size={16} /></div>{items.length ? <><strong>{items[0].title || items[0].name || items[0].content}</strong><small>{items.length > 1 ? `另外还有 ${items.length - 1} 项` : "查看详情"}</small></> : <small>{meta.empty}</small>}</button>;
        })}</div>
      </Section>
      <WorkbenchDialogs state={workbenchDialog} onClose={() => setWorkbenchDialog(null)} onSave={saveWorkbench} onDelete={async (collection, item) => { await run(() => api.remove(collection, item.id)); }} />
      <OnboardingModal
        open={shouldOpenOnboarding}
        onSkip={async () => { await run(() => api.saveSettings({ progressWorkbenchOnboarding: "skipped" })); }}
        onComplete={async () => { await run(() => api.saveSettings({ progressWorkbenchOnboarding: "completed" })); }}
        onCreateImportantDate={async (input) => { await run(() => api.create("importantDates", { ...input, sort_order: importantDates.length })); }}
        onCreateGoal={async (input) => { await run(() => api.create("longTermGoals", { ...input, sort_order: longTermGoals.length })); }}
      />
    </div>
  );
}

const sourceRoutes: Record<string, string> = { media: "/media", development: "/development", consulting: "/consulting", fitness: "/fitness", diet: "/diet", entertainment: "/entertainment" };

function PlanRow({ item, onComplete, onOpenSource, onEdit, onDelete, onMove, canMoveUp, canMoveDown, onStartFocus }: { item: Record<string, any>; onComplete: () => Promise<any>; onOpenSource?: () => void; onEdit: () => void; onDelete: () => void; onMove: (direction: -1 | 1) => void; canMoveUp: boolean; canMoveDown: boolean; onStartFocus: () => void }) {
  const done = item.status === "done";
  const title = item.display_title || item.title;
  return <div className={classNames("plan-row", done && "is-done")}><button className="complete-control" aria-label={done ? "已完成" : `标记完成${title}`} disabled={done} onClick={() => void onComplete()}>{done ? <Check size={14} weight="bold" /> : null}</button>{item.start_time ? <span className="plan-time"><Clock size={14} />{item.start_time}</span> : <span className="plan-time"><CalendarBlank size={14} />待安排</span>}<div className="plan-copy"><strong>{title}</strong>{item.notes ? <small>{item.notes}</small> : null}{onOpenSource ? <button className="text-button source-link" onClick={onOpenSource}>打开来源 <ArrowRight size={13} /></button> : null}</div><Badge tone={item.priority === "high" ? "warning" : "neutral"}>{item.priority === "high" ? "高优先" : item.estimated_minutes ? `${item.estimated_minutes} 分钟` : "普通"}</Badge>{!done ? <div className="plan-row-actions"><button aria-label={`开始专注${title}`} onClick={onStartFocus}><Timer /></button><button aria-label={`上移${title}`} disabled={!canMoveUp} onClick={() => onMove(-1)}><ArrowUp /></button><button aria-label={`下移${title}`} disabled={!canMoveDown} onClick={() => onMove(1)}><ArrowDown /></button><button aria-label={`编辑${title}`} onClick={onEdit}><PencilSimple /></button><button aria-label={`删除${title}`} onClick={onDelete}><Trash /></button></div> : null}</div>;
}
