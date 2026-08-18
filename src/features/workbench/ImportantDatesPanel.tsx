import { ArrowDown, ArrowUp, CalendarBlank, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { Button } from "../../components/ui";
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

function countdown(item: Entity): string {
  if (item.state === "today") return "今天";
  if (item.state === "overdue") return "已到期";
  return `还有 ${item.daysRemaining} 天`;
}

export function ImportantDatesPanel({ items, error, onRetry, onAdd, onEdit, onDelete, onMove }: Props) {
  return (
    <section className="workbench-panel important-dates-panel" aria-labelledby="important-dates-title">
      <header><div><span>倒计时</span><h2 id="important-dates-title">重要日期</h2></div><Button size="sm" variant="secondary" onClick={onAdd}><Plus size={15} />添加重要日期</Button></header>
      {error ? <div className="workbench-panel-error" role="alert"><span>{error}</span><Button size="sm" variant="ghost" onClick={onRetry}>重新加载</Button></div> : null}
      {!error && items.length === 0 ? <p className="workbench-empty"><CalendarBlank size={22} />还没有重要日期</p> : null}
      <div className="important-date-list">
        {items.map((item, index) => (
          <article className="important-date-card" data-color={item.color ?? "blue"} key={item.id}>
            <span className="important-date-mark" aria-hidden="true" />
            <div><strong>{item.name}</strong><small>{item.displayDate ?? item.target_date}{item.recurrence === "yearly" ? " · 每年" : ""}</small></div>
            <b>{countdown(item)}</b>
            <div className="workbench-item-actions">
              <button aria-label={`上移${item.name}`} disabled={index === 0} onClick={() => onMove(item, -1)}><ArrowUp /></button>
              <button aria-label={`下移${item.name}`} disabled={index === items.length - 1} onClick={() => onMove(item, 1)}><ArrowDown /></button>
              <button aria-label={`编辑${item.name}`} onClick={() => onEdit(item)}><PencilSimple /></button>
              <button aria-label={`删除${item.name}`} onClick={() => onDelete(item)}><Trash /></button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
