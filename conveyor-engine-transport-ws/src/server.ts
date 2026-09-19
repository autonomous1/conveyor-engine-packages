import {
  handshakeBundleCompatible,
  handshakeCompatible,
  localCompatibility,
  type BundleIdentity,
  type ClientId,
  type Compatibility,
  type EntityId,
  type Tick,
} from "conveyor-engine-core";
import { InputGateway, Replicator, type SnapshotEnvelope, type ValidatedInput } from "conveyor-engine-replication";
import { decodeFrame, encodeFrame } from "./codec.js";
import { parseWire, TRANSPORT_PROTOCOL, type HelloMsg, type InputMsg } from "./protocol.js";
import type { TransportSocket } from "./socket.js";

export type ServerSession = {
  clientId: ClientId;
  sessionId: number;
  token: string;
  socket: TransportSocket;
  framesThisTick: number;
  tick: Tick;
};

export type EngineWsServerOptions = {
  compatibility?: Compatibility;
  bundle?: BundleIdentity;
  gateway?: InputGateway;
  replicator?: Replicator;
  maxFrameBytes?: number;
  maxFramesPerTick?: number;
  nextClientId?: ClientId;
  onAdmit?: (input: ValidatedInput, tick: Tick) => void;
  onHello?: (session: ServerSession, hello: HelloMsg) => EntityId | undefined;
};

export type TransportServerMetrics = {
  accepted: number;
  rejected: number;
  disconnected: number;
  malformed: number;
  oversized: number;
  rateLimited: number;
  inputs: number;
  snapshots: number;
};

export class EngineWsServer {
  readonly compatibility: Compatibility;
  readonly bundle: BundleIdentity;
  readonly gateway: InputGateway;
  readonly replicator: Replicator;
  readonly maxFrameBytes: number;
  readonly maxFramesPerTick: number;
  readonly metrics: TransportServerMetrics = {
    accepted: 0,
    rejected: 0,
    disconnected: 0,
    malformed: 0,
    oversized: 0,
    rateLimited: 0,
    inputs: 0,
    snapshots: 0,
  };
  private nextClientId: ClientId;
  private nextSession = 1;
  private readonly sessions = new Map<ClientId, ServerSession>();
  private readonly tokens = new Map<string, ClientId>();
  private onAdmit?: EngineWsServerOptions["onAdmit"];
  private onHello?: EngineWsServerOptions["onHello"];
  private tick: Tick = 0n;

  constructor(opts: EngineWsServerOptions = {}) {
    this.compatibility = opts.compatibility ?? localCompatibility();
    this.bundle = opts.bundle ?? {};
    this.gateway = opts.gateway ?? new InputGateway();
    this.replicator = opts.replicator ?? new Replicator();
    this.maxFrameBytes = opts.maxFrameBytes ?? 8_192;
    this.maxFramesPerTick = opts.maxFramesPerTick ?? 16;
    this.nextClientId = opts.nextClientId ?? 1;
    this.onAdmit = opts.onAdmit;
    this.onHello = opts.onHello;
  }

  setTick(tick: Tick): void {
    this.tick = tick;
    for (const s of this.sessions.values()) {
      if (s.tick !== tick) {
        s.tick = tick;
        s.framesThisTick = 0;
      }
    }
    this.gateway.beginTick(tick);
  }

  attach(socket: TransportSocket): void {
    let session: ServerSession | undefined;
    socket.onMessage((text) => {
      this.#onFrame(socket, text, () => session, (s) => {
        session = s;
      });
    });
    socket.onClose(() => {
      if (!session) return;
      const cur = this.sessions.get(session.clientId);
      if (cur && cur.socket === socket) this.#drop(session.clientId);
    });
  }

  sendSnapshot(clientId: ClientId, envelope: SnapshotEnvelope): boolean {
    const s = this.sessions.get(clientId);
    if (!s) return false;
    s.socket.send(encodeFrame({ v: TRANSPORT_PROTOCOL, type: "snapshot", envelope }));
    this.metrics.snapshots++;
    return true;
  }

  disconnect(clientId: ClientId): void {
    const s = this.sessions.get(clientId);
    if (!s) return;
    s.socket.close();
    this.#drop(clientId);
  }

  session(clientId: ClientId): ServerSession | undefined {
    return this.sessions.get(clientId);
  }

  get connected(): ClientId[] {
    return [...this.sessions.keys()].sort((a, b) => a - b);
  }

  #drop(clientId: ClientId): void {
    const s = this.sessions.get(clientId);
    if (!s) return;
    this.sessions.delete(clientId);
    this.gateway.disconnect(clientId);
    this.replicator.disconnect(clientId);
    this.metrics.disconnected++;
  }

  #onFrame(
    socket: TransportSocket,
    text: string,
    getSession: () => ServerSession | undefined,
    setSession: (s: ServerSession) => void,
  ): void {
    if (text.length > this.maxFrameBytes) {
      this.metrics.oversized++;
      socket.send(encodeFrame({ v: TRANSPORT_PROTOCOL, type: "error", category: "resource", reason: "oversized" }));
      return;
    }
    let value: unknown;
    try {
      value = decodeFrame(text);
    } catch {
      this.metrics.malformed++;
      socket.send(encodeFrame({ v: TRANSPORT_PROTOCOL, type: "error", category: "protocol", reason: "malformed" }));
      return;
    }
    const parsed = parseWire(value);
    if ("error" in parsed) {
      this.metrics.malformed++;
      socket.send(encodeFrame({ v: TRANSPORT_PROTOCOL, type: "error", category: "protocol", reason: parsed.error }));
      return;
    }
    const session = getSession();
    if (parsed.type === "hello") {
      this.#hello(socket, parsed, setSession);
      return;
    }
    if (!session) {
      socket.send(encodeFrame({ v: TRANSPORT_PROTOCOL, type: "error", category: "session", reason: "no-handshake" }));
      return;
    }
    if (session.tick !== this.tick) {
      session.tick = this.tick;
      session.framesThisTick = 0;
    }
    session.framesThisTick++;
    if (session.framesThisTick > this.maxFramesPerTick) {
      this.metrics.rateLimited++;
      socket.send(encodeFrame({ v: TRANSPORT_PROTOCOL, type: "error", category: "input-rate", reason: "rate-limit" }));
      return;
    }
    if (parsed.type === "input") this.#input(session, parsed);
    else if (parsed.type === "ack") this.replicator.ack(session.clientId, parsed.snapshotSeq);
    else if (parsed.type === "resync") this.replicator.requestResync(session.clientId);
  }

  #hello(socket: TransportSocket, hello: HelloMsg, setSession: (s: ServerSession) => void): void {
    const compat = handshakeCompatible(this.compatibility, { protocol: hello.protocol, world: hello.world });
    if (!compat.ok) {
      this.metrics.rejected++;
      socket.send(
        encodeFrame({ v: TRANSPORT_PROTOCOL, type: "reject", reason: compat.reason, code: "PROTOCOL_MISMATCH" }),
      );
      socket.close();
      return;
    }
    const bundle = handshakeBundleCompatible(this.bundle, {
      bundleId: hello.bundleId,
      authoritativeHash: hello.authoritativeHash,
    });
    if (!bundle.ok) {
      this.metrics.rejected++;
      socket.send(
        encodeFrame({ v: TRANSPORT_PROTOCOL, type: "reject", reason: bundle.reason, code: bundle.code }),
      );
      socket.close();
      return;
    }
    let clientId = hello.token ? this.tokens.get(hello.token) : undefined;
    const reconnect = clientId !== undefined;
    if (clientId === undefined) {
      clientId = this.nextClientId++;
    }
    const token = hello.token && reconnect ? hello.token : `tok-${clientId}-${this.nextSession}`;
    this.tokens.set(token, clientId);
    const sessionId = this.nextSession++;
    const prev = this.sessions.get(clientId);
    const session: ServerSession = {
      clientId,
      sessionId,
      token,
      socket,
      framesThisTick: 0,
      tick: this.tick,
    };
    this.sessions.set(clientId, session);
    if (prev && prev.socket !== socket) prev.socket.close();
    setSession(session);
    const owned = this.onHello?.(session, hello);
    this.gateway.connect(clientId, owned);
    this.replicator.connect(clientId, owned);
    if (reconnect) this.replicator.requestResync(clientId);
    this.metrics.accepted++;
    socket.send(
      encodeFrame({
        v: TRANSPORT_PROTOCOL,
        type: "welcome",
        clientId,
        sessionId,
        protocol: this.compatibility.protocol,
        world: this.compatibility.world,
        reconnectToken: token,
        bundleId: this.bundle.bundleId,
        authoritativeHash: this.bundle.authoritativeHash,
      }),
    );
  }

  #input(session: ServerSession, msg: InputMsg): void {
    const admitted = this.gateway.admit(
      {
        clientId: session.clientId,
        seq: msg.seq,
        moveX: msg.moveX,
        moveZ: msg.moveZ,
        yaw: msg.yaw,
        buttons: msg.buttons,
        entity: msg.entity,
      },
      this.tick,
    );
    if (!admitted.ok) {
      session.socket.send(
        encodeFrame({ v: TRANSPORT_PROTOCOL, type: "error", category: admitted.category, reason: admitted.reason }),
      );
      return;
    }
    this.metrics.inputs++;
    this.replicator.setProcessedInput(session.clientId, admitted.input.seq);
    this.onAdmit?.(admitted.input, this.tick);
  }
}
