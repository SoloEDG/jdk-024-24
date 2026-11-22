import type { Workspace } from "../shared/types";
import type { Command } from "../shared/commands";
import { idleSession, isBusy } from "../shared/initial";
import { selectWater } from "../features/waters";
import {
  chooseBait,
  tune,
  consumeBait,
  resupply,
  attraction,
  biteDelay,
} from "../features/tackle";
import { prepareCast, tickSession, strike } from "../features/fishing";
import { landCatch, releaseCatch } from "../features/collection";
import { claimReward } from "../features/challenges";

/** 自动缓线触发张力阈值：与物理模型的过载线 0.87 对齐并提前一点 */
const RELIEF_TENSION = 0.85;

function runCast(state: Workspace): Workspace {
  const { doc, session: s } = state;
  if (s.phase !== "charging") return state;
  const consumed = consumeBait(doc);
  if (!consumed) return state;
  const cast = prepareCast(
    doc,
    s.charge,
    attraction(doc.spot, doc.bait),
    (r) => biteDelay(doc.bait, r),
  );
  return {
    ...state,
    doc: {
      ...consumed,
      seed: cast.seed,
      stats: { ...doc.stats, casts: doc.stats.casts + 1 },
    },
    session: cast.session,
  };
}

export function gameReducer(state: Workspace, c: Command): Workspace {
  const { doc, session: s } = state;
  const busy = isBusy(s);
  switch (c.type) {
    case "spot":
      return busy ? state : { ...state, doc: selectWater(doc, c.id) };
    case "bait":
      return busy ? state : { ...state, doc: chooseBait(doc, c.id) };
    case "power":
      return { ...state, doc: tune(doc, "power", c.value) };
    case "drag":
      return busy ? state : { ...state, doc: tune(doc, "drag", c.value) };
    case "resupply":
      return busy
        ? state
        : {
            ...state,
            doc: resupply(doc),
            notice: "鱼饵已补给，带上好心情出发。",
          };
    case "charge-start":
      return s.phase === "ready" && doc.stock[doc.bait] > 0
        ? {
            ...state,
            session: {
              ...idleSession(),
              phase: "charging",
              message: "再次点击，把鱼饵抛向水面。",
            },
          }
        : state;
    case "cast":
      return runCast(state);
    case "strike":
      return { ...state, session: strike(s) };
    case "reel":
      return s.phase === "fighting"
        ? { ...state, session: { ...s, reeling: c.held } }
        : state;
    case "tick": {
      // 单键辅助：蓄力到峰值自动抛竿（不改变蓄力节奏，仅替玩家完成第二次按键）
      if (s.phase === "charging" && doc.assistAutoCast) {
        const preview = tickSession(s, doc, Math.min(0.1, Math.max(0, c.dt)));
        if (preview.charge < s.charge && s.charge > 0.98) {
          const casted = runCast(state);
          if (casted !== state) return casted;
        }
      }
      const next0 = tickSession(
        s,
        doc,
        Math.min(0.1, Math.max(0, c.dt)),
      );
      // 单键辅助：张力过高自动松线缓线，绝不代替玩家按收线
      const next =
        next0.phase === "fighting" &&
        doc.assistAutoRelief &&
        next0.reeling &&
        next0.tension >= RELIEF_TENSION
          ? { ...next0, reeling: false }
          : next0;
      if (next === s) return state;
      let updated = doc;
      if (next.phase === "landed" && s.phase !== "landed")
        updated = landCatch(doc, next, Date.now());
      if (next.phase === "escaped" && s.phase !== "escaped")
        updated = {
          ...doc,
          stats: { ...doc.stats, escapes: doc.stats.escapes + 1 },
        };
      return { ...state, doc: updated, session: next };
    }
    case "next":
      return s.phase === "landed" || s.phase === "escaped"
        ? { ...state, session: idleSession() }
        : state;
    case "release":
      return { ...state, doc: releaseCatch(doc, c.id) };
    case "claim":
      return { ...state, doc: claimReward(doc, c.id) };
    case "assist-config":
      return {
        ...state,
        doc: {
          ...doc,
          assistStrikeExt: Math.max(0, c.strikeExt),
          assistAutoCast: c.autoCast,
          assistAutoRelief: c.autoRelief,
        },
      };
  }
}
