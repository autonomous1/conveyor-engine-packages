import type { ContentHash } from "./types.js";

const HASH_RE = /^sha256:[0-9a-f]{64}$/;

export type BytesHasher = (bytes: Uint8Array) => ContentHash;

let hasher: BytesHasher = defaultSha256;

/** Override the SHA-256 implementation (tests, WebCrypto wrapper, host policy). */
export function setBytesHasher(next: BytesHasher | undefined): void {
  hasher = next ?? defaultSha256;
}

export function isContentHash(value: string): value is ContentHash {
  return HASH_RE.test(value);
}

export function hashBytes(bytes: Uint8Array | ArrayBuffer): ContentHash {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return hasher(buf);
}

export function hashUtf8(text: string): ContentHash {
  return hashBytes(new TextEncoder().encode(text));
}

/** Stable JSON hash: sorted keys, no undefined, no functions. */
export function hashCanonicalJson(value: unknown): ContentHash {
  return hashUtf8(canonicalJson(value));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "function" || typeof value === "symbol") {
    throw new Error("canonical json cannot include functions or symbols");
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sortValue);
  if (value instanceof Uint8Array) {
    return { $bytes: bytesToBase64(value) };
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const v = obj[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  if (typeof btoa === "function") return btoa(bin);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const triple = (a << 16) | (b << 8) | c;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return out;
}

/** Portable sync SHA-256 so the package does not import `node:crypto`. */
function defaultSha256(bytes: Uint8Array): ContentHash {
  return `sha256:${sha256Hex(bytes)}`;
}

function sha256Hex(bytes: Uint8Array): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const pad = (64 - ((withOne + 8) % 64)) % 64;
  const total = withOne + pad + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(total - 4, bitLen >>> 0, false);
  const hi = Math.floor(bitLen / 0x100000000);
  view.setUint32(total - 8, hi >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let i = 0; i < total; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15]!;
      const y = w[t - 2]!;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t]! + w[t]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((n) => n.toString(16).padStart(8, "0")).join("");
}

function rotr(n: number, s: number): number {
  return (n >>> s) | (n << (32 - s));
}
