import { useEffect, useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  House, CalendarCheck, Broadcast, Code, ChatCenteredText, Barbell, BowlFood, GameController,
  Database, MagnifyingGlass, Plus, FloppyDisk, CheckCircle, WarningCircle, SidebarSimple,
  ArrowRight, Command,
} from "@phosphor-icons/react";
import { api } from "../api";
import { useWorkspace } from "../WorkspaceContext";
import { formatDateTime, classNames } from "../utils";
import { Button, IconButton, Modal, Skeleton, ErrorState, Badge } from "./ui";
import type { Entity } from "../types";

const groups = [
  { label: "日常", links: [
    { to: "/", label: "首页总览", icon: House },
    { to: "/today", label: "今日计划", icon: CalendarCheck },
  ] },
  { label: "工作", links: [
    { to: "/media", label: "自媒体", icon: Broadcast },
    { to: "/development", label: "开发工作", icon: Code },
    { to: "/consulting", label: "咨询工作", icon: ChatCenteredText },
  ] },
  { label: "生活", links: [
    { to: "/fitness", label: "健身计划", icon: Barbell },
    { to: "/diet", label: "饮食计划", icon: BowlFood },
    { to: "/entertainment", label: "游戏娱乐", icon: GameController },
  ] },
  { label: "系统", links: [{ to: "/settings", label: "数据与设置", icon: Database }] },
];

const collectionRoutes: Record<string, string> = {
  planItems: "/today", mediaContents: "/media", devProjects: "/development", devMilestones: "/development",
  devWorkItems: "/development", devLogs: "/development", clients: "/consulting", consultingProjects: "/consulting",
  consultingInteractions: "/consulting", consultingDeliverables: "/consulting", consultingFollowups: "/consulting",
  consultingTimeEntries: "/consulting", workoutTemplates: "/fitness", workouts: "/fitness", bodyMetrics: "/fitness",
  nutritionTargets: "/diet", foods: "/diet", meals: "/diet", mealItems: "/diet", entertainmentItems: "/entertainment",
  playSessions: "/entertainment", quickMemos: "/",
};

const routeMeta: Record<string, { label: string; module: string }> = {
  "/": { label: "首页总览", module: "dashboard" },
  "/today": { label: "今日计划", module: "today" },
  "/media": { label: "自媒体", module: "media" },
  "/development": { label: "开发工作", module: "development" },
  "/consulting": { label: "咨询工作", module: "consulting" },
  "/fitness": { label: "健身计划", module: "fitness" },
  "/diet": { label: "饮食计划", module: "diet" },
  "/entertainment": { label: "游戏娱乐", module: "entertainment" },
  "/settings": { label: "数据与设置", module: "settings" },
};

export function AppLayout() {
  const { data, saveNow, saveStatus } = useWorkspace();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const system = useQuery({ queryKey: ["system"], queryFn: api.systemStatus, staleTime: 30_000 });
  const currentPage = routeMeta[location.pathname] ?? routeMeta["/"];

  useEffect(() => {
    const theme = data.settings.theme ?? "light";
    document.documentElement.dataset.theme = theme;
  }, [data.settings.theme]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // 环境层视差：滚动时让背景以极低速率位移，玻璃背后才有东西可折射。
  // 只写一个 CSS 变量并由合成层处理，不触发 React 重渲染。
  useEffect(() => {
    const root = document.documentElement;
    // 视差是纯增强。任何一个依赖的浏览器 API 缺席都必须静默降级，
    // 绝不能让整个应用外壳挂掉。
    if (typeof window.requestAnimationFrame !== "function") return;
    const motion = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    let frame = 0;
    const apply = () => {
      frame = 0;
      // 夹在 ±110px：环境层只向外扩了 14%，位移超过这个量长页面底部会露边。
      root.style.setProperty("--ambient-shift", String(Math.max(-110, Math.min(0, Math.round(window.scrollY * -0.04)))));
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(apply); };
    const sync = () => {
      window.removeEventListener("scroll", onScroll);
      if (motion?.matches) { root.style.setProperty("--ambient-shift", "0"); return; }
      window.addEventListener("scroll", onScroll, { passive: true });
      apply();
    };
    sync();
    motion?.addEventListener("change", sync);
    return () => {
      motion?.removeEventListener("change", sync);
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className={classNames("app-shell", collapsed && "sidebar-collapsed")} data-module={currentPage.module}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className="sidebar glass-regular">
        <div className="brand"><div className="brand-mark">木</div><div className="brand-copy"><strong>木子工作台</strong><span>本地个人空间</span></div></div>
        <Button className="quick-create" onClick={() => setQuickOpen(true)}><Plus size={18} />快速新增</Button>
        <nav aria-label="主导航">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-label">{group.label}</span>
              {group.links.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => classNames("nav-link", isActive && "active")} title={label}>
                  <Icon size={17} weight="regular" /><span>{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className={classNames("local-state", system.data?.backupStatus?.state === "error" && "backup-error")}><span className="status-dot" /><div><strong>{system.data?.backupStatus?.state === "error" ? "自动备份失败" : "仅保存在这台电脑"}</strong><small>{system.data?.backupStatus?.state === "error" ? system.data.backupStatus.lastError : system.data?.latestBackup ? `备份于 ${formatDateTime(system.data.latestBackup.createdAt)}` : "等待首次备份"}</small></div></div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar glass-clear">
          <div className="topbar-left">
            <IconButton label={collapsed ? "展开导航" : "收起导航"} onClick={() => setCollapsed((value) => !value)}><SidebarSimple size={20} /></IconButton>
            <div className="toolbar-context"><strong>{currentPage.label}</strong><span>{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span></div>
          </div>
          <div className="topbar-actions">
            <button className="search-trigger glass-clear" aria-label="搜索所有内容" title="搜索所有内容" onClick={() => setSearchOpen(true)}><MagnifyingGlass size={18} /><span>搜索所有内容</span><kbd><Command size={12} />K</kbd></button>
            <Button className="topbar-create" variant="secondary" size="sm" onClick={() => setQuickOpen(true)}><Plus size={16} />快速新建</Button>
            <Button className="manual-save" variant="secondary" size="sm" loading={saveStatus === "saving"} onClick={() => void saveNow().catch(() => undefined)}><FloppyDisk size={16} />手动保存</Button>
            <SaveIndicator status={saveStatus} />
          </div>
        </header>
        <main className="page-container" id="main-content" tabIndex={-1}><Outlet /></main>
      </div>
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <QuickCreateModal open={quickOpen} onClose={() => setQuickOpen(false)} />
    </div>
  );
}

function SaveIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  const values = {
    idle: { icon: FloppyDisk, label: "自动保存" },
    saving: { icon: FloppyDisk, label: "保存中" },
    saved: { icon: CheckCircle, label: "已保存" },
    error: { icon: WarningCircle, label: "保存失败" },
  } as const;
  const value = values[status];
  const Icon = value.icon;
  return <div className={`save-indicator save-${status}`} role="status"><Icon size={16} /><span>{value.label}</span></div>;
}

function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const search = useQuery({ queryKey: ["search", query], queryFn: () => api.search(query), enabled: open && query.trim().length > 0 });
  const grouped = useMemo(() => {
    return (search.data ?? []).reduce<Record<string, Entity[]>>((result, item) => {
      (result[item.module] ??= []).push(item);
      return result;
    }, {});
  }, [search.data]);
  const moduleNames: Record<string, string> = { dashboard: "首页", today: "今日计划", media: "自媒体", development: "开发工作", consulting: "咨询工作", fitness: "健身计划", diet: "饮食计划", entertainment: "游戏娱乐" };
  return (
    <Modal open={open} title="搜索工作台" description="按模块查找标题、笔记和记录内容" onClose={onClose} wide>
      <div className="command-search glass-clear"><MagnifyingGlass size={20} /><input autoFocus aria-label="搜索关键词" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词" /></div>
      <div className="search-results">
        {!query ? <div className="search-hint">输入内容开始搜索，按 Esc 关闭。</div> : search.isLoading ? <Skeleton lines={4} /> : search.error ? <ErrorState message={(search.error as Error).message} /> : search.data?.length === 0 ? <div className="search-hint">没有找到匹配内容。</div> : Object.entries(grouped).map(([module, items]) => (
          <section className="search-group" key={module}><h3>{moduleNames[module] ?? module}</h3>{items.map((item) => (
            <button key={`${item.collection}-${item.id}`} onClick={() => { navigate(collectionRoutes[item.collection] ?? "/"); onClose(); }}><span>{item.title || "未命名记录"}</span><ArrowRight size={16} /></button>
          ))}</section>
        ))}
      </div>
    </Modal>
  );
}

function QuickCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const options = [
    { label: "今日事项", detail: "安排今天要执行的事情", route: "/today?new=1", tone: "accent" },
    { label: "内容灵感", detail: "记录一个自媒体选题", route: "/media?new=1", tone: "neutral" },
    { label: "开发工作项", detail: "添加功能、需求或 Bug", route: "/development?new=work-item", tone: "neutral" },
    { label: "咨询跟进", detail: "安排客户后续联系", route: "/consulting?new=followup", tone: "neutral" },
    { label: "训练记录", detail: "开始或安排一次训练", route: "/fitness?new=workout", tone: "neutral" },
    { label: "餐食记录", detail: "记录计划或实际饮食", route: "/diet?new=meal", tone: "neutral" },
  ];
  return (
    <Modal open={open} title="快速新增" description="选择要记录的内容类型" onClose={onClose}>
      <div className="quick-grid">{options.map((option) => <button key={option.label} onClick={() => { navigate(option.route); onClose(); }}><Badge tone={option.tone as any}>{option.label}</Badge><p>{option.detail}</p><ArrowRight size={18} /></button>)}</div>
    </Modal>
  );
}
