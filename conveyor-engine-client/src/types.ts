import type { ClientId, EntityId, InputSeq, SnapshotSeq, Tick } from "conveyor-engine-core";

export type { ClientId, EntityId, InputSeq, SnapshotSeq, Tick };

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

export type RenderKey = {
  type: string;
  shape: string;
  color?: number;
  material?: string;
  assetKey?: string;
};

export type ReplicatedEntity = {
  id: EntityId;
  owner: number;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  velocity: Vec3;
  radius: number;
  version: number;
  lifecycle: "alive" | "despawned";
  render?: RenderKey;
  inputSeq: number;
  actionEpoch?: number;
  action?: string;
};

export type InputCommand = {
  seq: InputSeq;
  moveX: number;
  moveZ: number;
  yaw: number;
  buttons: number;
};

export type PredictedState = {
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
};

export type Sample = {
  tick: Tick;
  receivedAt: number;
  seq: SnapshotSeq;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  velocity: Vec3;
};

export type AnimationDirective = {
  locomotion: "idle" | "walk" | "run";
  speed: number;
  action: "none" | "action-primary";
  actionEpoch: number;
};

export type RenderEntity = {
  id: EntityId;
  render?: RenderKey;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  visible: boolean;
  lifecycle: "alive" | "despawned";
  predicted: boolean;
  color?: number;
  animation?: AnimationDirective;
};

export type RenderSnapshot = {
  frame: number;
  serverTick: Tick;
  snapshotSeq: SnapshotSeq;
  entities: readonly RenderEntity[];
};

export type ClientMetrics = {
  inputSendRate: number;
  lastAckInput: InputSeq;
  unacked: number;
  snapshotReceive: number;
  snapshotAge: number;
  interpDepth: number;
  extrapolations: number;
  correctionDistance: number;
  correctionCount: number;
  hardCorrections: number;
  resyncCount: number;
  staleSnapshots: number;
};

export type PresentPolicy = {
  blend: number;
};

export type CorrectionPolicy = {
  softDistance: number;
  hardDistance: number;
  maxHistory: number;
};

export const DEFAULT_CORRECTION: CorrectionPolicy = {
  softDistance: 0.25,
  hardDistance: 4,
  maxHistory: 64,
};

export const DEFAULT_PRESENT: PresentPolicy = {
  blend: 0.35,
};

export type MovementParams = {
  maxSpeed: number;
  accel: number;
  damping: number;
  dt: number;
};

export const DEFAULT_CLIENT_MOVE: MovementParams = {
  maxSpeed: 8,
  accel: 40,
  damping: 8,
  dt: 1 / 20,
};

export type ClientSession = {
  clientId: ClientId;
  connected: boolean;
};
