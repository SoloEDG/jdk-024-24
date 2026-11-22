/* 游戏模型集成验证：辅助规则不破坏原有物理，且按规则生效 */
// Node 环境下的 localStorage 垫片，仅供测试
const mem = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

import { gameReducer } from "../src/app/gameReducer";
import { newDocument, idleSession } from "../src/shared/initial";
import { GAME_BITE_WINDOW } from "../src/features/fishing/model/session";
import type { Workspace } from "../src/shared/types";
import { saveAssistProfile, loadAssistProfile } from "../src/features/assist/storage";
import { defaultTiming } from "../src/features/assist/model/solver";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) passed++;
  else {
    failed++;
    console.error(`✗ ${name} ${detail}`);
  }
}
const send = (state: Workspace, c: any): Workspace => gameReducer(state, c);
const tick = (state: Workspace, dt = 0.05) => send(state, { type: "tick", dt });

// —— 1. 提竿窗口延长生效，但不超过设定 ——
{
  let st: Workspace = { doc: { ...newDocument(), assistStrikeExt: 1.5 }, session: idleSession(), notice: "" };
  st = send(st, { type: "charge-start" });
  st = send(st, { type: "cast" });
  // 推进到咬钩
  let guard = 0;
  while (st.session.phase !== "bite" && guard++ < 400) st = tick(st);
  check("能进入咬钩阶段", st.session.phase === "bite");
  const biteAt = st.session.biteAt;
  // 原始窗口结束时不应脱钩
  while (st.session.clock - biteAt <= GAME_BITE_WINDOW + 0.01) st = tick(st);
  check("原始 4s 窗口后因延长仍可提竿", st.session.phase === "bite");
  st = send(st, { type: "strike" });
  check("延长窗口内提竿成功进入溜鱼", st.session.phase === "fighting");

  // 超过延长上限后必须脱钩
  let st2: Workspace = { doc: { ...newDocument(), assistStrikeExt: 0.5 }, session: idleSession(), notice: "" };
  st2 = send(st2, { type: "charge-start" });
  st2 = send(st2, { type: "cast" });
  guard = 0;
  while (st2.session.phase !== "bite" && guard++ < 400) st2 = tick(st2);
  const b2 = st2.session.biteAt;
  while (st2.session.phase === "bite" || st2.session.phase === "waiting") {
    st2 = tick(st2);
    if (st2.session.phase === "escaped") break;
    if (st2.session.clock - b2 > 10) break;
  }
  check("超过延长上限后脱钩（不会无限等待）", st2.session.phase === "escaped");
  check(
    "脱钩时间不超过 原始窗口+延长+一帧",
    st2.session.clock - b2 <= GAME_BITE_WINDOW + 0.5 + 0.1,
    `实际 ${(st2.session.clock - b2).toFixed(2)}s`,
  );
}

// —— 2. 蓄力到峰值自动抛竿 ——
{
  let st: Workspace = {
    doc: { ...newDocument(), assistAutoCast: true, assistAutoRelief: false },
    session: idleSession(),
    notice: "",
  };
  st = send(st, { type: "charge-start" });
  check("进入蓄力", st.session.phase === "charging");
  let guard = 0;
  while (st.session.phase === "charging" && guard++ < 200) st = tick(st);
  check("到峰值后自动抛竿进入等待，无需第二次按键", st.session.phase === "waiting");
  check("自动抛竿仍消耗一枚鱼饵",
    st.doc.stock.worm === newDocument().stock.worm - 1);
  check("自动抛竿采用峰值力度", st.session.castPower > 0.95,
    `力度 ${st.session.castPower}`);
}

// —— 3. 关闭自动抛竿时蓄力不会自己抛出 ——
{
  let st: Workspace = {
    doc: { ...newDocument(), assistAutoCast: false },
    session: idleSession(),
    notice: "",
  };
  st = send(st, { type: "charge-start" });
  for (let i = 0; i < 60; i++) st = tick(st);
  check("关闭自动抛竿后仍停留在蓄力阶段", st.session.phase === "charging");
}

// —— 4. 自动缓线只在张力过高时松手，不代替玩家收线 ——
{
  let st: Workspace = {
    doc: { ...newDocument(), assistAutoRelief: true, power: 0.95, drag: 0.15 },
    session: idleSession(),
    notice: "",
  };
  st = send(st, { type: "charge-start" });
  st = send(st, { type: "cast" });
  let guard = 0;
  while (st.session.phase !== "bite" && guard++ < 400) st = tick(st);
  st = send(st, { type: "strike" });
  check("进入溜鱼", st.session.phase === "fighting");
  st = send(st, { type: "reel", held: true });
  check("玩家收线状态为按住", st.session.reeling === true);
  let relieved = false;
  for (let i = 0; i < 200 && st.session.phase === "fighting"; i++) {
    st = tick(st);
    if (!st.session.reeling) relieved = true;
  }
  check("张力过高时自动松线", relieved);
  check("自动缓线后不会自己重新收线（需玩家再触发）", st.session.reeling === false);
}

// —— 5. 已扣饵/已放流不可通过辅助改判撤销 ——
{
  let st: Workspace = { doc: newDocument(), session: idleSession(), notice: "" };
  st = send(st, { type: "charge-start" });
  st = send(st, { type: "cast" });
  const stockAfterCast = st.doc.stock.worm;
  // 模拟失焦清理输入，库存不应回退
  st = send(st, { type: "reel", held: false });
  check("抛竿扣饵后失焦不返还鱼饵", st.doc.stock.worm === stockAfterCast);

  let landed: Workspace = { doc: newDocument(), session: idleSession(), notice: "" };
  const fakeCatch = {
    id: "x-1", fish: "crucian" as const, weight: 0.5, spot: "reed" as const,
    bait: "worm" as const, time: Date.now(), duration: 10, peakTension: 0.5,
  };
  landed = {
    ...landed,
    doc: { ...landed.doc, bag: [fakeCatch], stats: { ...landed.doc.stats, catches: 1 } },
  };
  const before = landed.doc.bag.length;
  landed = send(landed, { type: "release", id: "x-1" });
  check("放流后鱼获消失且计数增加",
    landed.doc.bag.length === before - 1 && landed.doc.stats.released === 1);
  landed = send(landed, { type: "release", id: "x-1" });
  check("重复放流不会重复计数（不可改判）", landed.doc.stats.released === 1);
}

// —— 6. assist-config 受非负约束 ——
{
  let st: Workspace = { doc: newDocument(), session: idleSession(), notice: "" };
  st = send(st, { type: "assist-config", strikeExt: -3, autoCast: true, autoRelief: false });
  check("负的提竿延长被钳制为 0", st.doc.assistStrikeExt === 0);
  check("自动开关正确写入", st.doc.assistAutoCast === true && st.doc.assistAutoRelief === false);
}

// —— 7. 辅助方案本地存取 ——
{
  const p = { ...defaultTiming(), enabled: true, reaction: 1.1, locks: { strike: ["L"] } };
  check("方案保存成功", saveAssistProfile(p) === true);
  const back = loadAssistProfile();
  check("方案读取保留参数与锁定",
    back.enabled === true && back.reaction === 1.1 && back.locks.strike?.[0] === "L");
  check("非法锁定被清洗", (() => {
    localStorage.setItem(
      "stillwater-jdk024-assist-v1",
      JSON.stringify({ ...defaultTiming(), locks: { bad: ["X"] } }),
    );
    return loadAssistProfile().locks.bad === undefined;
  })());
}

// —— 8. 辅助关闭时不改变鱼的冲刺：fighting 物理与原模型一致 ——
{
  const mk = (relief: boolean): Workspace => ({
    doc: { ...newDocument(), assistAutoRelief: relief, power: 0.5, drag: 0.5 },
    session: idleSession(),
    notice: "",
  });
  const run = (st: Workspace) => {
    st = send(st, { type: "charge-start" });
    st = send(st, { type: "cast" });
    let g = 0;
    while (st.session.phase !== "bite" && g++ < 400) st = tick(st);
    st = send(st, { type: "strike" });
    st = send(st, { type: "reel", held: true });
    for (let i = 0; i < 40; i++) st = tick(st);
    return st.session;
  };
  const off = run(mk(false));
  const on = run(mk(true));
  // 低力度下 40 帧内张力未达阈值，两者轨迹一致 → 冲刺节奏未被改变
  check("未触发缓线时两种配置物理轨迹一致",
    Math.abs(off.tension - on.tension) < 1e-9 &&
    Math.abs(off.energy - on.energy) < 1e-9 &&
    Math.abs(off.progress - on.progress) < 1e-9);
}

console.log(`\n${passed} 通过, ${failed} 失败`);
if (failed) process.exit(1);
