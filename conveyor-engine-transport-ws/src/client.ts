import { localCompatibility, type ClientId, type Compatibility } from "conveyor-engine-core";
import type { SnapshotEnvelope } from "conveyor-engine-replication";
import { decodeFrame, encodeFrame } from "./codec.js";
import { parseWire, TRANSPORT_PROTOCOL, type ErrorMsg, type RejectMsg, type WelcomeMsg } from "./protocol.js";
import type { TransportSocket } from "./socket.js";

export type EngineWsClientOptions = {
  compatibility?: Compatibility;
  bundleId?: string;
  authoritativeHash?: string;
  expectedBundle?: { bundleId?: string; authoritativeHash?: string };
  token?: string;
  onWelcome?: (msg: WelcomeMsg) => void;
  onSnapshot?: (envelope: SnapshotEnvelope) => void;
  onReject?: (msg: RejectMsg) => void;
  onError?: (msg: ErrorMsg) => void;
  onClose?: () => void;
};

export type TransportClientMetrics = {
  sent: number;
  received: number;
  snapshots: number;
  errors: number;
};

export class EngineWsClient {
  readonly compatibility: Compatibility;
  clientId?: ClientId;
  sessionId?: number;
  reconnectToken?: string;
  ownedEntityId?: number;
  connected = false;
  readonly metrics: TransportClientMetrics = { sent: 0, received: 0, snapshots: 0, errors: 0 };
  private readonly socket: TransportSocket;
  private readonly opts: EngineWsClientOptions;

  constructor(socket: TransportSocket, opts: EngineWsClientOptions = {}) {
    this.socket = socket;
    this.opts = opts;
    this.compatibility = opts.compatibility ?? localCompatibility();
    socket.onMessage((text) => this.#onMessage(text));
    socket.onClose(() => {
      this.connected = false;
      this.opts.onClose?.();
    });
  }

  hello(): void {
    this.socket.send(
      encodeFrame({
        v: TRANSPORT_PROTOCOL,
        type: "hello",
        protocol: this.compatibility.protocol,
        world: this.compatibility.world,
        token: this.opts.token ?? this.reconnectToken,
        bundleId: this.opts.bundleId,
        authoritativeHash: this.opts.authoritativeHash,
      }),
    );
    this.metrics.sent++;
  }

  sendInput(input: { seq: number; moveX: number; moveZ: number; yaw?: number; buttons?: number; entity?: number }): void {
    this.socket.send(
      encodeFrame({
        v: TRANSPORT_PROTOCOL,
        type: "input",
        seq: input.seq,
        moveX: input.moveX,
        moveZ: input.moveZ,
        yaw: input.yaw ?? 0,
        buttons: input.buttons ?? 0,
        entity: input.entity,
      }),
    );
    this.metrics.sent++;
  }

  ack(snapshotSeq: number): void {
    this.socket.send(encodeFrame({ v: TRANSPORT_PROTOCOL, type: "ack", snapshotSeq }));
    this.metrics.sent++;
  }

  requestResync(): void {
    this.socket.send(encodeFrame({ v: TRANSPORT_PROTOCOL, type: "resync" }));
    this.metrics.sent++;
  }

  close(): void {
    this.socket.close();
    this.connected = false;
  }

  #onMessage(text: string): void {
    this.metrics.received++;
    let value: unknown;
    try {
      value = decodeFrame(text);
    } catch {
      this.metrics.errors++;
      return;
    }
    const parsed = parseWire(value);
    if ("error" in parsed) {
      this.metrics.errors++;
      return;
    }
    if (parsed.type === "welcome") {
      const exp = this.opts.expectedBundle;
      if (exp?.bundleId && parsed.bundleId && exp.bundleId !== parsed.bundleId) {
        this.metrics.errors++;
        this.opts.onReject?.({ v: TRANSPORT_PROTOCOL, type: "reject", reason: "welcome bundle mismatch", code: "WORLD_BUNDLE_MISMATCH" });
        this.close();
        return;
      }
      if (exp?.authoritativeHash && parsed.authoritativeHash && exp.authoritativeHash !== parsed.authoritativeHash) {
        this.metrics.errors++;
        this.opts.onReject?.({ v: TRANSPORT_PROTOCOL, type: "reject", reason: "welcome hash mismatch", code: "AUTHORITATIVE_CONTENT_MISMATCH" });
        this.close();
        return;
      }
      this.connected = true;
      this.clientId = parsed.clientId;
      this.sessionId = parsed.sessionId;
      this.reconnectToken = parsed.reconnectToken;
      this.ownedEntityId = parsed.ownedEntityId;
      this.opts.onWelcome?.(parsed);
    } else if (parsed.type === "snapshot") {
      this.metrics.snapshots++;
      this.opts.onSnapshot?.(parsed.envelope);
    } else if (parsed.type === "reject") {
      this.metrics.errors++;
      this.opts.onReject?.(parsed);
    } else if (parsed.type === "error") {
      this.metrics.errors++;
      this.opts.onError?.(parsed);
    }
  }
}
