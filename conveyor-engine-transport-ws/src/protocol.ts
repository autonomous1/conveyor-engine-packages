import { PROTOCOL_VERSION, type ClientId, type ProtocolVersion, type WorldConfigId } from "conveyor-engine-core";
import type { SnapshotEnvelope, ValidatedInput } from "conveyor-engine-replication";

export const TRANSPORT_PROTOCOL = PROTOCOL_VERSION;

export type HelloMsg = {
  v: ProtocolVersion;
  type: "hello";
  protocol: ProtocolVersion;
  world: WorldConfigId;
  token?: string;
  bundleId?: string;
  authoritativeHash?: string;
  presentationHash?: string;
};

export type WelcomeMsg = {
  v: ProtocolVersion;
  type: "welcome";
  clientId: ClientId;
  sessionId: number;
  protocol: ProtocolVersion;
  world: WorldConfigId;
  reconnectToken: string;
  ownedEntityId?: number;
  bundleId?: string;
  authoritativeHash?: string;
};

export type RejectMsg = {
  v: ProtocolVersion;
  type: "reject";
  reason: string;
  code?: string;
};

export type InputMsg = {
  v: ProtocolVersion;
  type: "input";
  seq: number;
  moveX: number;
  moveZ: number;
  yaw: number;
  buttons: number;
  entity?: number;
};

export type SnapshotMsg = {
  v: ProtocolVersion;
  type: "snapshot";
  envelope: SnapshotEnvelope;
};

export type AckMsg = {
  v: ProtocolVersion;
  type: "ack";
  snapshotSeq: number;
};

export type ResyncMsg = {
  v: ProtocolVersion;
  type: "resync";
};

export type ErrorMsg = {
  v: ProtocolVersion;
  type: "error";
  category: string;
  reason: string;
};

export type WireMsg = HelloMsg | WelcomeMsg | RejectMsg | InputMsg | SnapshotMsg | AckMsg | ResyncMsg | ErrorMsg;

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function parseWire(value: unknown): WireMsg | { error: string } {
  if (!isObject(value) || typeof value.type !== "string") return { error: "malformed" };
  if (value.v !== TRANSPORT_PROTOCOL) return { error: "bad-protocol" };
  return value as WireMsg;
}

export function inputFromMsg(msg: InputMsg, clientId: ClientId): ValidatedInput {
  return {
    clientId,
    seq: msg.seq,
    moveX: msg.moveX,
    moveZ: msg.moveZ,
    yaw: msg.yaw,
    buttons: msg.buttons,
    entity: msg.entity,
  };
}
