import { useEffect, useState } from "react";
import { Pause, Play, Stop, Timer } from "@phosphor-icons/react";
import { Button } from "../../components/ui";
import type { FocusTimerSnapshot } from "../../types";
import { formatClock, remainingAt } from "./model";

type Props = {
  timer: FocusTimerSnapshot | null;
  taskTitle: string | null;
  error: string | null;
  onRetry: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
};

export function FocusTimerPanel({ timer, taskTitle, error, onRetry, onPause, onResume, onFinish }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (timer?.status !== "running") return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [timer?.id, timer?.status]);
  const remaining = timer ? remainingAt(timer, now) : 0;
  return (
    <section className="focus-timer-panel workbench-panel" aria-labelledby="focus-timer-title">
      <header><div><span>保持专注</span><h2 id="focus-timer-title">专注计时</h2></div><Timer size={24} /></header>
      {error ? <div className="workbench-panel-error" role="alert"><span>{error}</span><Button size="sm" variant="ghost" onClick={onRetry}>重新加载</Button></div> : null}
      {!error && !timer ? <p className="workbench-empty"><Timer size={24} />选择今日任务开始专注</p> : null}
      {timer ? (
        <div className="focus-timer-content">
          <small>{timer.status === "paused" ? "已暂停" : "正在专注"}</small>
          <strong aria-live="polite">{formatClock(remaining)}</strong>
          <p>{taskTitle || "未关联任务"}</p>
          <div>
            {timer.status === "paused"
              ? <Button onClick={onResume}><Play size={16} />继续专注</Button>
              : <Button onClick={onPause}><Pause size={16} />暂停专注</Button>}
            <Button variant="secondary" onClick={onFinish}><Stop size={16} />结束专注</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
