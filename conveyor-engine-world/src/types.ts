import type { ClientId, EntityId, OwnerId, Tick, Version } from "conveyor-engine-core";

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };
export const UNIT_SCALE: Vec3 = { x: 1, y: 1, z: 1 };
export const ZERO_VEC: Vec3 = { x: 0, y: 0, z: 0 };

export type LifecycleState = "alive" | "destroying" | "destroyed";

export type RenderDescriptor = {
  type: string;
  shape: "box" | "sphere" | "capsule" | "plane" | "line" | "point";
  material?: string;
  color?: number;
  dynamic?: boolean;
  visibility?: string;
  assetKey?: string;
};

export type WorldCommand =
  | { kind: "create"; entity: EntityId; tick: Tick; render?: RenderDescriptor; owner?: OwnerId }
  | { kind: "destroy"; entity: EntityId }
  | { kind: "setTransform"; entity: EntityId; position: Vec3; rotation: Quat; scale: Vec3 }
  | { kind: "setVelocity"; entity: EntityId; linear: Vec3 }
  | { kind: "setBounds"; entity: EntityId; radius: number }
  | { kind: "setOwnership"; entity: EntityId; owner: OwnerId }
  | { kind: "setReplication"; entity: EntityId; flags: number; category: number }
  | { kind: "setLifecycle"; entity: EntityId; render?: RenderDescriptor }
  | { kind: "applyInput"; entity: EntityId; seq: number; moveX: number; moveZ: number; yaw: number }
  | { kind: "clearInput"; entity: EntityId }
  | { kind: "event"; entity: EntityId; category: string; payload?: unknown };

export type StaticObstacle = {
  id: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type WorldBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export type WorldSpawnPoint = {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
};

export type MovementConfig = {
  maxSpeed: number;
  accel: number;
  damping: number;
  dt: number;
  gravity: number;
};

export const DEFAULT_MOVEMENT: MovementConfig = {
  maxSpeed: 8,
  accel: 40,
  damping: 8,
  dt: 1 / 20,
  gravity: 0,
};

export type WorldMetrics = {
  entityCount: number;
  createCount: number;
  destroyCount: number;
  commandCount: number;
  commitDurationMs: number;
  queryCount: number;
  spatialUpdateCount: number;
  spatialOccupancy: number;
};

export type EntityRecord = {
  id: EntityId;
  alive: boolean;
  spawnTick: Tick;
  lifecycle: LifecycleState;
  owner: OwnerId;
  transformVersion: Version;
  velocityVersion: Version;
  boundsVersion: Version;
  ownershipVersion: Version;
  replicationVersion: Version;
  lifecycleVersion: Version;
  inputSeq: number;
  flags: number;
  category: number;
  render?: RenderDescriptor;
};

export type ImmutableEntityView = {
  id: EntityId;
  spawnTick: Tick;
  lifecycle: LifecycleState;
  owner: OwnerId;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  velocity: Vec3;
  radius: number;
  actionEpoch?: number;
  action?: string;
  transformVersion: Version;
  velocityVersion: Version;
  boundsVersion: Version;
  ownershipVersion: Version;
  replicationVersion: Version;
  lifecycleVersion: Version;
  inputSeq: number;
  flags: number;
  category: number;
  render?: RenderDescriptor;
};

export type WorldSnapshot = {
  tick: Tick;
  worldVersion: string;
  entities: readonly ImmutableEntityView[];
  created: readonly EntityId[];
  destroyed: readonly EntityId[];
  bundleId?: string;
  authoritativeHash?: string;
};

export type CanonicalWorldState = {
  tick: Tick;
  worldVersion: string;
  entities: readonly ImmutableEntityView[];
  bundleId?: string;
  authoritativeHash?: string;
};

export type QueryFilter = {
  owner?: OwnerId | ClientId;
  lifecycle?: LifecycleState;
  category?: number;
  sinceVersion?: Version;
  required?: Array<"transform" | "velocity" | "bounds" | "ownership">;
};
