import { PROTOCOL_VERSION, type ProtocolVersion, type WorldConfigId } from "./ids.js";

export type Compatibility = {
  protocol: ProtocolVersion;
  world: WorldConfigId;
};

export function handshakeCompatible(
  local: Compatibility,
  remote: Compatibility,
): { ok: true } | { ok: false; reason: string } {
  if (remote.protocol !== local.protocol) {
    return { ok: false, reason: `protocol ${remote.protocol} != ${local.protocol}` };
  }
  if (remote.world !== local.world) {
    return { ok: false, reason: `world ${remote.world} != ${local.world}` };
  }
  return { ok: true };
}

export function localCompatibility(world: WorldConfigId = "world-v1"): Compatibility {
  return { protocol: PROTOCOL_VERSION, world };
}

export const BundleMismatchCode = {
  PROTOCOL_MISMATCH: "PROTOCOL_MISMATCH",
  WORLD_BUNDLE_MISMATCH: "WORLD_BUNDLE_MISMATCH",
  AUTHORITATIVE_CONTENT_MISMATCH: "AUTHORITATIVE_CONTENT_MISMATCH",
  AUTHORITATIVE_CONTENT_UNAVAILABLE: "AUTHORITATIVE_CONTENT_UNAVAILABLE",
  INVALID_WORLD_BUNDLE: "INVALID_WORLD_BUNDLE",
} as const;

export type BundleMismatchCode = (typeof BundleMismatchCode)[keyof typeof BundleMismatchCode];

export type BundleIdentity = {
  bundleId?: string;
  authoritativeHash?: string;
};

export function handshakeBundleCompatible(
  server: BundleIdentity,
  client: BundleIdentity,
): { ok: true } | { ok: false; code: BundleMismatchCode; reason: string } {
  if (!server.bundleId && !server.authoritativeHash) return { ok: true };
  if (!client.bundleId && !client.authoritativeHash) {
    return { ok: true };
  }
  if (server.bundleId && client.bundleId && server.bundleId !== client.bundleId) {
    return {
      ok: false,
      code: BundleMismatchCode.WORLD_BUNDLE_MISMATCH,
      reason: `bundle ${client.bundleId} != ${server.bundleId}`,
    };
  }
  if (server.authoritativeHash && client.authoritativeHash && server.authoritativeHash !== client.authoritativeHash) {
    return {
      ok: false,
      code: BundleMismatchCode.AUTHORITATIVE_CONTENT_MISMATCH,
      reason: "authoritative compatibility hash mismatch",
    };
  }
  return { ok: true };
}
