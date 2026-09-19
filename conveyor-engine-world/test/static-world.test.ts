import assert from "node:assert/strict";
import { test } from "node:test";
import { parseManifest, resolveStaticWorld } from "conveyor-engine-assets";
import { AuthoritativeWorld, applyStaticWorldDefinition } from "../dist/index.js";

const collision = {
  formatVersion: 1,
  representation: "aabb" as const,
  coordinateSystem: "y-up" as const,
  unitScale: 1,
  origin: { x: 0, y: 0, z: 0 },
  bounds: { minX: -24, maxX: 24, minY: -2, maxY: 8, minZ: -24, maxZ: 24 },
  spawnPoints: [
    { id: "spawn-a", x: -10, y: 0, z: 0, yaw: 0 },
    { id: "spawn-b", x: 10, y: 0, z: 0, yaw: 0 },
  ],
  aabbs: [
    { id: 1, minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
    { id: 2, minX: -14, maxX: -10, minZ: -6, maxZ: -2 },
    { id: 3, minX: 10, maxX: 14, minZ: 2, maxZ: 6 },
    { id: 4, minX: -8, maxX: 8, minZ: 18, maxZ: 22 },
  ],
};

test("world constructs from collision payload without a visual provider", () => {
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "example.arena.a2",
    bundleVersion: "1",
    assets: [
      {
        id: "c",
        kind: "static-collision-scene",
        authority: "authoritative-static",
        version: "1",
        contentHash: "sha256:" + "11".repeat(32),
        runtimeUri: "memory:c",
      },
    ],
  });
  const resolved = resolveStaticWorld({ manifest, collision, profile: "example-arena" });
  const w = new AuthoritativeWorld({ worldVersion: "t" });
  applyStaticWorldDefinition(w, resolved.definition);
  assert.equal(w.bundleId, "example.arena.a2");
  assert.equal(w.listSpawnPoints().length, 2);
  assert.equal(w.listObstacles().length, 4);
  assert.equal(w.selectSpawn(1).id, "spawn-a");
  assert.equal(w.selectSpawn(2).id, "spawn-b");
  const e = w.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  w.enqueue({
    kind: "setTransform",
    entity: e,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  w.enqueue({ kind: "setBounds", entity: e, radius: 0.5 });
  w.commit(1n);
  const pos = w.store.view(e)!.position;
  assert.ok(pos.x <= -2.5 || pos.x >= 2.5 || pos.z <= -2.5 || pos.z >= 2.5);
});

test("world bounds clamp escape and appear in canonical identity", () => {
  const w = new AuthoritativeWorld();
  w.setWorldBounds({ minX: -4, maxX: 4, minY: 0, maxY: 4, minZ: -4, maxZ: 4 });
  w.setBundleIdentity("b", "h");
  const e = w.createEntity(0n, { type: "p", shape: "box" });
  w.enqueue({
    kind: "setTransform",
    entity: e,
    position: { x: 40, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  w.commit(1n);
  assert.ok(w.store.view(e)!.position.x <= 4);
  const json = w.canonicalPlain();
  assert.equal(json.bundleId, "b");
  assert.equal(json.authoritativeHash, "h");
});
