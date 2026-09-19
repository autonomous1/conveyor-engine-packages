/** Ingress numeric policy: reject non-finite values. */

export function isLegalNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0);
}

export function assertLegalNumber(value: unknown, label = "number"): number {
  if (typeof value !== "number") throw new Error(`${label}: not a number`);
  if (Number.isNaN(value)) throw new Error(`${label}: NaN`);
  if (value === Infinity || value === -Infinity) throw new Error(`${label}: non-finite`);
  if (Object.is(value, -0)) throw new Error(`${label}: -0`);
  return value;
}

export function isSafeSeq(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && Number.isSafeInteger(value);
}
