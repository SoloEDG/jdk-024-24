import { useEffect, useMemo, useState } from "react";
import {
  Accessibility,
  AlertTriangle,
  Check,
  Info,
  Lock,
  RotateCcw,
  Save,
  ShieldAlert,
} from "lucide-react";
import type { AssistProfile, GestureCode, SolveResult } from "../model/types";
import { solveAssist, assistGroups, defaultTiming } from "../model/solver";
import { codeLabel } from "../model/codes";

interface Props {
  profile: AssistProfile;
  onSave: (p: AssistProfile) => void;
  saved: boolean;
}

export function AssistPanel({ profile, onSave, saved }: Props) {
  const [draft, setDraft] = useState<AssistProfile>(profile);
  useEffect(() => setDraft(profile), [profile]);
  const result: SolveResult = useMemo(() => solveAssist(draft), [draft]);

  const set = <K extends keyof AssistProfile>(k: K, v: AssistProfile[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));
  const setNum = (k: keyof AssistProfile, v: string) => {
    const n = Number(v);
    if (Number.isFinite(n)) set(k as never, n as never);
  };

  const toggleLock = (actionId: string, code: GestureCode | undefined) => {
    const locks = { ...draft.locks };
    if (locks[actionId]) delete locks[actionId];
    else if (code) locks[actionId] = code;
    set("locks", locks);
  };

  return (
    <section className="assist-panel" aria-label="单键辅助方案配置">
      <div className="section-title">
        <Accessibility size={17} />
        <h2>单键辅助方案</h2>
        <label className="assist-switch">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          <span>{draft.enabled ? "已启用" : "未启用"}</span>
        </label>
      </div>

      <p className="muted intro">
        填写你能稳定完成的按压能力，系统会生成来得及完成动作、且带单次误差保护的手势方案；
        无解时会明确指出冲突，而不是拒绝全部输入。
      </p>

      <div className="assist-form">
        <label>
          按压时长下限（秒）
          <input
            type="number"
            min="0.05"
            max="3"
            step="0.05"
            value={draft.holdMin}
            onChange={(e) => setNum("holdMin", e.target.value)}
          />
        </label>
        <label>
          按压时长上限（秒）
          <input
            type="number"
            min="0.1"
            max="5"
            step="0.05"
            value={draft.holdMax}
            onChange={(e) => setNum("holdMax", e.target.value)}
          />
        </label>
        <label>
          反应延迟（秒）
          <input
            type="number"
            min="0"
            max="3"
            step="0.05"
            value={draft.reaction}
            onChange={(e) => setNum("reaction", e.target.value)}
          />
        </label>
        <label>
          每手势最多按几次
          <input
            type="number"
            min="1"
            max="6"
            step="1"
            value={draft.maxPresses}
            onChange={(e) => setNum("maxPresses", e.target.value)}
          />
        </label>
        <label>
          提竿窗口延长上限（秒）
          <input
            type="number"
            min="0"
            max="4"
            step="0.1"
            value={draft.strikeCap}
            onChange={(e) => setNum("strikeCap", e.target.value)}
          />
        </label>
        <label>
          扫描驻留（秒，0=手动扫描）
          <input
            type="number"
            min="0"
            max="6"
            step="0.5"
            value={draft.scanDwell}
            onChange={(e) => setNum("scanDwell", e.target.value)}
          />
        </label>
      </div>

      <div className="assist-toggles">
        <label>
          <input
            type="checkbox"
            checked={draft.autoStrike}
            onChange={(e) => set("autoStrike", e.target.checked)}
          />
          自动提竿（仅替代按键，不改鱼的冲刺）
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.autoRelief}
            onChange={(e) => set("autoRelief", e.target.checked)}
          />
          自动缓线（张力过高自动松手，防止断线）
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.autoCastAtPeak}
            onChange={(e) => set("autoCastAtPeak", e.target.checked)}
          />
          蓄力到峰值自动抛竿
        </label>
      </div>

      <div className="assist-thresholds">
        <span>
          短按判定 ≤ <b>{result.thresholds.short.toFixed(2)}s</b>
        </span>
        <span>
          灰区 <b>{result.thresholds.band.toFixed(2)}s</b>
        </span>
        <span>
          长按判定 ≥ <b>{result.thresholds.long.toFixed(2)}s</b>
        </span>
        <span>
          手势间隔上限 <b>{result.thresholds.gapMax.toFixed(2)}s</b>
        </span>
        <span>
          静默分隔等待 <b>{result.thresholds.sepWait.toFixed(2)}s</b>（计入响应延迟）
        </span>
      </div>

      <div
        className={
          "assist-verdict " + (result.ok ? "ok" : "bad")
        }
        role="status"
      >
        {result.ok ? (
          <>
            <Check size={16} />
            方案有解：可用阶段 {result.availableGroups.join("、")} ·
            全局最坏响应（不含反应）{result.worstResponse.toFixed(2)}s ·
            含反应延迟最坏 {draft.reaction.toFixed(2)}s
          </>
        ) : (
          <>
            <ShieldAlert size={16} />
            当前限制下无解或存在冲突，请按下方提示调整
          </>
        )}
      </div>

      <div className="assist-budget">
        <h3>提竿窗口预算</h3>
        <div className="budget-row">
          <span>需求（反应+手势最坏）</span>
          <b>{result.strike.demand.toFixed(2)}s</b>
        </div>
        <div className="budget-row">
          <span>原始窗口</span>
          <b>{result.strike.baseWindow.toFixed(2)}s</b>
        </div>
        <div className="budget-row">
          <span>需要延长 / 采用延长</span>
          <b>
            {result.strike.neededExtension.toFixed(2)}s /{" "}
            {result.strike.appliedExtension.toFixed(2)}s
          </b>
        </div>
        <div className="budget-row">
          <span>延长上限（玩家设定）</span>
          <b>{draft.strikeCap.toFixed(2)}s</b>
        </div>
        <small className={result.strike.feasible ? "muted" : "danger"}>
          延长不会超过上限，也不会无限等待或改变鱼的冲刺；
          {result.strike.feasible
            ? `实际咬钩窗口为 ${result.strike.totalBudget.toFixed(2)}s。`
            : " 当前预算无法在上限内完成提竿。"}
        </small>
      </div>

      {result.conflicts.length > 0 && (
        <div className="assist-conflicts">
          <h3>
            <AlertTriangle size={15} /> 冲突与无解原因
          </h3>
          <ul>
            {result.conflicts.map((c) => (
              <li key={c.id}>{c.message}</li>
            ))}
          </ul>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="assist-warnings">
          <h3>
            <Info size={15} /> 提示
          </h3>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {result.riskNotes.length > 0 && (
        <details className="assist-risk-notes">
          <summary>
            <ShieldAlert size={14} /> 风险动作的单次误差保护（{result.riskNotes.length}）
          </summary>
          <ul>
            {result.riskNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="assist-mappings">
        <h3>方案预览 · 手势映射（可锁定熟悉的映射）</h3>
        {assistGroups.map((g) => {
          const rows = result.mappings.filter((m) => m.groupId === g.id);
          const usable = result.availableGroups.includes(g.id);
          return (
            <div className={"mapping-group " + (usable ? "" : "blocked")} key={g.id}>
              <h4>
                {g.label}
                {!usable && <span className="group-blocked">（受限，无法完整解出）</span>}
              </h4>
              {rows.map((m) => (
                <div className="mapping-row" key={g.id + m.actionId}>
                  <span className="mapping-label">
                    {m.label}
                    {m.risk === "risky" && <em className="risk-tag">风险·需确认</em>}
                  </span>
                  <span className="gesture-code">
                    {codeLabel(m.code)}
                    <small>
                      {m.code.join("")} · 最坏 {m.worst.toFixed(2)}s
                    </small>
                  </span>
                  <button
                    className={"lock-btn " + (m.locked ? "locked" : "")}
                    onClick={() => toggleLock(m.actionId, m.code)}
                    title={m.locked ? "取消锁定" : "锁定该映射"}
                  >
                    <Lock size={13} />
                    {m.locked ? "已锁定" : "锁定"}
                  </button>
                </div>
              ))}
              {!rows.length && <small className="muted">该分组暂无可解手势。</small>}
            </div>
          );
        })}
      </div>

      <div className="assist-actions">
        <button className="primary" onClick={() => onSave(draft)} disabled={!result.ok}>
          <Save size={15} />
          保存并启用方案
        </button>
        <button
          className="ghost"
          onClick={() => setDraft(defaultTiming())}
        >
          <RotateCcw size={14} />
          恢复默认能力
        </button>
        <span className="save-state">
          {saved ? <Check size={12} /> : <AlertTriangle size={12} />}
          {saved ? "方案已随本地手记保存" : "本地保存不可用"}
        </span>
      </div>
      <small className="muted">
        无错误的手势会被可靠识别；落入灰区、漏按或多按只会提示重试，绝不会被误判成
        扣饵、放流或领奖动作。鼠标与单键交替时同一动作只提交一次；失焦会清除未完成输入。
      </small>
      {!result.ok && draft.enabled && (
        <p className="danger">
          方案存在冲突时无法启用单键输入，请先调整能力参数。
        </p>
      )}
    </section>
  );
}
