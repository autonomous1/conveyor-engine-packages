import { PROTOCOL_VERSION, compareId, type ClientId, type EntityId } from "conveyor-engine-core";
import type { AuthoritativeWorld, ImmutableEntityView, WorldSnapshot } from "conveyor-engine-world";
import {
  DEFAULT_BUDGET,
  type ClientReplicationState,
  type DespawnRecord,
  type ReplicationBudget,
  type ReplicationMetrics,
  type SnapshotEnvelope,
  type SpawnRecord,
  type UpdateRecord,
} from "./types.js";

export class Replicator {
  private readonly clients = new Map<ClientId, ClientReplicationState>();
  readonly metrics: ReplicationMetrics = {
    clientCount: 0,
    snapshotCount: 0,
    fullSnapshotCount: 0,
    deltaSnapshotCount: 0,
    spawnCount: 0,
    updateCount: 0,
    despawnCount: 0,
    coalesced: 0,
    deferred: 0,
    resyncCount: 0,
  };

  private readonly budget: ReplicationBudget;
  assetsCompatHash?: string;
  constructor(budget: ReplicationBudget = DEFAULT_BUDGET) {
    this.budget = budget;
  }

  setAssetCompatibilityHash(hash: string | undefined): void {
    this.assetsCompatHash = hash;
  }

  connect(clientId: ClientId, ownedEntity?: EntityId, radius = 48): ClientReplicationState {
    const state: ClientReplicationState = {
      clientId,
      connected: true,
      lastSentSeq: 0,
      lastAckSeq: 0,
      lastProcessedInput: 0,
      known: new Map(),
      interestRadius: radius,
      ownedEntity,
      focusX: 0,
      focusZ: 0,
      pendingDespawn: new Set(),
      needsFull: true,
      lastFullTick: 0n,
      outboundBytes: 0,
      queueDepth: 0,
      resyncCount: 0,
    };
    this.clients.set(clientId, state);
    this.metrics.clientCount = this.clients.size;
    return state;
  }

  disconnect(clientId: ClientId): void {
    const s = this.clients.get(clientId);
    if (!s) return;
    s.connected = false;
    this.clients.delete(clientId);
    this.metrics.clientCount = this.clients.size;
  }

  get(clientId: ClientId): ClientReplicationState | undefined {
    return this.clients.get(clientId);
  }

  ack(clientId: ClientId, seq: number): void {
    const s = this.clients.get(clientId);
    if (!s) return;
    if (seq > s.lastAckSeq) s.lastAckSeq = seq;
  }

  setProcessedInput(clientId: ClientId, seq: number): void {
    const s = this.clients.get(clientId);
    if (s && seq > s.lastProcessedInput) s.lastProcessedInput = seq;
  }

  requestResync(clientId: ClientId): void {
    const s = this.clients.get(clientId);
    if (!s) return;
    s.needsFull = true;
    s.resyncCount++;
    this.metrics.resyncCount++;
  }

  private relevant(world: AuthoritativeWorld, s: ClientReplicationState, snap: WorldSnapshot): ImmutableEntityView[] {
    if (s.ownedEntity) {
      const owned = snap.entities.find((e) => e.id === s.ownedEntity);
      if (owned) {
        s.focusX = owned.position.x;
        s.focusZ = owned.position.z;
      }
    }
    const nearby = world.queryRadius(s.focusX, s.focusZ, s.interestRadius);
    const byId = new Map(nearby.map((e) => [e.id, e]));
    const always = snap.entities.filter((e) => e.category === 1 || e.flags & 1);
    for (const e of always) byId.set(e.id, e);
    if (s.ownedEntity) {
      const owned = snap.entities.find((e) => e.id === s.ownedEntity);
      if (owned) byId.set(owned.id, owned);
    }
    const list = [...byId.values()];
    list.sort((a, b) => {
      const pa = priority(s, a);
      const pb = priority(s, b);
      if (pa !== pb) return pa - pb;
      const da = dist2(s, a);
      const db = dist2(s, b);
      if (da !== db) return da - db;
      return compareId(a.id, b.id);
    });
    return list;
  }

  publish(world: AuthoritativeWorld, snap: WorldSnapshot): Map<ClientId, SnapshotEnvelope> {
    const out = new Map<ClientId, SnapshotEnvelope>();
    for (const s of this.clients.values()) {
      if (!s.connected) continue;
      out.set(s.clientId, this.publishOne(world, snap, s));
    }
    return out;
  }

  private publishOne(world: AuthoritativeWorld, snap: WorldSnapshot, s: ClientReplicationState): SnapshotEnvelope {
    const relevant = this.relevant(world, s, snap);
    const relevantIds = new Set(relevant.map((e) => e.id));
    const destroyed = new Set(snap.destroyed);
    const spawns: SpawnRecord[] = [];
    const updates: UpdateRecord[] = [];
    const despawns: DespawnRecord[] = [];

    for (const id of s.known.keys()) {
      if (!relevantIds.has(id) || destroyed.has(id) || !world.exists(id)) {
        s.pendingDespawn.add(id);
      }
    }
    for (const id of s.pendingDespawn) {
      despawns.push({
        entity: id,
        tick: snap.tick,
        reason: destroyed.has(id) ? "destroyed" : "relevance-leave",
      });
      s.known.delete(id);
    }
    s.pendingDespawn.clear();

    let used = 0;
    const forceFull = s.needsFull || s.lastSentSeq === 0;
    for (const view of relevant) {
      if (used >= this.budget.maxEntities) {
        this.metrics.deferred++;
        break;
      }
      const knownVer = s.known.get(view.id);
      if (forceFull || knownVer === undefined) {
        spawns.push({ entity: view.id, tick: snap.tick, view });
        s.known.set(view.id, view.replicationVersion);
        used++;
        continue;
      }
      if (knownVer < view.replicationVersion) {
        if (knownVer < view.replicationVersion - 1) this.metrics.coalesced++;
        updates.push({ entity: view.id, tick: snap.tick, version: view.replicationVersion, view });
        s.known.set(view.id, view.replicationVersion);
        used++;
      }
    }

    s.lastSentSeq += 1;
    if (forceFull) {
      s.needsFull = false;
      s.lastFullTick = snap.tick;
      this.metrics.fullSnapshotCount++;
    } else {
      this.metrics.deltaSnapshotCount++;
    }
    this.metrics.snapshotCount++;
    this.metrics.spawnCount += spawns.length;
    this.metrics.updateCount += updates.length;
    this.metrics.despawnCount += despawns.length;
    s.outboundBytes = estimateBytes(spawns, updates, despawns);
    s.queueDepth = 0;

    return {
      kind: forceFull ? "full" : "delta",
      seq: s.lastSentSeq,
      tick: snap.tick,
      baseline: forceFull ? 0 : s.lastAckSeq,
      lastProcessedInput: s.lastProcessedInput,
      worldVersion: snap.worldVersion,
      protocol: PROTOCOL_VERSION,
      ...(this.assetsCompatHash ? { assetsCompatHash: this.assetsCompatHash } : {}),
      spawns,
      updates,
      despawns,
    };
  }
}

function priority(s: ClientReplicationState, e: ImmutableEntityView): number {
  if (s.ownedEntity === e.id) return 0;
  if (e.category === 1 || e.flags & 1) return 1;
  return 2;
}

function dist2(s: ClientReplicationState, e: ImmutableEntityView): number {
  const dx = e.position.x - s.focusX;
  const dz = e.position.z - s.focusZ;
  return dx * dx + dz * dz;
}

function estimateBytes(spawns: SpawnRecord[], updates: UpdateRecord[], despawns: DespawnRecord[]): number {
  return (spawns.length + updates.length) * 80 + despawns.length * 16;
}
