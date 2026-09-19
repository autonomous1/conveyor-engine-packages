import type { SceneAdapter } from "./types.js";

export type StaticWorldVisualHooks = {
  attachScene?: (sceneId: string) => void;
  detachScene?: (sceneId: string) => void;
  attachFallback?: (reason: string) => void;
  debugAabb?: (id: number, minX: number, maxX: number, minZ: number, maxZ: number) => void;
  debugSpawn?: (id: string, x: number, y: number, z: number) => void;
};

/**
 * Optional presentation attach surface. Core CI uses the no-op implementation.
 */
export function createStaticWorldVisual(adapter: SceneAdapter, hooks: StaticWorldVisualHooks = {}) {
  let attached: string | undefined;
  return {
    adapter,
    attach(sceneId: string): void {
      attached = sceneId;
      hooks.attachScene?.(sceneId);
    },
    detach(): void {
      if (attached) hooks.detachScene?.(attached);
      attached = undefined;
    },
    fallback(reason: string): void {
      hooks.attachFallback?.(reason);
    },
    debugAabb(id: number, minX: number, maxX: number, minZ: number, maxZ: number): void {
      hooks.debugAabb?.(id, minX, maxX, minZ, maxZ);
    },
    debugSpawn(id: string, x: number, y: number, z: number): void {
      hooks.debugSpawn?.(id, x, y, z);
    },
    get attachedScene(): string | undefined {
      return attached;
    },
  };
}
