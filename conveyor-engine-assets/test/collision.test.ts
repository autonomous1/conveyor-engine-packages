import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssetRuntime,
  CollisionParseError,
  FixtureRegistry,
  collisionFromPayload,
  collisionToObstacles,
  hashBytes,
  parseCollisionArtifact,
  parseManifest,
} from "../src/index.ts";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const aabbDoc = {
  formatVersion: 1,
  representation: "aabb",
  coordinateSystem: "y-up",
  unitScale: 1,
  origin: { x: 0, y: 0, z: 0 },
  bounds: { minX: -10, maxX: 10, minY: 0, maxY: 4, minZ: -10, maxZ: 10 },
  visualAssetId: "arena.visual",
  aabbs: [
    { id: 1, minX: -2, maxX: 2, minZ: 4, maxZ: 6 },
    { id: 2, minX: 5, maxX: 7, minZ: -1, maxZ: 1 },
  ],
};

test("parseCollisionArtifact accepts aabb and flattens to world obstacles", () => {
  const artifact = parseCollisionArtifact(aabbDoc);
  assert.equal(artifact.representation, "aabb");
  assert.equal(artifact.visualAssetId, "arena.visual");
  const obstacles = collisionToObstacles(artifact);
  assert.deepEqual(obstacles, [
    { id: 1, minX: -2, maxX: 2, minZ: 4, maxZ: 6 },
    { id: 2, minX: 5, maxX: 7, minZ: -1, maxZ: 1 },
  ]);
  assert.equal("shape" in obstacles[0]!, false);
  assert.equal("material" in obstacles[0]!, false);
});

test("triangle mesh, grid, and primitives parse and flatten", () => {
  const mesh = parseCollisionArtifact({
    formatVersion: 1,
    representation: "triangle-mesh",
    coordinateSystem: "y-up",
    unitScale: 1,
    origin: { x: 0, y: 0, z: 0 },
    bounds: { minX: 0, maxX: 2, minY: 0, maxY: 1, minZ: 0, maxZ: 2 },
    mesh: {
      positions: [0, 0, 0, 2, 0, 0, 0, 0, 2],
      indices: [0, 1, 2],
    },
  });
  assert.equal(collisionToObstacles(mesh).length, 1);

  const grid = parseCollisionArtifact({
    formatVersion: 1,
    representation: "occupancy-grid",
    coordinateSystem: "y-up",
    unitScale: 1,
    origin: { x: 0, y: 0, z: 0 },
    bounds: { minX: 0, maxX: 4, minY: 0, maxY: 1, minZ: 0, maxZ: 2 },
    grid: { originX: 0, originZ: 0, cellSize: 2, width: 2, depth: 1, cells: [1, 0] },
  });
  assert.deepEqual(collisionToObstacles(grid), [{ id: 1, minX: 0, maxX: 2, minZ: 0, maxZ: 2 }]);

  const prims = parseCollisionArtifact({
    formatVersion: 1,
    representation: "primitives",
    coordinateSystem: "y-up",
    unitScale: 1,
    origin: { x: 0, y: 0, z: 0 },
    bounds: { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -1, maxZ: 1 },
    primitives: [{ type: "sphere", id: 9, x: 0, z: 0, radius: 1 }],
  });
  assert.deepEqual(collisionToObstacles(prims)[0], { id: 9, minX: -1, maxX: 1, minZ: -1, maxZ: 1 });
});

test("rejects three/render fields, non-finite values, and empty mesh", () => {
  assert.throws(
    () => parseCollisionArtifact({ ...aabbDoc, material: "pbr" }),
    CollisionParseError,
  );
  assert.throws(
    () =>
      parseCollisionArtifact({
        ...aabbDoc,
        aabbs: [{ id: 1, minX: Infinity, maxX: 1, minZ: 0, maxZ: 1 }],
      }),
    CollisionParseError,
  );
  assert.throws(
    () =>
      parseCollisionArtifact({
        formatVersion: 1,
        representation: "triangle-mesh",
        coordinateSystem: "y-up",
        unitScale: 1,
        origin: { x: 0, y: 0, z: 0 },
        bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 },
        mesh: { positions: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [] },
      }),
    CollisionParseError,
  );
});

test("AssetRuntime loads collision json without a three module", async () => {
  assert.equal(Object.hasOwn(process.versions, "three"), false);
  const json = JSON.stringify(aabbDoc);
  const fixtures = new FixtureRegistry().success("memory:collision", json);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "arena.collision",
        kind: "static-collision-scene",
        authority: "authoritative-static",
        version: "1.0.0",
        contentHash: hashBytes(bytes(json)),
        runtimeUri: "memory:collision",
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const handle = await runtime.request("arena.collision");
  assert.equal(handle.payload?.kind, "json");
  const artifact = collisionFromPayload(handle.payload!);
  const obstacles = collisionToObstacles(artifact);
  assert.equal(obstacles.length, 2);
  assert.equal(handle.entry.authority, "authoritative-static");
  handle.release();
});
