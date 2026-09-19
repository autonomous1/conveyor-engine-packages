import type { ClientId, EntityId, InputSeq, SnapshotSeq, Tick } from "conveyor-engine-core";
import type { ImmutableEntityView } from "conveyor-engine-world";

export type ReplicationBudget = {
  maxBytes: number;
  maxEntities: number;
  maxPendingLifecycle: number;
};

export const DEFAULT_BUDGET: ReplicationBudget = {
  maxBytes: 32_000,
  maxEntities: 64,
  maxPendingLifecycle: 128,
};

export type ClientReplicationState = {
  clientId: ClientId;
  connected: boolean;
  lastSentSeq: SnapshotSeq;
  lastAckSeq: SnapshotSeq;
  lastProcessedInput: InputSeq;
  known: Map<EntityId, number>;
  interestRadius: number;
  ownedEntity?: EntityId;
  focusX: number;
  focusZ: number;
  pendingDespawn: Set<EntityId>;
  needsFull: boolean;
  lastFullTick: Tick;
  outboundBytes: number;
  queueDepth: number;
  resyncCount: number;
};

export type SpawnRecord = {
  entity: EntityId;
  tick: Tick;
  view: ImmutableEntityView;
};

export type UpdateRecord = {
  entity: EntityId;
  tick: Tick;
  version: number;
  view: ImmutableEntityView;
};

export type DespawnRecord = {
  entity: EntityId;
  tick: Tick;
  reason: "destroyed" | "relevance-leave";
};

export type SnapshotEnvelope = {
  kind: "full" | "delta";
  seq: SnapshotSeq;
  tick: Tick;
  baseline: SnapshotSeq;
  lastProcessedInput: InputSeq;
  worldVersion: string;
  protocol: number;
  /** Authoritative asset compatibility hash. Never includes handles or presentation bytes. */
  assetsCompatHash?: string;
  spawns: SpawnRecord[];
  updates: UpdateRecord[];
  despawns: DespawnRecord[];
};

export type ReplicationMetrics = {
  clientCount: number;
  snapshotCount: number;
  fullSnapshotCount: number;
  deltaSnapshotCount: number;
  spawnCount: number;
  updateCount: number;
  despawnCount: number;
  coalesced: number;
  deferred: number;
  resyncCount: number;
};

export type ValidatedInput = {
  clientId: ClientId;
  seq: InputSeq;
  moveX: number;
  moveZ: number;
  yaw: number;
  buttons: number;
  entity?: number;
};
