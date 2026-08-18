import { useState } from "react";
import { ConfirmDialog, EntityForm, Modal, type FieldDefinition } from "../../components/ui";
import type { CollectionName, Entity } from "../../types";

type EditableCollection = Extract<CollectionName, "importantDates" | "longTermGoals" | "planItems">;

export type WorkbenchDialogState =
  | { type: "importantDate"; item: Entity | null }
  | { type: "longTermGoal"; item: Entity | null }
  | { type: "planItem"; item: Entity }
  | { type: "delete"; collection: EditableCollection; item: Entity }
  | null;

type Props = {
  state: WorkbenchDialogState;
  onClose: () => void;
  onSave: (collection: EditableCollection, item: Entity | null, values: Record<string, any>) => Promise<void>;
  onDelete: (collection: EditableCollection, item: Entity) => Promise<void>;
};

const importantDateFields: FieldDefinition[] = [
  { name: "name", label: "日期名称", required: true, placeholder: "例如：纪念日" },
  { name: "target_date", label: "目标日期", type: "date", required: true },
  { name: "recurrence", label: "重复方式", type: "select", options: [{ value: "none", label: "不重复" }, { value: "yearly", label: "每年" }] },
  { name: "color", label: "标记颜色", type: "select", options: [{ value: "blue", label: "蓝色" }, { value: "green", label: "绿色" }, { value: "orange", label: "橙色" }, { value: "red", label: "红色" }] },
];

const longTermGoalFields: FieldDefinition[] = [
  { name: "name", label: "目标名称", required: true, placeholder: "例如：完成个人作品" },
  { name: "target_date", label: "目标日期", type: "date" },
  { name: "progress", label: "当前进度", type: "number", step: "1", helper: "填写 0 到 100" },
  { name: "status", label: "目标状态", type: "select", options: [{ value: "active", label: "进行中" }, { value: "completed", label: "已完成" }] },
  { name: "notes", label: "备注", type: "textarea", placeholder: "记录下一步或阶段成果" },
];

const planItemFields: FieldDefinition[] = [
  { name: "title", label: "事项名称", required: true },
  { name: "start_time", label: "开始时间", type: "time" },
  { name: "estimated_minutes", label: "预计分钟", type: "number", step: "1" },
  { name: "priority", label: "优先级", type: "select", options: [{ value: "low", label: "低" }, { value: "medium", label: "普通" }, { value: "high", label: "高" }] },
  { name: "notes", label: "备注", type: "textarea" },
];

export function WorkbenchDialogs({ state, onClose, onSave, onDelete }: Props) {
  const [error, setError] = useState("");
  if (!state) return null;

  if (state.type === "delete") {
    const name = state.item.name || state.item.display_title || state.item.title || "这条记录";
    return <ConfirmDialog open title="移到回收站？" description={`“${name}”会从首页隐藏，之后仍可在设置的回收站中恢复。`} confirmLabel="移到回收站" danger onClose={onClose} onConfirm={() => onDelete(state.collection, state.item)} />;
  }

  const config = state.type === "importantDate"
    ? { collection: "importantDates" as const, title: state.item ? "编辑重要日期" : "添加重要日期", description: "用于纪念日、截止日和每年重复的提醒。", fields: importantDateFields, submitLabel: "保存重要日期", defaults: { recurrence: "none", color: "blue" } }
    : state.type === "longTermGoal"
      ? { collection: "longTermGoals" as const, title: state.item ? "编辑长期目标" : "添加长期目标", description: "记录需要持续推进的方向和当前进度。", fields: longTermGoalFields, submitLabel: "保存长期目标", defaults: { progress: 0, status: "active", notes: "" } }
      : { collection: "planItems" as const, title: "编辑今日事项", description: "调整时间、预计用时和优先级。", fields: planItemFields, submitLabel: "保存今日事项", defaults: { priority: "medium", notes: "" } };

  return (
    <Modal open title={config.title} description={config.description} onClose={onClose}>
      {error ? <p className="form-submit-error" role="alert">{error}</p> : null}
      <EntityForm
        key={`${state.type}-${state.item?.id ?? "new"}`}
        fields={config.fields}
        initial={{ ...config.defaults, ...(state.item ?? {}) }}
        submitLabel={config.submitLabel}
        onCancel={onClose}
        onSubmit={async (values) => {
          setError("");
          try {
            await onSave(config.collection, state.item, values);
            onClose();
          } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : "暂时无法保存，请稍后再试");
          }
        }}
      />
    </Modal>
  );
}
