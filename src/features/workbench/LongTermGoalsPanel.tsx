import { ArrowDown, ArrowUp, Flag, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { Button } from "../../components/ui";
import { formatDate } from "../../utils";
import type { Entity } from "../../types";

type Props = {
  items: Entity[];
  error: string | null;
  onRetry: () => void;
  onAdd: () => void;
  onEdit: (item: Entity) => void;
  onDelete: (item: Entity) => void;
  onMove: (item: Entity, direction: -1 | 1) => void;
};

export function LongTermGoalsPanel({ items, error, onRetry, onAdd, onEdit, onDelete, onMove }: Props) {
  return (
    <section className="workbench-panel long-term-goals-panel" aria-labelledby="long-term-goals-title">
      <header><div><span>持续推进</span><h2 id="long-term-goals-title">长期目标</h2></div><Button size="sm" variant="secondary" onClick={onAdd}><Plus size={15} />添加长期目标</Button></header>
      {error ? <div className="workbench-panel-error" role="alert"><span>{error}</span><Button size="sm" variant="ghost" onClick={onRetry}>重新加载</Button></div> : null}
      {!error && items.length === 0 ? <p className="workbench-empty"><Flag size={22} />还没有长期目标</p> : null}
      <div className="long-term-goal-list">
        {items.map((item, index) => {
          const progress = Math.max(0, Math.min(100, Number(item.progress || 0)));
          return (
            <article className="long-term-goal-card" data-status={item.status ?? "active"} key={item.id}>
              <div className="goal-copy"><strong>{item.name}</strong><small>{item.status === "completed" ? "已完成" : item.target_date ? `目标 ${formatDate(item.target_date)}` : "持续目标"}</small></div>
              <div className="goal-progress"><progress aria-label={`${item.name}进度`} value={progress} max={100} /><b>{progress}%</b></div>
              <div className="workbench-item-actions">
                <button aria-label={`上移${item.name}`} disabled={index === 0} onClick={() => onMove(item, -1)}><ArrowUp /></button>
                <button aria-label={`下移${item.name}`} disabled={index === items.length - 1} onClick={() => onMove(item, 1)}><ArrowDown /></button>
                <button aria-label={`编辑${item.name}`} onClick={() => onEdit(item)}><PencilSimple /></button>
                <button aria-label={`删除${item.name}`} onClick={() => onDelete(item)}><Trash /></button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
