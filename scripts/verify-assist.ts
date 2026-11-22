/* 逻辑验证脚本：用 tsx 直接运行纯逻辑模块，不涉及 DOM */
import { defaultTiming, solveAssist } from "../src/features/assist/model/solver";
import { GestureRecognizer } from "../src/features/assist/model/recognizer";
import { codeKey, codesOfLength, neighbors, isOneErrorApart } from "../src/features/assist/model/codes";
import type { GestureCode } from "../src/features/assist/model/types";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${name} ${detail}`);
  }
}
function approx(a: number, b: number, eps = 1e-9) {
  return Math.abs(a - b) < eps;
}

// —— 1. 默认配置应有解 ——
const base = defaultTiming();
const r0 = solveAssist(base);
check("默认能力下方案有解", r0.ok, r0.conflicts.map((c) => c.message).join(" | "));
check("默认覆盖全部 5 个分组", r0.availableGroups.length === 5);
// scan-next/scan-prev/confirm 在多个菜单分组复用，因此映射条目多于动作数
check("映射条目不少于动作总数 19", r0.mappings.length >= 19,
  `实际 ${r0.mappings.length}`);
check("每个分组都有映射", new Set(r0.mappings.map((m) => m.groupId)).size === 5);

// —— 2. 组内手势唯一 ——
for (const gid of ["lake", "spots", "baits", "bag", "challenges"]) {
  const rows = r0.mappings.filter((m) => m.groupId === gid);
  const keys = rows.map((m) => codeKey(m.code));
  check(`分组 ${gid} 手势互不重复`, new Set(keys).size === keys.length);
}

// —— 3. 风险动作的一次误差不与任何同组码碰撞 ——
for (const gid of ["lake", "bag", "challenges"]) {
  const rows = r0.mappings.filter((m) => m.groupId === gid);
  const assigned = new Set(rows.map((m) => codeKey(m.code)));
  for (const m of rows.filter((x) => x.risk === "risky")) {
    const collide = neighbors(m.code).some((nb) => assigned.has(codeKey(nb)));
    check(`风险动作 ${m.actionId} 的一次误差不混淆`, !collide);
  }
}

// —— 4. 无错误手势必须可识别（识别器不会拒绝正确输入） ——
{
  const lakeMap = new Map<string, GestureCode>();
  for (const m of r0.mappings.filter((x) => x.groupId === "lake"))
    lakeMap.set(m.actionId, m.code);
  const rec = new GestureRecognizer(
    () => lakeMap,
    () => r0.thresholds,
  );
  let recognized = 0;
  for (const [actionId, code] of lakeMap) {
    rec.reset();
    let t = 0;
    let out: ReturnType<GestureRecognizer["pressUp"]> = { type: "none" };
    code.forEach((k, i) => {
      const hold = k === "S" ? r0.thresholds.short * 0.5 : r0.thresholds.long + 0.1;
      rec.pressDown((t + 0.0) * 1000);
      t += hold;
      out = rec.pressUp(t * 1000);
      if (i < code.length - 1) t += 0.3; // 间隔
    });
    if (out.type !== "commit") {
      // 若是某更长码前缀，静默等待后应能提交
      const tick = rec.update((t + r0.thresholds.gapMax + 0.05) * 1000);
      out = tick;
    }
    if (out.type === "commit" && out.actionId === actionId) recognized++;
    else check(`正确手势可识别 ${actionId}`, false, JSON.stringify(out));
  }
  check("全部湖畔正确手势都能识别（未一刀切拒绝）", recognized === lakeMap.size,
    `识别 ${recognized}/${lakeMap.size}`);
}

// —— 5. 漏按/多按只会报错或重试，不会提交成另一个动作 ——
{
  const lakeMap = new Map<string, GestureCode>();
  for (const m of r0.mappings.filter((x) => x.groupId === "lake"))
    lakeMap.set(m.actionId, m.code);
  const rec = new GestureRecognizer(
    () => lakeMap,
    () => r0.thresholds,
  );
  const cast = lakeMap.get("cast")!;
  const badInputs: GestureCode[] = neighbors(cast);
  let safeCount = 0;
  for (const bad of badInputs) {
    rec.reset();
    let t = 0;
    let result: ReturnType<GestureRecognizer["pressUp"]> = { type: "none" };
    bad.forEach((k, i) => {
      const hold = k === "S" ? r0.thresholds.short * 0.5 : r0.thresholds.long + 0.1;
      rec.pressDown(t * 1000);
      t += hold;
      result = rec.pressUp(t * 1000);
      if (i < bad.length - 1) t += 0.3;
    });
    if (result.type === "none") result = rec.update((t + r0.thresholds.gapMax + 0.05) * 1000);
    if (result.type !== "commit") safeCount++;
    else check("误差输入未误判为任何动作", false, `误判为 ${result.type}`);
  }
  check("抛竿的所有一次误差输入都不会提交动作", safeCount === badInputs.length);
}

// —— 6. 灰区按压必须报错 ——
{
  const lakeMap = new Map<string, GestureCode>();
  for (const m of r0.mappings.filter((x) => x.groupId === "lake"))
    lakeMap.set(m.actionId, m.code);
  const rec = new GestureRecognizer(
    () => lakeMap,
    () => r0.thresholds,
  );
  rec.pressDown(0);
  const mid = (r0.thresholds.short + r0.thresholds.long) / 2;
  const out = rec.pressUp(mid * 1000);
  check("灰区按压判为错误而非短/长按", out.type === "error");
}

// —— 7. 无解场景：maxPresses=1 ——
{
  const tight = { ...base, maxPresses: 1 };
  const r = solveAssist(tight);
  check("每手势 1 次按时湖畔组无解并报冲突", !r.ok &&
    r.conflicts.some((c) => c.id.startsWith("group-lake")));
}

// —— 8. 按压范围过窄无解 ——
{
  const narrow = { ...base, holdMin: 0.4, holdMax: 0.45 };
  const r = solveAssist(narrow);
  check("按压范围过窄产生冲突", !r.ok &&
    r.conflicts.some((c) => c.id === "hold-band" || c.id.includes("lock")));
}

// —— 9. strikeCap=0 且反应慢时提竿预算冲突 ——
{
  const slow = { ...base, reaction: 2.5, strikeCap: 0 };
  const r = solveAssist(slow);
  check("反应慢且禁止延长时提竿窗口冲突",
    r.conflicts.some((c) => c.id === "strike-window"));
}

// —— 10. 提竿延长不超过玩家上限 ——
{
  const cap = 0.5;
  const r = solveAssist({ ...base, reaction: 3, strikeCap: cap });
  check("采用延长不超过上限", r.strike.appliedExtension <= cap + 1e-9);
  check("需要延长大于上限时判定不可行", !r.strike.feasible);
}

// —— 11. 锁定映射被保留 ——
{
  const lake = r0.mappings.find((m) => m.groupId === "lake" && m.actionId === "strike")!;
  const locked = { ...base, locks: { strike: lake.code } };
  const r = solveAssist(locked);
  const again = r.mappings.find((m) => m.groupId === "lake" && m.actionId === "strike")!;
  check("锁定的提竿手势被保留", codeKey(again.code) === codeKey(lake.code) && again.locked);
}

// —— 12. 锁定超限时报冲突 ——
{
  const r = solveAssist({ ...base, maxPresses: 2, locks: { strike: ["S", "S", "S"] } });
  check("锁定手势超过按键上限报冲突",
    r.conflicts.some((c) => c.id === "lock-strike"));
}

// —— 13. 最坏响应时间为非负且包含静默等待 ——
check("全局最坏响应 > 0", r0.worstResponse > 0);
const prefixed = r0.mappings.find((m) => {
  const same = r0.mappings.filter((x) => x.groupId === m.groupId);
  return same.some((o) => o !== m && isOneErrorApart(m.code, o.code) === false &&
    o.code.length > m.code.length && o.code.slice(0, m.code.length).every((k, i) => k === m.code[i]));
});
if (prefixed) {
  const baseWorst = prefixed.code.reduce((s, k) =>
    s + (k === "S" ? r0.thresholds.short : r0.thresholds.long), 0)
    + (prefixed.code.length - 1) * r0.thresholds.gapMax + r0.thresholds.overhead;
  check("前缀码最坏耗时包含静默分隔等待",
    approx(prefixed.worst, baseWorst + r0.thresholds.sepWait));
}

// —— 14. 失焦 abort 清除未完成输入 ——
{
  const map = new Map([["strike", ["S", "L"] as GestureCode]]);
  const rec = new GestureRecognizer(() => map, () => r0.thresholds);
  rec.pressDown(0);
  rec.pressUp(r0.thresholds.short * 500);
  rec.abort("失焦");
  check("abort 后状态为错误且序列清空", rec.status.kind === "error");
  rec.clearError();
  check("重试后恢复 idle", rec.status.kind === "idle");
}

// —— 15. 码空间枚举正确 ——
check("长度 2 的码共 4 个", codesOfLength(2).length === 4);
check("长度 3 的码共 8 个", codesOfLength(3).length === 8);
check("邻居关系对称", isOneErrorApart(["S"], ["S", "S"]) &&
  isOneErrorApart(["S", "S"], ["S"]));

// —— 16. 极端宽松能力仍有解 ——
{
  const easy = { ...base, holdMin: 0.1, holdMax: 2, reaction: 0.2, maxPresses: 3 };
  const r = solveAssist(easy);
  // 3 次按、14 个湖畔动作且风险保护下可能无解，这是预期的诚实冲突
  if (!r.ok) {
    check("maxPresses=3 给出明确冲突而非崩溃", r.conflicts.length > 0);
  } else {
    check("maxPresses=3 若有解则全分组可用", r.availableGroups.length === 5);
  }
}

// —— 17. 二次确认流程：相同手势确认，不同手势取消，误差不确认 ——
{
  const lakeMap = new Map<string, GestureCode>();
  for (const m of r0.mappings.filter((x) => x.groupId === "lake"))
    lakeMap.set(m.actionId, m.code);
  const rec = new GestureRecognizer(() => lakeMap, () => r0.thresholds);
  const feed = (code: GestureCode) => {
    rec.reset();
    let t = 0;
    let out: ReturnType<GestureRecognizer["pressUp"]> = { type: "none" };
    code.forEach((k, i) => {
      const hold = k === "S" ? r0.thresholds.short * 0.5 : r0.thresholds.long + 0.1;
      rec.pressDown(t * 1000);
      t += hold;
      out = rec.pressUp(t * 1000);
      if (i < code.length - 1) t += 0.3;
    });
    if (out.type === "none")
      out = rec.update((t + r0.thresholds.gapMax + 0.05) * 1000);
    return out;
  };
  const cast = lakeMap.get("cast")!;
  const other = lakeMap.get("strike")!;
  check("重复抛竿手势可用于确认", feed(cast).type === "commit");
  const different = feed(other);
  check("不同手势产生不同动作（用于取消而非确认）",
    different.type === "commit" &&
    (different as { actionId: string }).actionId !== "cast");
  const erroneous = neighbors(cast)[0];
  const errOut = feed(erroneous);
  check("风险手势的一次误差不会被当成确认", errOut.type !== "commit");
}

console.log(`\n${passed} 通过, ${failed} 失败`);
if (failed) process.exit(1);
