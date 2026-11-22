import type { GestureCode, PressKind, RecognizerStatus, Thresholds } from "./types";
import { codeKey } from "./codes";

export interface RecognitionResult {
  /** 识别成功，返回动作 id（可能为待确认的风险动作） */
  type: "commit";
  actionId: string;
}
export type RecognizerUpdate =
  | RecognitionResult
  | { type: "none" }
  | { type: "error"; reason: string };

interface RecState {
  sequence: PressKind[];
  /** 每次松手的时间戳，用于间隔超时 */
  releaseAt: number[];
  errorLocked: boolean;
  errorReason: string;
  holding: boolean;
  holdStart: number;
}

function isPrefix(prefix: PressKind[], code: GestureCode): boolean {
  if (prefix.length >= code.length) return false;
  return prefix.every((k, i) => code[i] === k);
}

/**
 * 单键手势识别器。
 * 规则：
 * - 短于 short 判短按，长于 long 判长按，落入灰区直接判误触（错误锁定，等重置）；
 * - 序列一旦无法成为任何已分配手势的前缀即报错，绝不猜测；
 * - 精确匹配且不是更长码的前缀时立即提交，不额外等待；
 * - 仍是某更长码前缀时静默等待 gapMax，超时后能匹配则提交、否则报错；
 * - 错误锁定期间一切输入被忽略，保证漏按/多点不会被误认成另一个动作。
 */
export class GestureRecognizer {
  private state: RecState = fresh();
  constructor(
    private getCodes: () => Map<string, GestureCode>,
    private thresholds: () => Thresholds,
  ) {}

  reset(): void {
    this.state = fresh();
  }

  /** 玩家点击“重试”：清掉错误锁定，开新手势 */
  clearError(): void {
    if (this.state.errorLocked) this.state = fresh();
  }

  /** 失焦 / 切阶段：清除未完成输入 */
  abort(reason = "未完成的输入已清除"): void {
    if (this.state.sequence.length || this.state.holding) {
      this.state = { ...fresh(), errorLocked: true, errorReason: reason };
    } else {
      this.state = fresh();
    }
  }

  get status(): RecognizerStatus {
    if (this.state.errorLocked)
      return {
        kind: "error",
        message: this.state.errorReason,
        sequence: [...this.state.sequence],
      };
    if (this.state.sequence.length)
      return {
        kind: "partial",
        message: `已输入 ${this.state.sequence
          .map((k) => (k === "S" ? "短" : "长"))
          .join("·")}，继续或稍候`,
        sequence: [...this.state.sequence],
      };
    return { kind: "idle", message: "等待输入", sequence: [] };
  }

  get liveHold(): number | null {
    return this.state.holding ? performance.now() - this.state.holdStart : null;
  }

  pressDown(now: number): void {
    if (this.state.errorLocked) return;
    // 上一手势已在超时处提交/报错：新按压先开新序列
    this.state.holding = true;
    this.state.holdStart = now;
  }

  pressUp(now: number): RecognizerUpdate {
    if (!this.state.holding || this.state.errorLocked) return { type: "none" };
    this.state.holding = false;
    const t = this.thresholds();
    const dur = (now - this.state.holdStart) / 1000;
    let kind: PressKind;
    if (dur <= t.short) kind = "S";
    else if (dur >= t.long) kind = "L";
    else {
      return this.fail(
        `这次按压 ${dur.toFixed(2)}s 落在短按/长按之间的灰区，手势作废，请重试。`,
      );
    }
    this.state.sequence.push(kind);
    this.state.releaseAt.push(now);
    return this.evaluate(now);
  }

  /** 由外部 rAF 驱动，处理静默分隔超时 */
  update(now: number): RecognizerUpdate {
    if (this.state.errorLocked || this.state.holding) return { type: "none" };
    if (!this.state.sequence.length) return { type: "none" };
    const t = this.thresholds();
    const last = this.state.releaseAt[this.state.releaseAt.length - 1];
    if ((now - last) / 1000 < t.gapMax) return { type: "none" };
    // 静默等待结束：能精确匹配则提交，否则报错
    const match = this.matchExact();
    if (match) {
      const actionId = match;
      this.reset();
      return { type: "commit", actionId };
    }
    return this.fail("间隔超时且没有匹配的手势，输入已作废，请重试。");
  }

  private evaluate(now: number): RecognizerUpdate {
    const assigned = [...this.getCodes().values()];
    const seq = this.state.sequence;
    const exact = this.matchExact();
    const canExtend = assigned.some((c) => isPrefix(seq, c));
    if (exact && !canExtend) {
      const actionId = exact;
      this.reset();
      return { type: "commit", actionId };
    }
    if (!exact && !canExtend) {
      return this.fail(
        `序列 ${seq.map((k) => (k === "S" ? "短" : "长")).join("·")} 不对应任何手势，可能漏按或多按了一次，请重试。`,
      );
    }
    // 精确但同时是更长码前缀：静默等待 gapMax（等待计入响应延迟）
    void now;
    return { type: "none" };
  }

  private matchExact(): string | undefined {
    const key = codeKey(this.state.sequence);
    for (const [actionId, code] of this.getCodes()) {
      if (codeKey(code) === key) return actionId;
    }
    return undefined;
  }

  private fail(reason: string): RecognizerUpdate {
    this.state.errorLocked = true;
    this.state.errorReason = reason;
    this.state.holding = false;
    return { type: "error", reason };
  }
}

function fresh(): RecState {
  return {
    sequence: [],
    releaseAt: [],
    errorLocked: false,
    errorReason: "",
    holding: false,
    holdStart: 0,
  };
}
