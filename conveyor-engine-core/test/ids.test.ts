import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isValidEntityId,
  isValidTick,
  PROTOCOL_VERSION,
  assertLegalNumber,
  handshakeCompatible,
  localCompatibility,
} from "../dist/index.js";

test("entity ids are positive safe integers", () => {
  assert.equal(isValidEntityId(1), true);
  assert.equal(isValidEntityId(0), false);
  assert.equal(isValidEntityId(-1), false);
  assert.equal(isValidEntityId(1.5), false);
  assert.equal(PROTOCOL_VERSION, 1);
});

test("ticks are non-negative bigint", () => {
  assert.equal(isValidTick(0n), true);
  assert.equal(isValidTick(7n), true);
  assert.equal(isValidTick(-1n), false);
  assert.equal(isValidTick(0), false);
});

test("ingress rejects NaN, infinity, and -0", () => {
  assert.throws(() => assertLegalNumber(Number.NaN, "x"));
  assert.throws(() => assertLegalNumber(Infinity, "x"));
  assert.throws(() => assertLegalNumber(-Infinity, "x"));
  assert.throws(() => assertLegalNumber(-0, "x"));
  assert.equal(assertLegalNumber(1.5, "x"), 1.5);
});

test("protocol handshake requires matching protocol and world", () => {
  const local = localCompatibility("world-v1");
  assert.equal(handshakeCompatible(local, local).ok, true);
  assert.equal(handshakeCompatible(local, { protocol: 2, world: "world-v1" }).ok, false);
  assert.equal(handshakeCompatible(local, { protocol: 1, world: "other" }).ok, false);
});
