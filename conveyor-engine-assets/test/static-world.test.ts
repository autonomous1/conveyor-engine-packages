import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hashStaticWorld,
  parseManifest,
  resolvePresentation,
  resolveStaticWorld,
  StaticWorldError,
  validateStaticWorld,
} from "../dist/index.js";

const collision = {
  formatVersion: 1,
  representation: "aabb",
  coordinateSystem: "y-up",
  unitScale: 1,
  origin: { x: 0, y: 0, z: 0 },
  bounds: { minX: -24, maxX: 24, minY: -2, maxY: 8, minZ: -24, maxZ: 24 },
  spawnPoints: [
    { id: "spawn-a", x: -10, y: 0, z: 0, yaw: 0 },
    { id: "spawn-b", x: 10, y: 0, z: 0, yaw: 3.14 },
  ],
  aabbs: [
    { id: 1, minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
    { id: 2, minX: -16, maxX: -12, minZ: -8, maxZ: -4 },
    { id: 3, minX: 12, maxX: 16, minZ: 4, maxZ: 8 },
    { id: 4, minX: -8, maxX: 8, minZ: 18, maxZ: 22 },
  ],
};

function manifest(extra: Record<string, unknown> = {}) {
  return parseManifest({
    formatVersion: 1,
    bundleId: "example.arena.a2",
    bundleVersion: "1",
    schemaVersion: "static-world-v1",
    assets: [
      {
        id: "arena.collision",
        kind: "static-collision-scene",
        authority: "authoritative-static",
        version: "1.0.0",
        contentHash: "sha256:" + "ab".repeat(32),
        runtimeUri: "memory:c",
      },
      {
        id: "arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "1.0.0",
        contentHash: "sha256:" + "cd".repeat(32),
        runtimeUri: "memory:v",
        runtimePolicy: { fallbackAssetId: "primitive/box" },
      },
    ],
    ...extra,
  });
}

test("valid arena bundle resolves and hashes stably", () => {
  const a = resolveStaticWorld({ manifest: manifest(), collision, profile: "example-arena" });
  const b = resolveStaticWorld({ manifest: manifest(), collision, profile: "example-arena" });
  assert.equal(a.hash, b.hash);
  assert.equal(a.definition.spawnPoints.length, 2);
  assert.equal(a.definition.aabbs.length, 4);
  assert.equal(validateStaticWorld(a.definition, "example-arena").ok, true);
});

test("key reorder of compatibility record does not change hash", () => {
  const resolved = resolveStaticWorld({ manifest: manifest(), collision, profile: "example-arena" });
  const flipped = { ...resolved.definition, aabbs: [...resolved.definition.aabbs].reverse() };
  assert.equal(hashStaticWorld(flipped), resolved.hash);
});

test("visual-only change does not change authoritative hash", () => {
  const a = resolveStaticWorld({ manifest: manifest(), collision, profile: "example-arena" });
  const other = parseManifest({
    formatVersion: 1,
    bundleId: "example.arena.a2",
    bundleVersion: "1",
    schemaVersion: "static-world-v1",
    assets: [
      {
        id: "arena.collision",
        kind: "static-collision-scene",
        authority: "authoritative-static",
        version: "1.0.0",
        contentHash: "sha256:" + "ab".repeat(32),
        runtimeUri: "memory:c",
      },
      {
        id: "arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "2.0.0",
        contentHash: "sha256:" + "ef".repeat(32),
        runtimeUri: "memory:v2",
        runtimePolicy: { fallbackAssetId: "primitive/box" },
      },
    ],
  });
  const b = resolveStaticWorld({ manifest: other, collision, profile: "example-arena" });
  assert.equal(a.hash, b.hash);
});

test("collision hash or spawn change changes authoritative hash", () => {
  const a = resolveStaticWorld({ manifest: manifest(), collision, profile: "example-arena" });
  const moved = {
    ...collision,
    spawnPoints: [
      { id: "spawn-a", x: -11, y: 0, z: 0, yaw: 0 },
      { id: "spawn-b", x: 10, y: 0, z: 0, yaw: 3.14 },
    ],
  };
  const b = resolveStaticWorld({ manifest: manifest(), collision: moved, profile: "example-arena" });
  assert.notEqual(a.hash, b.hash);
  const box = {
    ...collision,
    aabbs: collision.aabbs.map((x, i) => (i === 0 ? { ...x, maxX: 3 } : x)),
  };
  const c = resolveStaticWorld({ manifest: manifest(), collision: box, profile: "example-arena" });
  assert.notEqual(a.hash, c.hash);
});

test("invalid fixtures fail validation", () => {
  assert.throws(
    () => resolveStaticWorld({ manifest: manifest(), collision: { ...collision, spawnPoints: [collision.spawnPoints[0]] }, profile: "example-arena" }),
    StaticWorldError,
  );
  assert.throws(
    () =>
      resolveStaticWorld({
        manifest: manifest(),
        collision: { ...collision, spawnPoints: [{ id: "bad", x: 100, z: 0 }, collision.spawnPoints[1]] },
        profile: "example-arena",
      }),
    StaticWorldError,
  );
  assert.throws(
    () =>
      resolveStaticWorld({
        manifest: manifest(),
        collision: { ...collision, spawnPoints: [{ id: "in-box", x: 0, z: 0 }, collision.spawnPoints[1]] },
        profile: "example-arena",
      }),
    StaticWorldError,
  );
});

test("presentation resolver fallback does not depend on authoritative hash", () => {
  const visual = manifest().assets.find((a) => a.id === "arena.visual")!;
  const ready = resolvePresentation(visual, "ready");
  const miss = resolvePresentation(visual, "missing");
  assert.equal(ready.state, "ready");
  assert.equal(miss.state, "degraded");
  assert.equal(miss.usedFallback, true);
  assert.equal(miss.fallbackAssetId, "primitive/box");
});
