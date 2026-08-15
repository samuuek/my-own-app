import { useCallback, useEffect, useState } from "react";
import { CalendarBlank, DeviceMobile, Flag, Sparkle } from "@phosphor-icons/react";
import { Button, Modal } from "../../components/ui";

type Props = {
  open: boolean;
  onSkip: () => Promise<void>;
  onComplete: () => Promise<void>;
  onCreateImportantDate: (input: { name: string; target_date: string; recurrence: "none"; color: "blue" }) => Promise<void>;
  onCreateGoal: (input: { name: string; target_date: string; progress: number; notes: string; status: "active" }) => Promise<void>;
};

export function OnboardingModal({ open, onSkip, onComplete, onCreateImportantDate, onCreateGoal }: Props) {
  const [step, setStep] = useState(0);
  const [dateName, setDateName] = useState("");
  const [importantDate, setImportantDate] = useState("");
  const [goalName, setGoalName] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [goalProgress, setGoalProgress] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDateName("");
    setImportantDate("");
    setGoalName("");
    setGoalDate("");
    setGoalProgress("0");
    setError("");
  }, [open]);

  const execute = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "暂时无法保存，请稍后再试");
    } finally {
      setBusy(false);
    }
  }, []);

  const skip = useCallback(() => execute(onSkip), [execute, onSkip]);
  const advanceDate = () => execute(async () => {
    const name = dateName.trim();
    if (name || importantDate) {
      if (!name || !importantDate) throw new Error("请同时填写日期名称和日期，或留空跳过");
      await onCreateImportantDate({ name, target_date: importantDate, recurrence: "none", color: "blue" });
    }
    setStep(2);
  });
  const finish = () => execute(async () => {
    const name = goalName.trim();
    const progress = Number(goalProgress || 0);
    if (name || goalDate || progress) {
      if (!name) throw new Error("请填写目标名称，或留空跳过");
      if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Error("初始进度需要是 0 到 100 的整数");
      await onCreateGoal({ name, target_date: goalDate, progress, notes: "", status: "active" });
    }
    await onComplete();
  });

  return (
    <Modal open={open} title="欢迎使用新的进度工作台" description={`第 ${step + 1} 步，共 3 步`} onClose={skip}>
      <div className="onboarding-progress" aria-label={`引导进度 ${step + 1}/3`}>
        {[0, 1, 2].map((index) => <span className={index <= step ? "active" : ""} key={index} />)}
      </div>
      {step === 0 ? (
        <div className="onboarding-step">
          <div className="onboarding-art"><DeviceMobile /><Sparkle /></div>
          <h3>更清楚地看见每天的进展</h3>
          <p>新的 iPhone 系统外观把今日进度、重要日期、长期目标和专注计时集中在首页，原有计划和数据都会保留。</p>
        </div>
      ) : step === 1 ? (
        <div className="onboarding-step">
          <div className="onboarding-step-heading"><CalendarBlank /><div><h3>添加一个重要日期</h3><p>这是可选步骤，以后也能随时在首页添加。</p></div></div>
          <div className="onboarding-fields">
            <label><span>日期名称</span><input aria-label="重要日期名称" value={dateName} onChange={(event) => setDateName(event.target.value)} placeholder="例如：纪念日" /></label>
            <label><span>日期</span><input aria-label="重要日期" type="date" value={importantDate} onChange={(event) => setImportantDate(event.target.value)} /></label>
          </div>
        </div>
      ) : (
        <div className="onboarding-step">
          <div className="onboarding-step-heading"><Flag /><div><h3>设定一个长期目标</h3><p>先写下方向，进度可以之后慢慢更新。</p></div></div>
          <div className="onboarding-fields">
            <label><span>目标名称</span><input aria-label="目标名称" value={goalName} onChange={(event) => setGoalName(event.target.value)} placeholder="例如：完成个人作品" /></label>
            <label><span>目标日期</span><input aria-label="目标日期" type="date" value={goalDate} onChange={(event) => setGoalDate(event.target.value)} /></label>
            <label><span>初始进度</span><input aria-label="初始进度" type="number" min="0" max="100" step="1" value={goalProgress} onChange={(event) => setGoalProgress(event.target.value)} /></label>
          </div>
        </div>
      )}
      {error ? <p className="form-submit-error" role="alert">{error}</p> : null}
      <footer className="modal-actions onboarding-actions">
        <Button autoFocus type="button" variant="ghost" disabled={busy} onClick={() => void skip()}>跳过引导</Button>
        {step > 0 ? <Button type="button" variant="secondary" disabled={busy} onClick={() => { setError(""); setStep((current) => current - 1); }}>上一步</Button> : null}
        {step === 0 ? <Button type="button" loading={busy} onClick={() => setStep(1)}>下一步</Button> : null}
        {step === 1 ? <Button type="button" loading={busy} onClick={() => void advanceDate()}>下一步</Button> : null}
        {step === 2 ? <Button type="button" loading={busy} onClick={() => void finish()}>完成引导</Button> : null}
      </footer>
    </Modal>
  );
}
