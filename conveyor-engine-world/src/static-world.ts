import type { AuthoritativeWorld } from "./world.js";
import {
  hashStaticWorld,
  resolveStaticWorld,
  type StaticWorldDefinition,
} from "conveyor-engine-assets";
import type { CollisionArtifact, EngineManifest, LoadedPayload } from "conveyor-engine-assets";

export function applyStaticWorldDefinition(world: AuthoritativeWorld, def: StaticWorldDefinition): string {
  const hash = hashStaticWorld(def);
  world.setBundleIdentity(def.bundleId, hash);
  world.actorSeparation = true;
  world.setWorldBounds(def.bounds);
  for (const box of def.aabbs) {
    world.addObstacle({ id: box.id, minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ });
  }
  for (const spawn of def.spawnPoints) {
    world.addSpawnPoint({ id: spawn.id, x: spawn.x, y: spawn.y, z: spawn.z, yaw: spawn.yaw });
  }
  return hash;
}

export function loadAuthoritativeStaticWorld(
  world: AuthoritativeWorld,
  opts: {
    manifest: EngineManifest;
    collision: CollisionArtifact | LoadedPayload | unknown;
    profile?: "minimal" | "example-arena";
  },
): { definition: StaticWorldDefinition; hash: string } {
  const resolved = resolveStaticWorld(opts);
  const hash = applyStaticWorldDefinition(world, resolved.definition);
  return { definition: resolved.definition, hash };
}
