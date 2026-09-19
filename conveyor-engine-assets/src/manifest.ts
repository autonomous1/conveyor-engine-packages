import type { AssetKey, AssetRecord, RenderRef } from "./types.js";

export const BUILTIN_PRIMITIVES: AssetRecord[] = [
  { key: "primitive/box", kind: "primitive", shape: "box", type: "prop" },
  { key: "primitive/sphere", kind: "primitive", shape: "sphere", type: "prop" },
  { key: "primitive/capsule", kind: "primitive", shape: "capsule", type: "pawn" },
  { key: "primitive/plane", kind: "primitive", shape: "plane", type: "ground" },
  { key: "primitive/line", kind: "primitive", shape: "line", type: "debug" },
  { key: "primitive/point", kind: "primitive", shape: "point", type: "debug" },
];

export class AssetManifest {
  private readonly records = new Map<AssetKey, AssetRecord>();

  constructor(seed: Iterable<AssetRecord> = BUILTIN_PRIMITIVES) {
    for (const rec of seed) this.register(rec);
  }

  register(rec: AssetRecord): void {
    if (!rec.key) throw new Error("asset key required");
    this.records.set(rec.key, { ...rec });
  }

  get(key: AssetKey): AssetRecord | undefined {
    return this.records.get(key);
  }

  has(key: AssetKey): boolean {
    return this.records.has(key);
  }

  keys(): AssetKey[] {
    return [...this.records.keys()].sort();
  }

  /** Map a catalog key to a client/three RenderKey-shaped ref. Missing keys stay placeholders. */
  resolve(key: AssetKey): RenderRef {
    const rec = this.records.get(key);
    if (!rec) {
      return { type: "placeholder", shape: "box", assetKey: key };
    }
    return {
      type: rec.type ?? rec.kind,
      shape: rec.shape ?? "box",
      color: rec.color,
      material: rec.material,
      assetKey: rec.key,
    };
  }

  loadJson(text: string): number {
    const parsed = JSON.parse(text) as unknown;
    const list = Array.isArray(parsed) ? parsed : (parsed as { assets?: unknown }).assets;
    if (!Array.isArray(list)) throw new Error("asset json must be an array or { assets: [] }");
    let n = 0;
    for (const item of list) {
      if (!item || typeof item !== "object" || typeof (item as AssetRecord).key !== "string") continue;
      this.register(item as AssetRecord);
      n++;
    }
    return n;
  }
}
