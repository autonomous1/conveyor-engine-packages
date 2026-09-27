import type { ConveyorGraph, StreamAgent } from "conveyor-graph";
import type { LinkProfile, NetworkScheduler, RuntimeContext } from "conveyor-graph-simulator/reference";
import type { ClientId } from "conveyor-engine-core";
import { SimulatedWorld, type EngineAdmitPayload } from "conveyor-engine-world";
import { ClientMirror } from "./mirror.js";
import { InputGateway } from "./ingress.js";
import { Replicator } from "./replicator.js";
import type { SnapshotEnvelope } from "./types.js";
import type { NetPath, NetSendOptions, NetSendReceipt } from "./net-path.js";

export type NetBatch = {
  type?: string;
  creates?: EngineAdmitPayload["create"][];
  inputs?: Array<{
    clientId: number;
    seq: number;
    moveX?: number;
    moveZ?: number;
    yaw?: number;
  }>;
};

export type NetDeliver = {
  type: "net-deliver";
  to: string;
  payloadHash: string;
};

/**
 * Test/sim adapter. Admit and sim phases commit the world and send envelope
 * ids through NetworkScheduler (body kept in `outbox`).
 * `send` hands a protocol frame to that scheduler after `setupNetwork`.
 * The graph publish path stays in `#send` so duplicate and partition tests
 * keep the same outbox and release behavior.
 */
export class SimulatedNetPath implements NetPath<unknown> {
  readonly world = new SimulatedWorld();
  readonly gateway = new InputGateway();
  readonly replicator = new Replicator();
  readonly mirrors = new Map<ClientId, ClientMirror>();
  readonly outbox = new Map<string, SnapshotEnvelope>();
  deliveries = 0;
  duplicateIgnored = 0;
  sends = 0;
  rejects = 0;
  private readonly clients: ClientId[];
  private readonly radius: number;
  #net: NetworkScheduler | undefined;
  #tick: bigint = 0n;
  #pathSeq = 0;
  #closed = false;

  constructor(opts: { clients?: ClientId[]; radius?: number } = {}) {
    this.clients = opts.clients ?? [1, 2];
    this.radius = opts.radius ?? 32;
  }

  setupNetwork(net: NetworkScheduler, profile: LinkProfile = {}): void {
    this.#net = net;
    net.addPeer("world");
    for (const id of this.clients) {
      net.addPeer(`client:${id}`);
      net.connect("world", `client:${id}`, "snap", profile);
      this.gateway.connect(id);
      this.replicator.connect(id, undefined, this.radius);
      this.mirrors.set(id, new ClientMirror());
    }
  }

  partition(net: NetworkScheduler, clientId: ClientId, fromTick: bigint, toTick: bigint): void {
    net.partition("world", `client:${clientId}`, "snap", fromTick, toTick);
  }

  /**
   * NetPath entry for a protocol frame. Requires `setupNetwork` and a
   * destination. Admitted `deliver` / `delay` outcomes report `ok`.
   * Does not write `outbox` or the graph `sends` counter.
   */
  send(frame: unknown, options: NetSendOptions = {}): Promise<NetSendReceipt> {
    if (this.#closed) return Promise.resolve({ ok: false });
    const to = options.to;
    const net = this.#net;
    if (!net || typeof to !== "string" || to.length === 0) return Promise.resolve({ ok: false });
    try {
      const decision = net.send({
        id: `netpath-${to}-${this.#pathSeq + 1}`,
        from: "world",
        to,
        channel: options.kind ?? "snap",
        payload: frame,
        sendTick: this.#tick,
      });
      const seq = ++this.#pathSeq;
      const ok = decision.outcome === "deliver" || decision.outcome === "delay";
      return Promise.resolve({ ok, seq });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  close(_reason?: string): void {
    this.#closed = true;
  }

  buildAdmit(graph: ConveyorGraph, ctx: RuntimeContext): void {
    const host = this;
    graph.define("in", (agent: StreamAgent) => {
      const event = agent.payload as { payload?: unknown; kind?: string };
      const raw = (event?.payload ?? agent.payload) as Record<string, unknown>;
      if (typeof raw?.payloadHash === "string" && typeof raw.to === "string") {
        return { type: "net-deliver", to: raw.to, payloadHash: raw.payloadHash } satisfies NetDeliver;
      }
      const batch = raw as NetBatch;
      const tick = ctx.dueTick();
      host.#tick = tick;
      const inputs = [];
      if (Array.isArray(batch.inputs)) {
        for (const row of batch.inputs) {
          const result = host.gateway.admit(row, tick);
          if (result.ok) inputs.push(result.input);
        }
      }
      return { type: "batch", creates: batch.creates, inputs };
    });
  }

  buildSim(graph: ConveyorGraph, ctx: RuntimeContext): void {
    const host = this;
    graph.define("step", (agent: StreamAgent) => {
      const tick = ctx.dueTick();
      host.#tick = tick;
      const payload = agent.payload as NetDeliver | NetBatch | { payloadHash?: string; to?: string };
      if (typeof (payload as { payloadHash?: string }).payloadHash === "string" && typeof (payload as { to?: string }).to === "string") {
        const net = payload as { payloadHash: string; to: string };
        return host.#deliver({ type: "net-deliver", to: net.to, payloadHash: net.payloadHash }, ctx);
      }
      const batch = payload as NetBatch & { inputs?: Array<{ clientId: number; seq: number; moveX: number; moveZ: number; yaw: number }> };
      if (batch.creates) {
        for (const create of batch.creates) {
          if (!create) continue;
          const id = host.world.world.createEntity(tick, create.render, create.owner);
          if (create.owner) {
            host.world.owned.set(create.owner, id);
            host.gateway.setOwned(create.owner, id);
            const session = host.replicator.get(create.owner);
            if (session) session.ownedEntity = id;
            host.world.world.enqueue({ kind: "setReplication", entity: id, flags: 1, category: 1 });
          } else {
            host.world.world.enqueue({
              kind: "setTransform",
              entity: id,
              position: { x: 400, y: 0, z: 0 },
              rotation: { x: 0, y: 0, z: 0, w: 1 },
              scale: { x: 1, y: 1, z: 1 },
            });
          }
        }
      }
      for (const entity of host.gateway.drainTimeouts()) {
        host.world.world.clearInput(entity);
      }
      if (batch.inputs) {
        for (const input of batch.inputs) {
          host.gateway.enqueueMovement(host.world.world, {
            clientId: input.clientId,
            seq: input.seq,
            moveX: input.moveX ?? 0,
            moveZ: input.moveZ ?? 0,
            yaw: input.yaw ?? 0,
          });
        }
      }
      host.world.lastSnapshot = host.world.world.commit(tick);
      ctx.propose({
        vertexId: "step",
        path: ["world"],
        value: host.world.world.canonicalPlain(),
      });
      host.#send(ctx);
      return host.world.lastSnapshot;
    });
  }

  #deliver(payload: NetDeliver, ctx: RuntimeContext): { delivered: boolean } {
    const env =
      this.outbox.get(payload.payloadHash) ??
      (ctx.network.bodies.get(payload.payloadHash) as SnapshotEnvelope | undefined);
    const clientId = Number(payload.to.slice("client:".length)) as ClientId;
    const mirror = this.mirrors.get(clientId);
    if (!env || !mirror) return { delivered: false };
    const ignored = mirror.ignored;
    mirror.apply(env);
    if (mirror.ignored > ignored) this.duplicateIgnored++;
    this.deliveries++;
    this.outbox.delete(payload.payloadHash);
    ctx.network.release?.(payload.payloadHash);
    ctx.propose({
      vertexId: "step",
      path: ["world"],
      value: this.world.world.canonicalPlain(),
    });
    return { delivered: true };
  }

  #send(ctx: RuntimeContext): void {
    const snap = this.world.lastSnapshot;
    if (!snap) return;
    const envs = this.replicator.publish(this.world.world, snap);
    for (const [clientId, env] of envs) {
      const wire = { seq: env.seq, kind: env.kind, clientId, tick: env.tick.toString() };
      const decision = ctx.network.send({
        id: `snap-${clientId}-${env.seq}`,
        from: "world",
        to: `client:${clientId}`,
        channel: "snap",
        payload: wire,
        sendTick: ctx.dueTick(),
      });
      this.sends++;
      if (decision.outcome === "reject" || decision.outcome === "partition") this.rejects++;
      this.outbox.set(decision.message.payloadHash, env);
    }
  }
}
