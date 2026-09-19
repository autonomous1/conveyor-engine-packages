/** JSON frames with canonical-v1-style bigint tags. */

export function encodeFrame(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? { $i: v.toString(10) } : v));
}

export function decodeFrame(text: string): unknown {
  return JSON.parse(text, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof (v as { $i?: unknown }).$i === "string") {
      return BigInt((v as { $i: string }).$i);
    }
    return v;
  });
}
