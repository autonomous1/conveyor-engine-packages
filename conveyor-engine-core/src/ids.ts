/**
 * Stable identifier types.
 *
 * Entity ids are positive JavaScript-safe integers. They are independent of
 * object identity, array index, Object3D.uuid, and random UUIDs.
 *
 * Tick is bigint internally (simulator dueTick / canonical-v1 `$i`). Wire
 * encoding for a live transport is deferred to the transport package.
 */

export type EntityId = number;
export type ClientId = number;
export type SessionId = number;
export type Tick = bigint;
export type SnapshotSeq = number;
export type InputSeq = number;
export type ComponentId = number;
export type ResourceId = string;
export type OwnerId = ClientId | 0;
export type Version = number;
export type WorldConfigId = string;
export type ProtocolVersion = number;

export const NO_OWNER: OwnerId = 0;
export const PROTOCOL_VERSION: ProtocolVersion = 1;
export const ENGINE_PACKAGE_VERSION = "0.0.1";

export const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;

export function isValidEntityId(id: unknown): id is EntityId {
  return typeof id === "number" && Number.isInteger(id) && id > 0 && id <= MAX_SAFE_ID;
}

export function isValidClientId(id: unknown): id is ClientId {
  return typeof id === "number" && Number.isInteger(id) && id > 0 && id <= MAX_SAFE_ID;
}

export function isValidTick(tick: unknown): tick is Tick {
  return typeof tick === "bigint" && tick >= 0n;
}

export function assertEntityId(id: EntityId): EntityId {
  if (!isValidEntityId(id)) throw new Error(`invalid entity id: ${String(id)}`);
  return id;
}

export function assertTick(tick: Tick): Tick {
  if (!isValidTick(tick)) throw new Error(`invalid tick: ${String(tick)}`);
  return tick;
}

export function compareId(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareTick(a: Tick, b: Tick): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
