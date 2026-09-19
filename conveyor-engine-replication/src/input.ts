import { ErrorCategory, isValidClientId, isLegalNumber, isSafeSeq, type InputSeq } from "conveyor-engine-core";
import type { ValidatedInput } from "./types.js";

export type InputPolicy = {
  maxAbsMove: number;
  maxFuture: number;
  maxBytes: number;
  maxPerTick: number;
};

export const DEFAULT_INPUT_POLICY: InputPolicy = {
  maxAbsMove: 1,
  maxFuture: 8,
  maxBytes: 512,
  maxPerTick: 8,
};

export type InputAdmitResult =
  | { ok: true; input: ValidatedInput }
  | { ok: false; category: string; reason: string };

export type RawInput = {
  clientId: unknown;
  seq: unknown;
  moveX?: unknown;
  moveZ?: unknown;
  yaw?: unknown;
  buttons?: unknown;
  position?: unknown;
  velocity?: unknown;
  entity?: unknown;
};

export function validateInput(
  raw: RawInput,
  lastProcessed: InputSeq,
  policy: InputPolicy = DEFAULT_INPUT_POLICY,
): InputAdmitResult {
  const bytes = estimateBytes(raw);
  if (bytes > policy.maxBytes) {
    return { ok: false, category: ErrorCategory.InputSchema, reason: "oversized" };
  }
  if (!isValidClientId(raw.clientId)) {
    return { ok: false, category: ErrorCategory.Session, reason: "bad-client" };
  }
  if (raw.position !== undefined || raw.velocity !== undefined) {
    return { ok: false, category: ErrorCategory.InputSchema, reason: "claimed-authority" };
  }
  if (!isSafeSeq(raw.seq)) {
    return { ok: false, category: ErrorCategory.InputSequence, reason: "bad-seq" };
  }
  if (raw.seq <= lastProcessed) {
    return { ok: false, category: ErrorCategory.InputSequence, reason: "duplicate-or-old" };
  }
  if (raw.seq > lastProcessed + policy.maxFuture) {
    return { ok: false, category: ErrorCategory.InputSequence, reason: "future" };
  }
  const moveX = boundAxis(raw.moveX, policy.maxAbsMove, "moveX");
  if (moveX === undefined) return { ok: false, category: ErrorCategory.InputSchema, reason: "bad-moveX" };
  const moveZ = boundAxis(raw.moveZ, policy.maxAbsMove, "moveZ");
  if (moveZ === undefined) return { ok: false, category: ErrorCategory.InputSchema, reason: "bad-moveZ" };
  if (raw.yaw !== undefined && !isLegalNumber(raw.yaw)) {
    return { ok: false, category: ErrorCategory.InputSchema, reason: "bad-yaw" };
  }
  const yaw = raw.yaw === undefined ? 0 : (raw.yaw as number);
  const buttons = raw.buttons === undefined ? 0 : Number(raw.buttons);
  if (raw.buttons !== undefined && !Number.isFinite(buttons)) {
    return { ok: false, category: ErrorCategory.InputSchema, reason: "bad-buttons" };
  }
  return {
    ok: true,
    input: {
      clientId: raw.clientId,
      seq: raw.seq,
      moveX,
      moveZ,
      yaw,
      buttons: buttons | 0,
      entity: typeof raw.entity === "number" ? raw.entity : undefined,
    },
  };
}

function boundAxis(v: unknown, max: number, _label: string): number | undefined {
  if (v === undefined) return 0;
  if (!isLegalNumber(v)) return undefined;
  return Math.max(-max, Math.min(max, v));
}

function estimateBytes(raw: RawInput): number {
  try {
    return JSON.stringify(raw).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}
