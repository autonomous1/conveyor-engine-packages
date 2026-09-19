import type { ClientId, EntityId, Tick } from "conveyor-engine-core";
import type { AuthoritativeWorld } from "conveyor-engine-world";
import { DEFAULT_INPUT_POLICY, validateInput, type InputAdmitResult, type InputPolicy, type RawInput } from "./input.js";

export type SessionRecord = {
  clientId: ClientId;
  connected: boolean;
  ownedEntity?: EntityId;
  lastSeq: number;
  lastTick: Tick;
  admittedThisTick: number;
  currentTick: Tick;
  timedOut: boolean;
  timeoutDrained: boolean;
};

export type IngressMetrics = {
  accepted: number;
  rejected: number;
  duplicates: number;
  unauthorized: number;
  timedOut: number;
  disconnected: number;
};

export class InputGateway {
  readonly policy: InputPolicy;
  readonly timeoutTicks: bigint;
  private readonly sessions = new Map<ClientId, SessionRecord>();
  readonly metrics: IngressMetrics = {
    accepted: 0,
    rejected: 0,
    duplicates: 0,
    unauthorized: 0,
    timedOut: 0,
    disconnected: 0,
  };

  constructor(opts: { policy?: Partial<InputPolicy>; timeoutTicks?: bigint } = {}) {
    this.policy = { ...DEFAULT_INPUT_POLICY, ...opts.policy };
    this.timeoutTicks = opts.timeoutTicks ?? 32n;
  }

  connect(clientId: ClientId, ownedEntity?: EntityId): SessionRecord {
    const rec: SessionRecord = {
      clientId,
      connected: true,
      ownedEntity,
      lastSeq: 0,
      lastTick: 0n,
      admittedThisTick: 0,
      currentTick: 0n,
      timedOut: false,
      timeoutDrained: false,
    };
    this.sessions.set(clientId, rec);
    return rec;
  }

  disconnect(clientId: ClientId): void {
    const s = this.sessions.get(clientId);
    if (!s) return;
    s.connected = false;
    s.ownedEntity = undefined;
    this.metrics.disconnected++;
  }

  get(clientId: ClientId): SessionRecord | undefined {
    return this.sessions.get(clientId);
  }

  setOwned(clientId: ClientId, entity: EntityId | undefined): void {
    const s = this.sessions.get(clientId);
    if (s) s.ownedEntity = entity;
  }

  beginTick(tick: Tick): void {
    for (const s of this.sessions.values()) {
      if (s.currentTick !== tick) {
        s.admittedThisTick = 0;
        s.currentTick = tick;
      }
      if (s.connected && !s.timedOut && s.lastSeq > 0 && tick - s.lastTick > this.timeoutTicks) {
        s.timedOut = true;
        s.timeoutDrained = false;
        this.metrics.timedOut++;
      }
    }
  }

  /** Owned entities whose timeout just flipped; caller should `world.clearInput`. */
  drainTimeouts(): EntityId[] {
    const out: EntityId[] = [];
    for (const s of this.sessions.values()) {
      if (s.timedOut && !s.timeoutDrained && s.ownedEntity !== undefined) {
        s.timeoutDrained = true;
        out.push(s.ownedEntity);
      }
    }
    return out;
  }

  admit(raw: RawInput, tick: Tick): InputAdmitResult {
    this.beginTick(tick);
    if (!this.sessions.has(raw.clientId as ClientId)) {
      this.metrics.rejected++;
      return { ok: false, category: "session", reason: "unknown-session" };
    }
    const s = this.sessions.get(raw.clientId as ClientId)!;
    if (!s.connected) {
      this.metrics.rejected++;
      return { ok: false, category: "session", reason: "disconnected" };
    }
    if (s.admittedThisTick >= this.policy.maxPerTick) {
      this.metrics.rejected++;
      return { ok: false, category: "input-rate", reason: "rate-limit" };
    }
    const result = validateInput(raw, s.lastSeq, this.policy);
    if (!result.ok) {
      this.metrics.rejected++;
      if (result.reason === "duplicate-or-old") this.metrics.duplicates++;
      return result;
    }
    if (result.input.entity !== undefined && s.ownedEntity !== undefined && result.input.entity !== s.ownedEntity) {
      this.metrics.rejected++;
      this.metrics.unauthorized++;
      return { ok: false, category: "ownership", reason: "not-owner" };
    }
    if (!s.ownedEntity) {
      this.metrics.rejected++;
      this.metrics.unauthorized++;
      return { ok: false, category: "ownership", reason: "no-owned-entity" };
    }
    s.lastSeq = result.input.seq;
    s.lastTick = tick;
    s.admittedThisTick++;
    s.timedOut = false;
    s.timeoutDrained = false;
    this.metrics.accepted++;
    return result;
  }

  enqueueMovement(world: AuthoritativeWorld, input: { clientId: ClientId; seq: number; moveX: number; moveZ: number; yaw: number }): boolean {
    const s = this.sessions.get(input.clientId);
    if (!s?.connected || !s.ownedEntity) return false;
    world.enqueue({
      kind: "applyInput",
      entity: s.ownedEntity,
      seq: input.seq,
      moveX: input.moveX,
      moveZ: input.moveZ,
      yaw: input.yaw,
    });
    return true;
  }
}
