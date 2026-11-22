import { useEffect } from "react";
import {
  AlertTriangle,
  Check,
  CircleDot,
  Flag,
  Fish,
  MapPin,
  PackageOpen,
  RotateCcw,
  X,
} from "lucide-react";
import type { Session } from "../../../shared/types";
import type { AssistProfile, SolveResult } from "../model/types";
import { codeLabel } from "../model/codes";
import type { AssistMenuState, MenuItem, PendingRisk } from "../useAssist";

interface Props {
  profile: AssistProfile;
  result: SolveResult;
  session: Session;
  menu: AssistMenuState | null;
  menuItems: MenuItem[];
  pending: PendingRisk | null;
  status: { kind: string; message: string; sequence: string[] };
  flash: string;
  activeGroup: string;
  onDown: () => void;
  onUp: () => void;
  onAccept: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onCloseMenu: () => void;
}

const MENU_META: Record<
  string,
  { title: string; icon: typeof MapPin }
> = {
  spots: { title: "扫描钓点", icon: MapPin },
  baits: { title: "扫描鱼饵", icon: PackageOpen },
  bag: { title: "扫描鱼获", icon: Fish },
  challenges: { title: "扫描挑战与奖励", icon: Flag },
};

export function AssistDock({
  profile,
  result,
  session,
  menu,
  menuItems,
  pending,
  status,
  flash,
  activeGroup,
  onDown,
  onUp,
  onAccept,
  onCancel,
  onRetry,
  onCloseMenu,
}: Props) {
  // 空格键作为同一个物理单键（与鼠标共用同一去重通道，按一次只提交一次）
  useEffect(() => {
    const isFormControl = (el: HTMLElement | null) =>
      !!el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
    const down = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      if (!profile.enabled) return; // 未启用时保留游戏原有键盘行为
      const target = e.target as HTMLElement | null;
      if (isFormControl(target)) return;
      // 对话框/界面按钮上的回车空格交给原生点击，避免与确认流程重复
      if (target && target.tagName === "BUTTON" && !target.closest(".single-key"))
        return;
      e.preventDefault();
      if (!e.repeat) onDown();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== " " && e.key !== "Enter") return;
      if (!profile.enabled) return;
      const target = e.target as HTMLElement | null;
      if (isFormControl(target)) return;
      if (target && target.tagName === "BUTTON" && !target.closest(".single-key"))
        return;
      e.preventDefault();
      onUp();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [onDown, onUp, profile.enabled]);

  if (!profile.enabled) return null;

  const activeMappings = result.mappings.filter((m) => m.groupId === activeGroup);
  const confirmCode = activeMappings.find((m) => m.actionId === "confirm");
  const MenuIcon = menu ? MENU_META[menu.menu].icon : null;
  const menuTitle = menu ? MENU_META[menu.menu].title : "";

  return (
    <div className="assist-dock" aria-label="单键辅助控制台">
      <div className="dock-head">
        <CircleDot size={15} />
        <strong>单键辅助 · {menu ? MENU_META[menu.menu]?.title : "湖畔模式"}</strong>
        <span className={"dock-dot " + status.kind} />
      </div>

      <button
        type="button"
        className="single-key"
        aria-label="单键辅助主按键：按住时长区分短按与长按"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onDown();
        }}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onLostPointerCapture={onUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <span className="key-label">单键</span>
        <small>按下 / 长按</small>
      </button>

      <div className="dock-status" role="status">
        <span>{status.message}</span>
        {status.sequence.length > 0 && (
          <span className="live-seq">
            {status.sequence.map((k, i) => (
              <b key={i}>{k === "S" ? "短" : "长"}</b>
            ))}
          </span>
        )}
      </div>
      {flash && <div className="dock-flash">{flash}</div>}
      {status.kind === "error" && (
        <button className="ghost retry-btn" onClick={onRetry}>
          <RotateCcw size={13} /> 知道了，重试
        </button>
      )}

      <div className="dock-phase">
        当前阶段：<b>{phaseLabel(session.phase)}</b>
      </div>

      <div className="dock-mappings">
        {activeMappings.map((m) => (
          <div
            className={
              "dock-mapping " +
              (m.risk === "risky" ? "risky" : "") +
              (m.locked ? " locked" : "")
            }
            key={m.actionId}
          >
            <span>{m.label}</span>
            <code>
              {m.code.join("")}
              <small>{codeLabel(m.code)}</small>
            </code>
          </div>
        ))}
      </div>

      {menu && MenuIcon && (
        <div className="scan-overlay" role="dialog" aria-label={menuTitle}>
          <div className="scan-head">
            <strong>
              <MenuIcon size={15} />
              {menuTitle}
            </strong>
            <button className="icon-btn" aria-label="关闭扫描" onClick={onCloseMenu}>
              <X size={16} />
            </button>
          </div>
          <ul className="scan-list">
            {menuItems.map((item, i) => (
              <li
                key={item.id}
                className={
                  "scan-item " +
                  (i === menu.index ? "focus" : "") +
                  (item.disabled ? " disabled" : "")
                }
              >
                {i === menu.index && <span className="scan-caret">▶</span>}
                <span className="scan-label">{item.label}</span>
                <small>{item.sub}</small>
                {item.claimable && <em className="claim-tag">可领取</em>}
              </li>
            ))}
            {menuItems.length === 0 && (
              <li className="scan-empty">暂时没有可扫描的项目</li>
            )}
          </ul>
          <small className="scan-hint">
            高亮项每 {profile.scanDwell > 0 ? `${profile.scanDwell}s ` : ""}
            移动，或用扫描手势手动切换；确认手势选择当前项
            {confirmCode ? `（${confirmCode.code.join("")}）` : ""}。
          </small>
        </div>
      )}

      {pending && (
        <div className="modal-backdrop assist-confirm-backdrop">
          <div className="assist-confirm" role="alertdialog" aria-modal="true">
            <AlertTriangle size={22} />
            <h3>请确认这个高风险动作</h3>
            <p>{pending.label}</p>
            <small>
              该操作可能扣饵、放流或领取奖励，一旦执行不可撤销。
              再做一次相同手势才会执行；识别成其他手势、或点取消则放弃。
              一次漏按/多按只会提示重试，绝不会被当作确认。
            </small>
            <div className="confirm-actions">
              <button className="primary danger-btn" onClick={onAccept}>
                <Check size={15} /> 确认执行
              </button>
              <button className="ghost" onClick={onCancel}>
                <X size={15} /> 取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function phaseLabel(phase: Session["phase"]): string {
  const map: Record<Session["phase"], string> = {
    ready: "准备",
    charging: "蓄力",
    waiting: "等待咬钩",
    bite: "咬钩",
    fighting: "溜鱼",
    landed: "已收获",
    escaped: "已脱钩",
  };
  return map[phase];
}
