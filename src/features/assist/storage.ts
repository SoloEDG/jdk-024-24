import type { AssistProfile, GestureCode } from "./model/types";
import { defaultTiming } from "./model/solver";

const key = "stillwater-jdk024-assist-v1";

function sanitizeLocks(value: unknown): Record<string, GestureCode> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, GestureCode> = {};
  for (const [k, raw] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof k === "string" &&
      Array.isArray(raw) &&
      raw.every((x) => x === "S" || x === "L")
    ) {
      out[k] = raw as GestureCode;
    }
  }
  return out;
}

export function loadAssistProfile(): AssistProfile {
  const fallback = defaultTiming();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<AssistProfile>;
    const num = (v: unknown, d: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : d;
    return {
      ...fallback,
      ...p,
      holdMin: num(p.holdMin, fallback.holdMin),
      holdMax: num(p.holdMax, fallback.holdMax),
      reaction: num(p.reaction, fallback.reaction),
      maxPresses:
        typeof p.maxPresses === "number" && Number.isInteger(p.maxPresses)
          ? p.maxPresses
          : fallback.maxPresses,
      strikeCap: num(p.strikeCap, fallback.strikeCap),
      scanDwell: num(p.scanDwell, fallback.scanDwell),
      autoStrike: p.autoStrike !== false,
      autoRelief: p.autoRelief !== false,
      autoCastAtPeak: p.autoCastAtPeak !== false,
      enabled: p.enabled === true,
      locks: sanitizeLocks(p.locks),
    };
  } catch {
    return fallback;
  }
}

export function saveAssistProfile(profile: AssistProfile): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}
