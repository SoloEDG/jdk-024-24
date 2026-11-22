import type { GestureCode, PressKind } from "./types";

/** 所有同长度码按二进制序排列，S=0，L=1 */
export function codesOfLength(n: number): GestureCode[] {
  const out: GestureCode[] = [];
  const total = 2 ** n;
  for (let v = 0; v < total; v++) {
    const code: GestureCode = [];
    for (let bit = n - 1; bit >= 0; bit--) {
      code.push(((v >> bit) & 1) === 1 ? "L" : "S");
    }
    out.push(code);
  }
  return out;
}

export function codeKey(code: GestureCode): string {
  return code.join("");
}

export function codeLabel(code: GestureCode): string {
  return code
    .map((k) => (k === "S" ? "短按" : "长按"))
    .join(" → ");
}

export function pressCount(code: GestureCode): number {
  return code.length;
}

/** 一次偶发误差可能产生的全部相邻码：漏按、多点、长短翻转各一次 */
export function neighbors(code: GestureCode): GestureCode[] {
  const out: GestureCode[] = [];
  const seen = new Set<string>();
  const push = (c: GestureCode) => {
    const k = codeKey(c);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  };
  // 漏按：删除其中一次
  code.forEach((_, i) => push(code.filter((_, j) => j !== i)));
  // 多点：在任意位置多一次 S 或 L
  for (let i = 0; i <= code.length; i++) {
    push([...code.slice(0, i), "S", ...code.slice(i)]);
    push([...code.slice(0, i), "L", ...code.slice(i)]);
  }
  // 长短翻转：其中一次按反
  code.forEach((k, i) => {
    const flipped: GestureCode = [...code];
    flipped[i] = (k === "S" ? "L" : "S") as PressKind;
    push(flipped);
  });
  return out;
}

/** 两个码是否为“一次误差”关系 */
export function isOneErrorApart(a: GestureCode, b: GestureCode): boolean {
  if (a === b) return false;
  return neighbors(a).some((c) => codeKey(c) === codeKey(b));
}

/**
 * 最坏手势耗时：n 次按压（每次按到玩家可稳定做到的最长短按/最短长按边界）
 * 加上 n-1 个最大间隔。阈值由求解器给出。
 */
export function gestureWorst(
  code: GestureCode,
  t: { short: number; long: number; gapMax: number },
): number {
  const holds = code.reduce(
    (sum, k) => sum + (k === "S" ? t.short : t.long),
    0,
  );
  return holds + Math.max(0, code.length - 1) * t.gapMax;
}
