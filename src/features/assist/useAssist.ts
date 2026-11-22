import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Command } from "../../shared/commands";
import type { GameDocument, Session } from "../../shared/types";
import type {
  AssistContext,
  AssistProfile,
  GestureCode,
  RecognizerStatus,
} from "./model/types";
import { GestureRecognizer } from "./model/recognizer";
import { solveAssist } from "./model/solver";
import { codeKey } from "./model/codes";
import { RISKY_ACTION_IDS } from "./model/actions";
import { challenges } from "../challenges/model/challenges";
import { challengeReady } from "../challenges/lib/progress";
import { waters } from "../waters/model/waters";
import { canVisit } from "../waters/lib/habitat";
import { baits } from "../tackle/model/baits";

export interface AssistMenuState {
  menu: Exclude<AssistContext, "lake">;
  index: number;
  count: number;
}

export interface PendingRisk {
  actionId: string;
  label: string;
}

const STEP = 0.1;

export function useAssist(
  profile: AssistProfile,
  doc: GameDocument,
  session: Session,
  send: (c: Command) => void,
) {
  const result = useMemo(() => solveAssist(profile), [profile]);
  const [menu, setMenu] = useState<AssistMenuState | null>(null);
  const [pending, setPending] = useState<PendingRisk | null>(null);
  const [status, setStatus] = useState<RecognizerStatus>({
    kind: "idle",
    message: "等待输入",
    sequence: [],
  });
  const [flash, setFlash] = useState<string>("");

  const activeGroup: AssistContext = menu ? menu.menu : "lake";

  // 当前激活分组的动作 -> 手势 映射
  const codeMap = useMemo(() => {
    const map = new Map<string, GestureCode>();
    for (const m of result.mappings) {
      if (m.groupId === activeGroup) map.set(m.actionId, m.code);
    }
    return map;
  }, [result.mappings, activeGroup]);

  // 反向：码 -> 动作
  const keyToAction = useMemo(() => {
    const map = new Map<string, string>();
    for (const [actionId, code] of codeMap) map.set(codeKey(code), actionId);
    return map;
  }, [codeMap]);

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const groupRef = useRef(activeGroup);
  groupRef.current = activeGroup;
  const menuRef = useRef(menu);
  menuRef.current = menu;
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const codeMapRef = useRef(codeMap);
  codeMapRef.current = codeMap;
  const thresholdsRef = useRef(result.thresholds);
  thresholdsRef.current = result.thresholds;

  const recognizer = useRef<GestureRecognizer | null>(null);
  if (!recognizer.current) {
    recognizer.current = new GestureRecognizer(
      () => codeMapRef.current,
      () => thresholdsRef.current,
    );
  }

  const syncStatus = useCallback(() => {
    if (recognizer.current) setStatus(recognizer.current.status);
  }, []);

  const notify = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((cur) => (cur === msg ? "" : cur)), 2200);
  }, []);

  // —— 菜单项枚举 ——
  const menuItems = useMemo(() => buildMenuItems(menu?.menu ?? null, doc), [
    menu,
    doc,
  ]);
  useEffect(() => {
    setMenu((cur) => {
      if (!cur) return cur;
      const count = buildMenuItems(cur.menu, doc).length;
      return { ...cur, count, index: Math.min(cur.index, Math.max(0, count - 1)) };
    });
  }, [doc]);

  const openMenu = useCallback(
    (m: Exclude<AssistContext, "lake">) => {
      const count = buildMenuItems(m, doc).length;
      setMenu({ menu: m, index: 0, count });
      setPending(null);
      recognizer.current?.reset();
      syncStatus();
    },
    [doc, syncStatus],
  );

  const closeMenu = useCallback(() => {
    setMenu(null);
    setPending(null);
    recognizer.current?.reset();
    syncStatus();
  }, [syncStatus]);

  // —— 动作执行 ——
  const confirmCurrent = useCallback(() => {
    const m = menuRef.current;
    if (!m) return;
    const items = buildMenuItems(m.menu, docRef.current);
    const item = items[m.index];
    if (!item) return;
    if (m.menu === "spots")
      send({ type: "spot", id: item.id as GameDocument["spot"] });
    else if (m.menu === "baits")
      send({ type: "bait", id: item.id as GameDocument["bait"] });
    else if (m.menu === "bag") {
      setPending({ actionId: "release", label: `放流「${item.label}」` });
      return;
    } else if (m.menu === "challenges") {
      if (item.claimable)
        setPending({ actionId: "claim", label: `领取「${item.label}」` });
      else notify("该奖励暂不可领取");
      return;
    }
    closeMenu();
  }, [send, notify, closeMenu]);

  const dispatchSafe = useCallback(
    (actionId: string) => {
      const g = groupRef.current;
      const s = sessionRef.current;
      const d = docRef.current;
      // 湖畔动作按阶段校验；菜单动作仅在菜单中生效
      if (g === "lake") {
        if (!lakeActionAllowed(actionId, s.phase)) {
          notify(`当前阶段无法执行「${ACTION_LABELS[actionId] ?? actionId}」`);
          return;
        }
      }
      switch (actionId) {
        case "cast":
          if (s.phase === "charging") {
            send({ type: "cast" });
            notify("已抛竿，等待浮漂动静");
          } else {
            send({ type: "charge-start" });
            if (d.assistAutoCast) notify("已开始蓄力，到峰值自动抛竿");
            else notify("已蓄力，请再做一次抛竿手势抛出");
          }
          break;
        case "strike":
          send({ type: "strike" });
          break;
        case "reel-on":
          send({ type: "reel", held: true });
          break;
        case "reel-off":
          send({ type: "reel", held: false });
          break;
        case "power-up":
          send({ type: "power", value: Math.min(0.95, d.power + STEP) });
          break;
        case "power-down":
          send({ type: "power", value: Math.max(0.15, d.power - STEP) });
          break;
        case "drag-up":
          send({ type: "drag", value: Math.min(0.95, d.drag + STEP) });
          break;
        case "drag-down":
          send({ type: "drag", value: Math.max(0.15, d.drag - STEP) });
          break;
        case "next":
          send({ type: "next" });
          break;
        case "menu-spots":
          openMenu("spots");
          break;
        case "menu-baits":
          openMenu("baits");
          break;
        case "menu-bag":
          openMenu("bag");
          break;
        case "menu-challenges":
          openMenu("challenges");
          break;
        case "menu-back":
          closeMenu();
          break;
        case "scan-next":
          setMenu((cur) =>
            cur
              ? { ...cur, index: (cur.index + 1) % Math.max(1, cur.count) }
              : cur,
          );
          break;
        case "scan-prev":
          setMenu((cur) =>
            cur
              ? {
                  ...cur,
                  index:
                    (cur.index - 1 + Math.max(1, cur.count)) %
                    Math.max(1, cur.count),
                }
              : cur,
          );
          break;
        case "confirm":
          confirmCurrent();
          break;
        case "resupply":
          send({ type: "resupply" });
          notify("鱼饵已补给");
          break;
        case "release":
        case "claim":
          // 风险动作理论上在 execute 已拦截，这里兜底
          setPending({
            actionId,
            label: RISK_LABELS[actionId] ?? actionId,
          });
          break;
      }
    },
    [send, notify, openMenu, closeMenu, confirmCurrent],
  );

  const acceptPending = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    if (p.actionId === "cast") {
      send({ type: "cast" });
    } else if (p.actionId === "release") {
      const m = menuRef.current;
      const items = m ? buildMenuItems(m.menu, docRef.current) : [];
      const item = m ? items[m.index] : undefined;
      if (item) send({ type: "release", id: item.id });
    } else if (p.actionId === "claim") {
      const m = menuRef.current;
      const items = m ? buildMenuItems(m.menu, docRef.current) : [];
      const item = m ? items[m.index] : undefined;
      if (item) send({ type: "claim", id: item.id });
    }
    setPending(null);
    recognizer.current?.reset();
    if (p.actionId !== "cast") closeMenu();
    syncStatus();
  }, [send, closeMenu, syncStatus]);

  const cancelPending = useCallback(() => {
    setPending(null);
    recognizer.current?.reset();
    syncStatus();
  }, [syncStatus]);

  const execute = useCallback(
    (actionId: string) => {
      if (!codeMapRef.current.has(actionId)) return;
      // 二次确认流程：重复同一风险手势才执行，识别成任何其他手势则取消
      if (pendingRef.current) {
        if (actionId === pendingRef.current.actionId) acceptPending();
        else {
          cancelPending();
          notify("识别到不同手势，已取消该高风险动作。");
        }
        return;
      }
      if (RISKY_ACTION_IDS.has(actionId)) {
        // 风险动作不直接执行：进入二次确认，识别层已保证一次误差无法到达这里
        const label = RISK_LABELS[actionId] ?? actionId;
        setPending({ actionId, label });
        recognizer.current?.reset();
        syncStatus();
        return;
      }
      dispatchSafe(actionId);
    },
    [syncStatus, dispatchSafe, acceptPending, cancelPending, notify],
  );

  const retryInput = useCallback(() => {
    recognizer.current?.clearError();
    syncStatus();
  }, [syncStatus]);

  // —— 物理单键输入 ——
  const onDown = useCallback(() => {
    if (!profileRef.current.enabled || !result.ok) return;
    recognizer.current?.pressDown(performance.now());
    syncStatus();
  }, [result.ok, syncStatus]);

  const onUp = useCallback(() => {
    if (!profileRef.current.enabled || !result.ok) return;
    const u = recognizer.current?.pressUp(performance.now());
    if (u?.type === "commit") execute(u.actionId);
    if (u?.type === "error") notify(u.reason);
    syncStatus();
  }, [result.ok, execute, notify, syncStatus]);

  // 静默等待超时轮询（等待计入响应延迟）
  useEffect(() => {
    if (!profile.enabled || !result.ok) return;
    let raf = 0;
    const loop = () => {
      const u = recognizer.current?.update(performance.now());
      if (u?.type === "commit") execute(u.actionId);
      if (u?.type === "error") notify(u.reason);
      if (u && u.type !== "none") syncStatus();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [profile.enabled, result.ok, execute, notify, syncStatus]);

  // 失焦：清除未完成输入并停止收线
  useEffect(() => {
    const onBlur = () => {
      recognizer.current?.abort("窗口失焦，未完成的输入已清除，请重新开始手势。");
      send({ type: "reel", held: false });
      setPending(null);
      syncStatus();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onBlur);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onBlur);
    };
  }, [send, syncStatus]);

  // 阶段切换：清除上一阶段未完成的输入
  const phaseRef = useRef(session.phase);
  useEffect(() => {
    if (phaseRef.current !== session.phase) {
      recognizer.current?.abort("阶段变化，未完成的输入已清除。");
      if (["ready", "landed", "escaped"].includes(session.phase))
        setPending((p) => (p?.actionId === "cast" ? null : p));
      syncStatus();
      phaseRef.current = session.phase;
    }
  }, [session.phase, syncStatus]);

  // 自动提竿（可选）：只替代按键，不改变咬钩窗口与鱼的冲刺
  useEffect(() => {
    if (session.phase === "bite" && profile.enabled && profile.autoStrike && result.ok) {
      send({ type: "strike" });
      notify("已自动提竿");
    }
  }, [session.phase, profile.enabled, profile.autoStrike, result.ok, send, notify]);

  // 自动扫描驻留
  const dwellRef = useRef<number | null>(null);
  useEffect(() => {
    if (!menu || profile.scanDwell <= 0 || pending) {
      if (dwellRef.current) window.clearInterval(dwellRef.current);
      dwellRef.current = null;
      return;
    }
    dwellRef.current = window.setInterval(() => {
      setMenu((cur) =>
        cur
          ? { ...cur, index: (cur.index + 1) % Math.max(1, cur.count) }
          : cur,
      );
    }, profile.scanDwell * 1000);
    return () => {
      if (dwellRef.current) window.clearInterval(dwellRef.current);
    };
  }, [menu, profile.scanDwell, pending]);

  const sessionRef = useRef(session);
  sessionRef.current = session;
  const docRef = useRef(doc);
  docRef.current = doc;

  return {
    result,
    menu,
    menuItems,
    pending,
    status,
    flash,
    activeGroup,
    keyToAction,
    onDown,
    onUp,
    acceptPending,
    cancelPending,
    retryInput,
    closeMenu,
    openMenu,
  };
}

const ACTION_LABELS: Record<string, string> = {
  cast: "抛竿",
  strike: "提竿",
  "reel-on": "收线",
  "reel-off": "松线",
  "power-up": "力度 +",
  "power-down": "力度 −",
  "drag-up": "泄力 +",
  "drag-down": "泄力 −",
  next: "再来一竿",
  "scan-next": "下一项",
  "scan-prev": "上一项",
  confirm: "确认",
  resupply: "补给",
  release: "放流",
  claim: "领取",
  "menu-spots": "钓点菜单",
  "menu-baits": "鱼饵菜单",
  "menu-bag": "背包菜单",
  "menu-challenges": "挑战菜单",
  "menu-back": "返回",
};

const RISK_LABELS: Record<string, string> = {
  cast: "抛竿（将消耗一枚鱼饵）",
  release: "放流当前鱼获（不可撤销）",
  claim: "领取该奖励（不可撤销）",
};

function lakeActionAllowed(actionId: string, phase: Session["phase"]): boolean {
  const allowed: Record<string, Session["phase"][]> = {
    // ready 时手势触发蓄力；charging 时同一手势触发抛出（自动抛竿开启时由系统代抛）
    cast: ["ready", "charging"],
    strike: ["bite"],
    "reel-on": ["fighting"],
    "reel-off": ["fighting"],
    "power-up": ["ready", "fighting"],
    "power-down": ["ready", "fighting"],
    "drag-up": ["ready"],
    "drag-down": ["ready"],
    next: ["landed", "escaped"],
    "menu-spots": ["ready"],
    "menu-baits": ["ready"],
    "menu-bag": ["ready"],
    "menu-challenges": ["ready"],
    "menu-back": ["ready", "landed", "escaped"],
  };
  return allowed[actionId]?.includes(phase) ?? false;
}

export interface MenuItem {
  id: string;
  label: string;
  sub: string;
  disabled?: boolean;
  claimable?: boolean;
}

export function buildMenuItems(
  menu: Exclude<AssistContext, "lake"> | null,
  doc: GameDocument,
): MenuItem[] {
  if (!menu) return [];
  if (menu === "spots") {
    return waters.map((w) => {
      const open = canVisit(doc, w.id);
      return {
        id: w.id,
        label: w.name,
        sub: open ? w.depth : `捕获 ${w.catchesRequired} 尾解锁`,
        disabled: !open,
      };
    });
  }
  if (menu === "baits") {
    return baits.map((b) => ({
      id: b.id,
      label: b.name,
      sub: `库存 ×${doc.stock[b.id]}`,
      disabled: doc.stock[b.id] <= 0,
    }));
  }
  if (menu === "bag") {
    return doc.bag.map((c) => ({
      id: c.id,
      label: fishName(c.fish),
      sub: `${c.weight.toFixed(2)} kg · ${c.spot}`,
    }));
  }
  return challenges.map((c) => ({
    id: c.id,
    label: c.name,
    sub: c.reward,
    claimable: challengeReady(doc, c.id),
    disabled: doc.claimed.includes(c.id),
  }));
}

function fishName(id: string): string {
  const map: Record<string, string> = {
    crucian: "银鲫",
    perch: "河鲈",
    carp: "锦鲤",
    trout: "虹鳟",
    bass: "大口黑鲈",
    pike: "白斑狗鱼",
  };
  return map[id] ?? id;
}
