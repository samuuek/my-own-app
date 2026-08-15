import { Plus } from "@phosphor-icons/react";
import { Button } from "../../components/ui";
import type { DashboardData } from "../../types";

type Props = {
  date: string;
  overview: DashboardData["overview"];
  onAddTask: () => void;
};

export function ProgressOverview({ date, overview, onAddTask }: Props) {
  const circumference = 2 * Math.PI * 45;
  const progress = Math.max(0, Math.min(100, overview.progress));
  const formattedDate = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" })
    .format(new Date(`${date}T12:00:00`));
  return (
    <section className="workbench-overview" aria-labelledby="today-progress-title">
      <div className="workbench-overview-copy">
        <span>{formattedDate}</span>
        <h2 id="today-progress-title">今日进度</h2>
        {overview.total === 0 ? (
          <>
            <p>还没有安排任务</p>
            <Button variant="secondary" size="sm" onClick={onAddTask}><Plus size={15} />添加今日任务</Button>
          </>
        ) : (
          <p>已完成 {overview.completed} / {overview.total} 项 · 计划 {overview.scheduledMinutes} 分钟</p>
        )}
      </div>
      <div className="progress-ring" aria-label={`今日完成进度 ${progress}%`} role="img">
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <circle className="progress-ring-track" cx="56" cy="56" r="45" />
          <circle className="progress-ring-value" cx="56" cy="56" r="45" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress / 100)} />
        </svg>
        <strong>{overview.total === 0 ? "—" : `${progress}%`}</strong>
      </div>
    </section>
  );
}
