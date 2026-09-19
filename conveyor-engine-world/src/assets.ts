import {
  collisionToObstacles,
  hashCompatibility,
  type AuthoritativeCompatibility,
  type CollisionArtifact,
} from "conveyor-engine-assets";
import type { AuthoritativeWorld } from "./world.js";

export function applyCollisionArtifact(world: AuthoritativeWorld, artifact: CollisionArtifact): number {
  const obstacles = collisionToObstacles(artifact);
  for (const o of obstacles) world.addObstacle(o);
  return obstacles.length;
}

export function bindAuthoritativeCompatibility(
  world: AuthoritativeWorld,
  compat: AuthoritativeCompatibility,
): string {
  const hash = hashCompatibility(compat);
  world.setAssetCompatibilityHash(hash);
  return hash;
}
