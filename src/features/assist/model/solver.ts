import type {
  AssistProfile,
  Conflict,
  GestureCode,
  MappingEntry,
  SolveResult,
  Thresholds,
  StrikeBudget,
} from "./types";
import { actionById } from "./actions";
import {
  codeKey,
  codesOfLength,
  gestureWorst,
  isOneErrorApart,
  neighbors,
  pressCount,
} from "./codes";

/** 游戏内不可修改的硬规则（来自 fishing 模型） */
export const GAME_LIMITS = {
  /** bite 阶段原始提竿窗口（秒），超时脱钩 */
  biteWindow: 4,
  /** fighting 阶段松线脱钩上限 */
  slackLimit: 5,
  /** charging 蓄力一个完整周期（自动抛竿取峰值用） */
  chargeCycle: Math.PI / 2.2,
  tick: 0.05,
};

const GRAY_BAND_MIN = 0.12;
const GRAY_BAND_MAX = 0.4;
const HOLD_HEADROOM = 0.05;
const OVERHEAD = 0.08; // 一帧识别 + 派发固定开销

interface GroupDef {
  id: string;
  label: string;
  actions: string[];
}

/** 同时只会有一个分组处于激活态，组间可复用相同手势 */
const GROUPS: GroupDef[] = [
  {
    id: "lake",
    label: "湖畔主舞台",
    actions: [
      "cast",
      "strike",
      "reel-on",
      "reel-off",
      "power-up",
      "power-down",
      "drag-up",
      "drag-down",
      "next",
      "menu-spots",
      "menu-baits",
      "menu-bag",
      "menu-challenges",
      "menu-back",
    ],
  },
  { id: "spots", label: "钓点选择", actions: ["scan-next", "scan-prev", "confirm"] },
  {
    id: "baits",
    label: "鱼饵选择",
    actions: ["scan-next", "scan-prev", "confirm", "resupply"],
  },
  {
    id: "bag",
    label: "鱼获背包",
    actions: ["scan-next", "scan-prev", "confirm", "release"],
  },
  {
    id: "challenges",
    label: "挑战奖励",
    actions: ["scan-next", "scan-prev", "confirm", "claim"],
  },
];

const TIME_CRITICAL = new Set(["strike", "reel-on", "reel-off", "cast"]);

export function defaultTiming(): AssistProfile {
  return {
    enabled: false,
    holdMin: 0.15,
    holdMax: 1.2,
    reaction: 0.6,
    maxPresses: 4,
    strikeCap: 2,
    scanDwell: 1.5,
    autoStrike: true,
    autoRelief: true,
    autoCastAtPeak: true,
    locks: {},
  };
}

function buildThresholds(p: AssistProfile): Thresholds | null {
  const span = p.holdMax - p.holdMin;
  const band = Math.min(GRAY_BAND_MAX, Math.max(GRAY_BAND_MIN, span * 0.3));
  const short = p.holdMin + Math.max(0.05, ((span - band) * 0.4));
  const long = short + band;
  const gapMax = Math.min(1.5, Math.max(0.8, p.reaction + 0.6));
  return { short, long, band, gapMax, sepWait: gapMax, overhead: OVERHEAD };
}

interface RawCheck {
  thresholds: Thresholds | null;
  conflicts: Conflict[];
}

function checkRawLimits(p: AssistProfile): RawCheck {
  const conflicts: Conflict[] = [];
  const push = (id: string, message: string, related: string[] = []) =>
    conflicts.push({ id, message, related });
  if (!(p.maxPresses >= 1 && Number.isInteger(p.maxPresses)))
    push("max-presses", "每个手势最多按几次必须是不小于 1 的整数。");
  if (!(p.holdMin >= 0.05))
    push("hold-min", "按压时长下限过短，低于 0.05 秒无法可靠判定。");
  if (!(p.holdMax > p.holdMin))
    push("hold-range", "按压时长上限必须大于下限。");
  if (!(p.reaction >= 0 && p.reaction < 3))
    push("reaction", "反应延迟需要在 0–3 秒之间。");
  if (!(p.strikeCap >= 0 && p.strikeCap <= 4))
    push("strike-cap", "提竿窗口延长上限需要在 0–4 秒之间。");
  const thresholds = buildThresholds(p);
  if (thresholds && p.holdMax > p.holdMin) {
    if (thresholds.long > p.holdMax - HOLD_HEADROOM)
      push(
        "hold-band",
        `按压时长范围不足：短按判定需 ≤${thresholds.short.toFixed(2)}s，` +
          `灰区 ${thresholds.band.toFixed(2)}s，长按判定需 ≥${thresholds.long.toFixed(2)}s，` +
          `但上限只有 ${p.holdMax.toFixed(2)}s。请扩大可按压时长范围。`,
      );
    if (p.reaction >= thresholds.gapMax)
      push(
        "gap",
        `反应延迟 ${p.reaction.toFixed(2)}s 不小于手势内最大间隔 ${thresholds.gapMax.toFixed(2)}s，` +
          "多按手势可能来不及续按。请降低反应延迟。",
      );
  }
  return { thresholds: thresholds ?? null, conflicts };
}

function checkLocks(
  p: AssistProfile,
  t: Thresholds,
): { conflicts: Conflict[]; validLocks: Record<string, GestureCode> } {
  const conflicts: Conflict[] = [];
  const valid: Record<string, GestureCode> = {};
  const seen = new Map<string, string>();
  for (const [actionId, code] of Object.entries(p.locks)) {
    let action;
    try {
      action = actionById(actionId);
    } catch {
      continue;
    }
    if (!Array.isArray(code) || !code.every((k) => k === "S" || k === "L")) {
      conflicts.push({
        id: `lock-${actionId}`,
        message: `「${action.label}」锁定的手势格式无效，已忽略该锁定。`,
        related: [actionId],
      });
      continue;
    }
    if (pressCount(code) > p.maxPresses) {
      conflicts.push({
        id: `lock-${actionId}`,
        message: `「${action.label}」锁定的手势需要按 ${pressCount(code)} 次，` +
          `超过每手势最多 ${p.maxPresses} 次的限制。`,
        related: [actionId],
      });
      continue;
    }
    if (code.some((k) => k === "L" && t.long > p.holdMax - HOLD_HEADROOM)) {
      conflicts.push({
        id: `lock-${actionId}`,
        message: `「${action.label}」锁定手势含长按，但当前时长范围无法稳定做出长按。`,
        related: [actionId],
      });
      continue;
    }
    const k = codeKey(code);
    const owner = seen.get(k);
    if (owner) {
      conflicts.push({
        id: `lock-dup-${k}`,
        message: `「${actionById(owner).label}」与「${action.label}」锁定了相同手势，无法同时成立。`,
        related: [owner, actionId],
      });
      continue;
    }
    seen.set(k, actionId);
    valid[actionId] = code;
  }
  return { conflicts, validLocks: valid };
}

interface SolvedGroup {
  def: GroupDef;
  entries: Map<string, GestureCode>;
  missing: string[];
}

function solveGroup(
  def: GroupDef,
  locks: Record<string, GestureCode>,
  maxPresses: number,
): SolvedGroup {
  const pool: GestureCode[] = [];
  for (let n = 1; n <= maxPresses; n++) pool.push(...codesOfLength(n));
  const entries = new Map<string, GestureCode>();
  const used: GestureCode[] = [];
  const riskyUsed: GestureCode[] = [];
  const missing: string[] = [];

  const blockedByRisk = (code: GestureCode) =>
    riskyUsed.some((r) => isOneErrorApart(r, code));

  // 锁定动作先占位，并做风险相邻校验
  for (const actionId of def.actions) {
    const code = locks[actionId];
    if (!code) continue;
    const action = actionById(actionId);
    if (used.some((u) => codeKey(u) === codeKey(code))) {
      missing.push(actionId);
      continue;
    }
    if (action.risk === "risky" && used.some((u) => isOneErrorApart(u, code))) {
      missing.push(actionId);
      continue;
    }
    if (action.risk !== "risky" && blockedByRisk(code)) {
      missing.push(actionId);
      continue;
    }
    entries.set(actionId, code);
    used.push(code);
    if (action.risk === "risky") riskyUsed.push(code);
  }

  const score = (code: GestureCode, actionId: string) => {
    let s = pressCount(code) * 10;
    if (TIME_CRITICAL.has(actionId)) s -= 4;
    // 给风险动作留下邻居空间：优先选邻居占用少的码
    const neighborCount = neighbors(code).filter((nb) =>
      used.some((u) => codeKey(u) === codeKey(nb)),
    ).length;
    s += neighborCount * 2;
    return s;
  };

  // 风险动作优先，其次时序关键动作，其余按原顺序
  const ordered = [...def.actions]
    .filter((id) => !entries.has(id))
    .sort((a, b) => {
      const ra = actionById(a).risk === "risky" ? 0 : 1;
      const rb = actionById(b).risk === "risky" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      const ta = TIME_CRITICAL.has(a) ? 0 : 1;
      const tb = TIME_CRITICAL.has(b) ? 0 : 1;
      return ta - tb;
    });

  for (const actionId of ordered) {
    const action = actionById(actionId);
    const candidates = pool.filter((code) => {
      if (used.some((u) => codeKey(u) === codeKey(code))) return false;
      if (blockedByRisk(code)) return false;
      if (action.risk === "risky" && used.some((u) => isOneErrorApart(u, code)))
        return false;
      return true;
    });
    if (!candidates.length) {
      missing.push(actionId);
      continue;
    }
    candidates.sort((a, b) => score(a, actionId) - score(b, actionId));
    const pick = candidates[0];
    entries.set(actionId, pick);
    used.push(pick);
    if (action.risk === "risky") riskyUsed.push(pick);
  }
  return { def, entries, missing };
}

/** 让时序关键动作尽量避免“静默等待前缀”，与安全动作交换码 */
function optimizePrefixes(group: SolvedGroup): void {
  const used = [...group.entries.values()];
  const requiresSep = (code: GestureCode) =>
    used.some((u) => u !== code && u.length > code.length && isPrefixOf(code, u));
  const riskyIds = group.def.actions.filter(
    (id) => actionById(id).risk === "risky",
  );
  const swapValid = (a: string, codeA: GestureCode, b: string, codeB: GestureCode) => {
    const rest = new Map(group.entries);
    rest.delete(a);
    rest.delete(b);
    rest.set(a, codeB);
    rest.set(b, codeA);
    const codes = [...rest.entries()];
    for (const [id, own] of codes) {
      const act = actionById(id);
      for (const [otherId, other] of codes) {
        if (otherId === id || !isOneErrorApart(own, other)) continue;
        // 风险码的一次误差不能落入任何已分配码
        if (act.risk === "risky") return false;
        // 安全码不能落在风险码的误差邻域内
        if (riskyIds.includes(otherId)) return false;
      }
    }
    return true;
  };
  for (const id of ["cast", "strike", "reel-on", "reel-off"]) {
    const code = group.entries.get(id);
    if (!code || !requiresSep(code)) continue;
    for (const otherId of [...group.entries.keys()]) {
      if (otherId === id || TIME_CRITICAL.has(otherId)) continue;
      const otherCode = group.entries.get(otherId)!;
      if (requiresSep(otherCode) || pressCount(otherCode) < pressCount(code))
        continue;
      if (swapValid(id, code, otherId, otherCode)) {
        group.entries.set(id, otherCode);
        group.entries.set(otherId, code);
        break;
      }
    }
  }
}

function isPrefixOf(short: GestureCode, long: GestureCode): boolean {
  if (short.length >= long.length) return false;
  return short.every((k, i) => long[i] === k);
}

function buildStrikeBudget(
  p: AssistProfile,
  t: Thresholds,
  strikeCode: GestureCode | undefined,
  multiLength: boolean,
): StrikeBudget {
  const baseWindow = GAME_LIMITS.biteWindow;
  if (!strikeCode) {
    return {
      demand: 0,
      baseWindow,
      neededExtension: 0,
      appliedExtension: 0,
      totalBudget: baseWindow,
      feasible: false,
    };
  }
  const requiresSep = multiLength; // 湖畔组必然混用长度，前缀码另在条目里标注
  const worst =
    gestureWorst(strikeCode, t) + (requiresSep ? t.sepWait : 0) + t.overhead;
  const demand = p.reaction + worst;
  const neededExtension = Math.max(0, demand - baseWindow);
  const appliedExtension = Math.min(neededExtension, p.strikeCap);
  return {
    demand,
    baseWindow,
    neededExtension,
    appliedExtension,
    totalBudget: baseWindow + appliedExtension,
    feasible: appliedExtension + 1e-9 >= neededExtension,
  };
}

export function solveAssist(profile: AssistProfile): SolveResult {
  const raw = checkRawLimits(profile);
  const conflicts: Conflict[] = [...raw.conflicts];
  const warnings: string[] = [];
  const riskNotes: string[] = [];
  if (!raw.thresholds) {
    return {
      ok: false,
      mappings: [],
      thresholds: {
        short: 0,
        long: 0,
        band: 0,
        gapMax: 0,
        sepWait: 0,
        overhead: OVERHEAD,
      },
      worstResponse: 0,
      strike: buildStrikeBudget(profile, raw.thresholds ?? ({} as Thresholds), undefined, false),
      availableGroups: [],
      conflicts,
      warnings,
      riskNotes,
    };
  }
  const t = raw.thresholds;
  const lockCheck = checkLocks(profile, t);
  conflicts.push(...lockCheck.conflicts);

  const solved = GROUPS.map((g) =>
    solveGroup(g, lockCheck.validLocks, profile.maxPresses),
  );
  solved.forEach(optimizePrefixes);

  const availableGroups: string[] = [];
  const mappings: MappingEntry[] = [];
  const lakeGroup = solved.find((g) => g.def.id === "lake")!;

  for (const g of solved) {
    if (g.missing.length) {
      conflicts.push({
        id: `group-${g.def.id}`,
        message:
          `「${g.def.label}」需要 ${g.def.actions.length} 个互不混淆的手势，` +
          `在每手势最多 ${profile.maxPresses} 次、且风险动作需保留误差缓冲的条件下，` +
          `仍有 ${g.missing.length} 个动作无法分配（${g.missing
            .map((id) => actionById(id).label)
            .join("、")}）。请提高每手势按键上限，或减少该分组动作。`,
        related: g.missing,
      });
    } else {
      availableGroups.push(g.def.id);
    }
    const used = [...g.entries.values()];
    const multiLength = new Set(used.map((c) => c.length)).size > 1;
    for (const [actionId, code] of g.entries) {
      const action = actionById(actionId);
      const requiresSep =
        multiLength && used.some((u) => isPrefixOf(code, u));
      const worst =
        gestureWorst(code, t) +
        (requiresSep ? t.sepWait : 0) +
        t.overhead;
      mappings.push({
        actionId,
        label: action.label,
        groupId: g.def.id,
        code,
        locked: !!lockCheck.validLocks[actionId],
        risk: action.risk,
        worst,
      });
    }
  }

  // 全局最坏响应（不含反应延迟；反应延迟在预览中单独叠加展示）
  const worstResponse = mappings.reduce((m, x) => Math.max(m, x.worst), 0);

  // 提竿窗口预算
  const strikeCode = lakeGroup.entries.get("strike");
  const lakeMulti =
    new Set([...lakeGroup.entries.values()].map((c) => c.length)).size > 1;
  const strike = buildStrikeBudget(profile, t, strikeCode, lakeMulti);
  if (strikeCode && !strike.feasible) {
    conflicts.push({
      id: "strike-window",
      message:
        `提竿手势最坏需要 ${strike.demand.toFixed(2)}s（含反应延迟），` +
        `原始窗口 ${strike.baseWindow}s，需延长 ${strike.neededExtension.toFixed(2)}s，` +
        `超过你设置的上限 ${profile.strikeCap.toFixed(2)}s。` +
        "请提高提竿延长上限、降低反应延迟，或改用更少按键的提竿手势。",
      related: ["strike"],
    });
  } else if (strike.neededExtension > 0) {
    warnings.push(
      `提竿窗口按辅助规则延长 ${strike.appliedExtension.toFixed(2)}s（未超上限 ` +
        `${profile.strikeCap.toFixed(2)}s），延长时间已计入响应预算；不会改变鱼的冲刺节奏。`,
    );
  }

  // 松线 5 秒约束
  const reelOn = lakeGroup.entries.get("reel-on");
  if (reelOn) {
    const reelWorst =
      profile.reaction +
      gestureWorst(reelOn, t) +
      t.sepWait +
      t.overhead;
    if (reelWorst >= GAME_LIMITS.slackLimit) {
      const msg =
        `恢复收线最坏需 ${reelWorst.toFixed(2)}s，逼近松线脱钩上限 ${GAME_LIMITS.slackLimit}s。`;
      if (profile.autoRelief)
        warnings.push(msg + "已开启自动缓线兜底，但建议缩短收线手势。");
      else
        conflicts.push({
          id: "slack",
          message: msg + "请开启自动缓线，或缩短收线手势、降低反应延迟。",
          related: ["reel-on"],
        });
    }
  }

  // 蓄力周期约束
  if (!profile.autoCastAtPeak) {
    warnings.push(
      "已关闭峰值自动抛竿：抛竿手势必须在蓄力周期 " +
        `${GAME_LIMITS.chargeCycle.toFixed(2)}s 内完成，否则力度由手势完成时刻决定。`,
    );
  }

  // 风险动作的一次误差分析
  for (const g of solved) {
    const assigned = new Set([...g.entries.values()].map(codeKey));
    for (const [actionId, code] of g.entries) {
      const action = actionById(actionId);
      if (action.risk !== "risky") continue;
      const nbs = neighbors(code);
      const collide = nbs.filter((nb) => assigned.has(codeKey(nb)));
      if (collide.length) {
        conflicts.push({
          id: `risk-${actionId}`,
          message: `风险动作「${action.label}」的一次漏按/多按/翻转输入会与其他手势混淆，违反安全约束。`,
          related: [actionId],
        });
      } else {
        riskNotes.push(
          `「${action.label}」手势 ${code.join("")} 的 ${nbs.length} 种一次误差输入` +
            "均不匹配任何动作，只会提示重试，不会触发扣饵、放流或领奖。",
        );
      }
    }
  }

  if (t.sepWait > 0)
    warnings.push(
      `多长度手势通过 ${t.sepWait.toFixed(2)}s 静默等待分隔，该等待已计入对应手势的最坏响应时间。`,
    );
  if (profile.scanDwell === 0)
    warnings.push("扫描驻留为 0：菜单将只响应手动扫描手势，不会自动走动。");
  const slow = mappings.filter((m) => m.worst > 3);
  slow.forEach((m) =>
    warnings.push(`「${m.label}」手势最坏耗时 ${m.worst.toFixed(2)}s，建议精简按键数。`),
  );

  return {
    ok: conflicts.length === 0,
    mappings,
    thresholds: t,
    worstResponse,
    strike,
    availableGroups,
    conflicts,
    warnings,
    riskNotes,
  };
}

export const assistGroups = GROUPS;
