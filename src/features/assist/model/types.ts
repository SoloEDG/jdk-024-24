import type { Phase } from "../../../shared/types";

export type PressKind = "S" | "L";
/** 手势编码：一组短按(S)/长按(L)，如 ["S","L"] = 短按后长按 */
export type GestureCode = PressKind[];

export type AssistContext =
  | "lake"
  | "spots"
  | "baits"
  | "bag"
  | "challenges";

/** 玩家填写的身体能力限制与辅助开关 */
export interface TimingConfig {
  /** 能完成的按压时长范围（秒） */
  holdMin: number;
  holdMax: number;
  /** 反应延迟（秒）：看到提示到开始动作 */
  reaction: number;
  /** 每个手势最多按几次 */
  maxPresses: number;
  /** 提竿（咬钩）窗口允许延长的上限（秒） */
  strikeCap: number;
  /** 扫描驻留秒数；0 表示手动扫描 */
  scanDwell: number;
  autoStrike: boolean;
  autoRelief: boolean;
  autoCastAtPeak: boolean;
}

export interface AssistProfile extends TimingConfig {
  enabled: boolean;
  /** 玩家锁定的熟悉映射：动作键 -> 手势 */
  locks: Record<string, GestureCode>;
}

export type RiskLevel = "safe" | "risky";

export interface AssistAction {
  /** 全局唯一动作键 */
  id: string;
  label: string;
  desc: string;
  context: AssistContext;
  /** lake 上下文下可用的游戏阶段；菜单上下文为空 */
  phases?: Phase[];
  /** risky = 会扣饵 / 放流 / 领奖，必须进入二次确认 */
  risk: RiskLevel;
}

export interface MappingEntry {
  actionId: string;
  label: string;
  groupId: string;
  code: GestureCode;
  locked: boolean;
  risk: RiskLevel;
  /** 该手势从首次按下到指令发出的最坏耗时（秒） */
  worst: number;
}

export interface Conflict {
  id: string;
  message: string;
  related: string[];
}

export interface Thresholds {
  /** 松手时长 <= short 判为短按 */
  short: number;
  /** 松手时长 >= long 判为长按 */
  long: number;
  /** 灰区宽度 long-short */
  band: number;
  /** 手势内两次按压允许的最大间隔 */
  gapMax: number;
  /** 混用不同长度码时的静默分隔等待 */
  sepWait: number;
  /** 帧节拍与派发固定开销 */
  overhead: number;
}

export interface StrikeBudget {
  /** 反应 + 提竿手势最坏耗时 */
  demand: number;
  /** 游戏原始咬钩窗口 */
  baseWindow: number;
  /** 实际需要的延长 */
  neededExtension: number;
  /** 受上限约束后采用的延长 */
  appliedExtension: number;
  totalBudget: number;
  feasible: boolean;
}

export interface SolveResult {
  ok: boolean;
  mappings: MappingEntry[];
  thresholds: Thresholds;
  /** 全局最坏响应时间（秒，不含反应） */
  worstResponse: number;
  strike: StrikeBudget;
  /** 成功解出的可用阶段/分组 */
  availableGroups: string[];
  conflicts: Conflict[];
  warnings: string[];
  /** 风险动作在一次漏按/多按/长短翻转下的相邻码分析 */
  riskNotes: string[];
}

export interface RecognizerStatus {
  kind: "idle" | "partial" | "committed" | "error";
  message: string;
  sequence: PressKind[];
}
