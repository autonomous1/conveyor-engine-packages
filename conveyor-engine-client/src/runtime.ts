import type { ClientId, EntityId, InputSeq, Tick } from "conveyor-engine-core";
import { InterpolationBuffer } from "./interp.js";
import { applyMove, dist, replay } from "./predict.js";
import { locomotionFromSpeed, shouldApplyActionEpoch } from "./animation.js";
import {
  DEFAULT_CLIENT_MOVE,
  DEFAULT_CORRECTION,
  DEFAULT_PRESENT,
  type ClientMetrics,
  type CorrectionPolicy,
  type InputCommand,
  type MovementParams,
  type PresentPolicy,
  type PredictedState,
  type ReplicatedEntity,
  type RenderSnapshot,
  type SnapshotSeq,
} from "./types.js";

export type IncomingSnapshot = {
  kind: "full" | "delta";
  seq: number;
  tick: Tick;
  lastProcessedInput: InputSeq;
  spawns: Array<{ entity: EntityId; view: ViewWire }>;
  updates: Array<{ entity: EntityId; view: ViewWire }>;
  despawns: Array<{ entity: EntityId }>;
};

export type ViewWire = {
  id: EntityId;
  owner: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  scale: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  radius: number;
  replicationVersion: number;
  inputSeq: number;
  render?: { type: string; shape: string; color?: number; material?: string; assetKey?: string };
  actionEpoch?: number;
  action?: string;
};

function toReplicated(v: ViewWire): ReplicatedEntity {
  return {
    id: v.id,
    owner: v.owner,
    position: { ...v.position },
    rotation: { ...v.rotation },
    scale: { ...v.scale },
    velocity: { ...v.velocity },
    radius: v.radius,
    version: v.replicationVersion,
    lifecycle: "alive",
    render: v.render,
    inputSeq: v.inputSeq,
    actionEpoch: v.actionEpoch,
    action: v.action,
  };
}

export class EngineClient {
  clientId: ClientId;
  ownedEntity?: EntityId;
  connected = false;
  acceptedBundleId?: string;
  acceptedAuthoritativeHash?: string;
  visualStatus: "idle" | "loading" | "ready" | "degraded" | "failed" = "idle";
  visualAssetId?: string;
  visualFallbackAssetId?: string;
  private readonly appliedActionEpoch = new Map<EntityId, number>();
  private nextInput: InputSeq = 1;
  private history: InputCommand[] = [];
  private lastAck: InputSeq = 0;
  private lastSnapSeq: SnapshotSeq = 0;
  private lastTick: Tick = 0n;
  private frame = 0;
  private readonly auth = new Map<EntityId, ReplicatedEntity>();
  private predicted?: PredictedState;
  private presented?: PredictedState;
  readonly interp: InterpolationBuffer;
  readonly policy: CorrectionPolicy;
  readonly present: PresentPolicy;
  readonly move: MovementParams;
  readonly metrics: ClientMetrics = {
    inputSendRate: 0,
    lastAckInput: 0,
    unacked: 0,
    snapshotReceive: 0,
    snapshotAge: 0,
    interpDepth: 0,
    extrapolations: 0,
    correctionDistance: 0,
    correctionCount: 0,
    hardCorrections: 0,
    resyncCount: 0,
    staleSnapshots: 0,
  };

  constructor(
    clientId: ClientId,
    opts: {
      policy?: CorrectionPolicy;
      present?: PresentPolicy;
      move?: MovementParams;
      delayMs?: number;
      extraMs?: number;
    } = {},
  ) {
    this.clientId = clientId;
    this.policy = { ...DEFAULT_CORRECTION, ...opts.policy };
    this.present = { ...DEFAULT_PRESENT, ...opts.present };
    this.move = { ...DEFAULT_CLIENT_MOVE, ...opts.move };
    this.interp = new InterpolationBuffer(opts.delayMs ?? 100, 16, opts.extraMs ?? 80);
  }

  acceptWorld(bundleId?: string, authoritativeHash?: string): void {
    this.acceptedBundleId = bundleId;
    this.acceptedAuthoritativeHash = authoritativeHash;
  }

  setVisualStatus(
    state: "idle" | "loading" | "ready" | "degraded" | "failed",
    opts: { assetId?: string; fallbackAssetId?: string } = {},
  ): void {
    this.visualStatus = state;
    if (opts.assetId !== undefined) this.visualAssetId = opts.assetId;
    if (opts.fallbackAssetId !== undefined) this.visualFallbackAssetId = opts.fallbackAssetId;
  }

  connect(owned?: EntityId, clientId?: ClientId): void {
    this.connected = true;
    this.ownedEntity = owned;
    if (clientId !== undefined) this.clientId = clientId;
    this.lastSnapSeq = 0;
    this.lastAck = 0;
    this.history = [];
    this.predicted = undefined;
    this.presented = undefined;
  }

  collectInput(partial: Omit<InputCommand, "seq">): InputCommand {
    const cmd: InputCommand = { seq: this.nextInput++, ...partial };
    this.history.push(cmd);
    if (this.history.length > this.policy.maxHistory) this.history.shift();
    if (this.ownedEntity && this.predicted) {
      this.predicted = applyMove(this.predicted, cmd, this.move);
    } else if (this.ownedEntity) {
      const a = this.auth.get(this.ownedEntity);
      if (a) {
        this.predicted = applyMove(
          { position: { ...a.position }, rotation: { ...a.rotation }, velocity: { ...a.velocity } },
          cmd,
          this.move,
        );
      }
    }
    this.metrics.inputSendRate++;
    this.metrics.unacked = this.history.filter((h) => h.seq > this.lastAck).length;
    return cmd;
  }

  applySnapshot(snap: IncomingSnapshot, receivedAt = Date.now()): void {
    if (this.lastSnapSeq !== 0 && snap.seq <= this.lastSnapSeq) {
      this.metrics.staleSnapshots++;
      return;
    }
    this.lastSnapSeq = snap.seq;
    this.lastTick = snap.tick;
    this.metrics.snapshotReceive++;
    if (snap.kind === "full") {
      this.auth.clear();
    }
    for (const s of snap.spawns) {
      const e = toReplicated(s.view);
      this.auth.set(e.id, e);
      this.interp.push(e.id, sampleOf(e, snap, receivedAt));
    }
    for (const u of snap.updates) {
      const e = toReplicated(u.view);
      this.auth.set(e.id, e);
      this.interp.push(e.id, sampleOf(e, snap, receivedAt));
    }
    for (const d of snap.despawns) {
      const e = this.auth.get(d.entity);
      if (e) e.lifecycle = "despawned";
      this.auth.delete(d.entity);
      this.interp.remove(d.entity);
    }
    if (snap.lastProcessedInput > this.lastAck) this.lastAck = snap.lastProcessedInput;
    this.history = this.history.filter((h) => h.seq > this.lastAck);
    this.metrics.lastAckInput = this.lastAck;
    this.metrics.unacked = this.history.length;
    this.reconcile();
  }

  private reconcile(): void {
    if (!this.ownedEntity) return;
    const a = this.auth.get(this.ownedEntity);
    if (!a) return;
    const base: PredictedState = {
      position: { ...a.position },
      rotation: { ...a.rotation },
      velocity: { ...a.velocity },
    };
    const next = replay(base, this.history, this.move);
    if (this.predicted) {
      const d = dist(this.predicted.position, next.position);
      this.metrics.correctionDistance = d;
      if (d > 0) this.metrics.correctionCount++;
      if (d >= this.policy.hardDistance) this.metrics.hardCorrections++;
    }
    this.predicted = next;
    if (!this.presented || this.metrics.correctionDistance >= this.policy.hardDistance) {
      this.presented = {
        position: { ...next.position },
        rotation: { ...next.rotation },
        velocity: { ...next.velocity },
      };
    }
  }

  private advancePresented(): void {
    if (!this.predicted) return;
    if (!this.presented) {
      this.presented = {
        position: { ...this.predicted.position },
        rotation: { ...this.predicted.rotation },
        velocity: { ...this.predicted.velocity },
      };
      return;
    }
    const t = this.present.blend;
    this.presented = {
      position: {
        x: this.presented.position.x + (this.predicted.position.x - this.presented.position.x) * t,
        y: this.presented.position.y + (this.predicted.position.y - this.presented.position.y) * t,
        z: this.presented.position.z + (this.predicted.position.z - this.presented.position.z) * t,
      },
      rotation: { ...this.predicted.rotation },
      velocity: { ...this.predicted.velocity },
    };
  }

  renderSnapshot(now = Date.now()): RenderSnapshot {
    this.frame++;
    const entities = [];
    for (const e of [...this.auth.values()].sort((a, b) => a.id - b.id)) {
      const isOwned = e.id === this.ownedEntity;
      const interp = isOwned ? undefined : this.interp.sample(e.id, now);
      if (isOwned) this.advancePresented();
      const pred = isOwned ? this.presented ?? this.predicted : undefined;
      const vx = pred?.velocity.x ?? e.velocity.x;
      const vz = pred?.velocity.z ?? e.velocity.z;
      const speed = Math.hypot(vx, vz);
      const incomingEpoch = e.actionEpoch ?? 0;
      const last = this.appliedActionEpoch.get(e.id) ?? 0;
      const applyAction = shouldApplyActionEpoch(incomingEpoch, last);
      if (applyAction) this.appliedActionEpoch.set(e.id, incomingEpoch);
      const action: "none" | "action-primary" =
        applyAction && incomingEpoch > 0 ? "action-primary" : "none";
      entities.push({
        id: e.id,
        render: e.render,
        position: pred?.position ?? interp?.position ?? e.position,
        rotation: pred?.rotation ?? interp?.rotation ?? e.rotation,
        scale: interp?.scale ?? e.scale,
        visible: e.lifecycle === "alive",
        lifecycle: e.lifecycle,
        predicted: Boolean(isOwned && pred),
        color: e.render?.color,
        animation: {
          locomotion: locomotionFromSpeed(speed),
          speed,
          action,
          actionEpoch: applyAction ? incomingEpoch : last,
        },
      });
    }
    this.metrics.interpDepth = this.ownedEntity
      ? Math.max(0, ...[...this.auth.keys()].filter((id) => id !== this.ownedEntity).map((id) => this.interp.depth(id)))
      : 0;
    this.metrics.extrapolations = this.interp.extrapolations;
    const snap = {
      frame: this.frame,
      serverTick: this.lastTick,
      snapshotSeq: this.lastSnapSeq,
      entities,
    };
    Object.freeze(snap);
    Object.freeze(snap.entities);
    return snap;
  }

  authoritative(id: EntityId): ReplicatedEntity | undefined {
    return this.auth.get(id);
  }
}

function sampleOf(e: ReplicatedEntity, snap: IncomingSnapshot, receivedAt: number) {
  return {
    tick: snap.tick,
    receivedAt,
    seq: snap.seq,
    position: { ...e.position },
    rotation: { ...e.rotation },
    scale: { ...e.scale },
    velocity: { ...e.velocity },
  };
}
