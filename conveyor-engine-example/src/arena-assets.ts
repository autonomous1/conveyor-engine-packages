import {
  FixtureRegistry,
  encodeGlb,
  hashBytes,
  hashUtf8,
  parseManifest,
  resolveStaticWorld,
  type EngineManifest,
  type StaticWorldDefinition,
} from "conveyor-engine-assets";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export const ARENA_BUNDLE_ID = "example.arena.a2";
export const ARENA_BUNDLE_VERSION = "1";

export const ARENA_COLLISION = {
  formatVersion: 1 as const,
  representation: "aabb" as const,
  coordinateSystem: "y-up" as const,
  unitScale: 1,
  origin: { x: 0, y: 0, z: 0 },
  bounds: { minX: -24, maxX: 24, minY: -2, maxY: 8, minZ: -24, maxZ: 24 },
  visualAssetId: "environment.example-arena.visual",
  spawnPoints: [
    { id: "spawn-a", x: -10, y: 0, z: 0, yaw: 0 },
    { id: "spawn-b", x: 10, y: 0, z: 0, yaw: Math.PI },
  ],
  aabbs: [
    { id: 1, minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
    { id: 2, minX: -16, maxX: -12, minZ: -8, maxZ: -4 },
    { id: 3, minX: 12, maxX: 16, minZ: 4, maxZ: 8 },
    { id: 4, minX: -8, maxX: 8, minZ: 18, maxZ: 22 },
    { id: 5, minX: -8, maxX: 8, minZ: -22, maxZ: -18 },
  ],
};

export function arenaVisualGlb(): Uint8Array {
  return encodeGlb({
    asset: { version: "2.0" },
    scenes: [{ name: "Arena", nodes: [0] }],
    nodes: [{ name: "Floor", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  });
}

export function arenaManifest(): EngineManifest {
  const collision = JSON.stringify(ARENA_COLLISION);
  const visual = arenaVisualGlb();
  return parseManifest({
    formatVersion: 1,
    bundleId: ARENA_BUNDLE_ID,
    bundleVersion: ARENA_BUNDLE_VERSION,
    schemaVersion: "static-world-v1",
    assets: [
      {
        id: "environment.example-arena.collision",
        kind: "static-collision-scene",
        authority: "authoritative-static",
        version: "1.0.0",
        contentHash: hashBytes(bytes(collision)),
        runtimeUri: "memory:collision",
        runtimeRole: "collision",
        license: { id: "CC0-1.0", status: "spdx" },
        provenance: { origin: "generated-test-fixture" },
      },
      {
        id: "environment.example-arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "1.0.0",
        contentHash: hashBytes(visual),
        runtimeUri: "memory:visual",
        runtimeRole: "visual-scene",
        runtimePolicy: { fallbackAssetId: "primitive/box" },
        license: { id: "CC0-1.0", status: "spdx" },
        provenance: { origin: "generated-test-fixture" },
      },
      {
        id: "primitive/box",
        kind: "primitive",
        authority: "diagnostic",
        version: "1.0.0",
        contentHash: hashUtf8("box"),
        runtimeUri: "memory:box",
      },
    ],
  });
}

export function arenaFixtures(): FixtureRegistry {
  return new FixtureRegistry()
    .success("memory:collision", JSON.stringify(ARENA_COLLISION))
    .success("memory:visual", arenaVisualGlb())
    .success("memory:box", bytes("box"));
}

const arenaWorldCache = new Map<string, { definition: StaticWorldDefinition; hash: string; manifest: EngineManifest }>();

export function arenaStaticWorld(): { definition: StaticWorldDefinition; hash: string; manifest: EngineManifest } {
  const key = `${ARENA_BUNDLE_ID}@${ARENA_BUNDLE_VERSION}`;
  const hit = arenaWorldCache.get(key);
  if (hit) return hit;
  const manifest = arenaManifest();
  const resolved = resolveStaticWorld({ manifest, collision: ARENA_COLLISION, profile: "example-arena" });
  const built = { definition: resolved.definition, hash: resolved.hash, manifest };
  arenaWorldCache.set(key, built);
  return built;
}
