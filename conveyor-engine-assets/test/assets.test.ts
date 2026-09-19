import assert from "node:assert/strict";
import { test } from "node:test";
import { AssetManifest, BUILTIN_PRIMITIVES } from "../src/index.ts";

test("builtin primitives resolve; unknown key is a placeholder", () => {
  const m = new AssetManifest();
  assert.ok(m.has("primitive/capsule"));
  const pawn = m.resolve("primitive/capsule");
  assert.equal(pawn.shape, "capsule");
  assert.equal(pawn.type, "pawn");
  assert.equal(pawn.assetKey, "primitive/capsule");
  const missing = m.resolve("mesh/hero");
  assert.equal(missing.type, "placeholder");
  assert.equal(missing.shape, "box");
});

test("register and loadJson do not mutate world-shaped state", () => {
  const m = new AssetManifest([]);
  assert.equal(m.keys().length, 0);
  m.register({ key: "mat/wood", kind: "material", material: "wood", color: 0x886644 });
  const n = m.loadJson(JSON.stringify({
    assets: [
      { key: "primitive/crate", kind: "primitive", shape: "box", type: "crate", color: 0x553311 },
    ],
  }));
  assert.equal(n, 1);
  assert.deepEqual(m.keys(), ["mat/wood", "primitive/crate"]);
  const crate = m.resolve("primitive/crate");
  assert.equal(crate.color, 0x553311);
  assert.equal(BUILTIN_PRIMITIVES.length, 6);
});
