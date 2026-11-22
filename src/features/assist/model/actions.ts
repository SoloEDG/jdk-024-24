import type { AssistAction } from "./types";

/**
 * 单键辅助需要覆盖的全部动作。
 * risky 动作（扣饵 / 放流 / 领奖）必须经过二次确认，识别器绝不允许
 * 把带单次误差的输入直接判成它们。
 */
export const ASSIST_ACTIONS: AssistAction[] = [
  // —— 湖畔主舞台，按阶段可用 ——
  {
    id: "cast",
    label: "抛竿（开始蓄力并抛出）",
    desc: "进入蓄力并按当前力度抛出，会消耗一枚鱼饵",
    context: "lake",
    phases: ["ready"],
    risk: "risky",
  },
  {
    id: "strike",
    label: "提竿",
    desc: "咬钩时抓住时机提竿",
    context: "lake",
    phases: ["bite"],
    risk: "safe",
  },
  {
    id: "reel-on",
    label: "收线（按住）",
    desc: "溜鱼时按住收线，把鱼拉向岸边",
    context: "lake",
    phases: ["fighting"],
    risk: "safe",
  },
  {
    id: "reel-off",
    label: "松线（松开）",
    desc: "张力过高时松开，让鱼线歇一歇",
    context: "lake",
    phases: ["fighting"],
    risk: "safe",
  },
  {
    id: "power-up",
    label: "力度 +",
    desc: "调高收线力度",
    context: "lake",
    phases: ["fighting", "ready"],
    risk: "safe",
  },
  {
    id: "power-down",
    label: "力度 −",
    desc: "调低收线力度",
    context: "lake",
    phases: ["fighting", "ready"],
    risk: "safe",
  },
  {
    id: "drag-up",
    label: "泄力 +",
    desc: "调高泄力设置（仅准备阶段）",
    context: "lake",
    phases: ["ready"],
    risk: "safe",
  },
  {
    id: "drag-down",
    label: "泄力 −",
    desc: "调低泄力设置（仅准备阶段）",
    context: "lake",
    phases: ["ready"],
    risk: "safe",
  },
  {
    id: "next",
    label: "再来一竿 / 继续",
    desc: "收获或脱钩后回到准备状态",
    context: "lake",
    phases: ["landed", "escaped"],
    risk: "safe",
  },

  // —— 扫描菜单 ——
  {
    id: "scan-next",
    label: "扫描下一项",
    desc: "在钓点 / 鱼饵 / 鱼获 / 奖励间移动高亮",
    context: "spots",
    risk: "safe",
  },
  {
    id: "scan-prev",
    label: "扫描上一项",
    desc: "反向移动高亮",
    context: "spots",
    risk: "safe",
  },
  {
    id: "menu-spots",
    label: "打开钓点选择",
    desc: "扫描三个钓点",
    context: "spots",
    risk: "safe",
  },
  {
    id: "menu-baits",
    label: "打开鱼饵选择",
    desc: "扫描三种鱼饵",
    context: "baits",
    risk: "safe",
  },
  {
    id: "menu-bag",
    label: "打开鱼获背包",
    desc: "扫描已捕获的鱼",
    context: "bag",
    risk: "safe",
  },
  {
    id: "menu-challenges",
    label: "打开挑战与奖励",
    desc: "扫描可领取的奖励",
    context: "challenges",
    risk: "safe",
  },
  {
    id: "menu-back",
    label: "返回湖畔",
    desc: "关闭扫描菜单",
    context: "spots",
    risk: "safe",
  },
  {
    id: "confirm",
    label: "确认选择",
    desc: "确认当前高亮项；风险项需再确认一次",
    context: "spots",
    risk: "safe",
  },
  {
    id: "release",
    label: "放流当前鱼获",
    desc: "把背包中高亮的鱼放流（不可撤销）",
    context: "bag",
    risk: "risky",
  },
  {
    id: "claim",
    label: "领取奖励",
    desc: "领取高亮挑战的奖励（不可撤销）",
    context: "challenges",
    risk: "risky",
  },
  {
    id: "resupply",
    label: "补给鱼饵",
    desc: "重置三种鱼饵库存",
    context: "baits",
    risk: "safe",
  },
];

export const RISKY_ACTION_IDS = new Set(
  ASSIST_ACTIONS.filter((a) => a.risk === "risky").map((a) => a.id),
);

export function actionById(id: string): AssistAction {
  const a = ASSIST_ACTIONS.find((x) => x.id === id);
  if (!a) throw new Error(`unknown assist action ${id}`);
  return a;
}
