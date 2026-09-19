import type { EntityId } from "conveyor-engine-core";

export type PrimitiveShape = "box" | "sphere" | "capsule" | "plane" | "line" | "point";

export type ProxyObject = {
  id: string;
  position: { x: number; y: number; z: number };
  quaternion: { x: number; y: number; z: number; w: number };
  scale: { x: number; y: number; z: number };
  visible: boolean;
  userData: Record<string, unknown>;
};

export type RenderBinding = {
  entity: EntityId;
  descriptor: string;
  object: ProxyObject;
  shape: PrimitiveShape;
  lastFrame: number;
  disposed: boolean;
};

export type ThreeMetrics = {
  frameTimeMs: number;
  drawCalls: number;
  visibleBindings: number;
  primitiveCount: number;
  creates: number;
  destroys: number;
  placeholders: number;
  overlays: number;
};

export type SceneAdapter = {
  add(obj: ProxyObject): void;
  remove(obj: ProxyObject): void;
};
