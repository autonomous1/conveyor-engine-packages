import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthoritativeWorld } from "conveyor-engine-world";
import { InputGateway, validateInput } from "../dist/index.js";

test("valid input moves only the owned entity", () => {
  const world = new AuthoritativeWorld();
  const pawn = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  const other = world.createEntity(0n, { type: "p", shape: "capsule" }, 2);
  world.commit(0n);
  const gw = new InputGateway();
  gw.connect(1, pawn);
  const admitted = gw.admit({ clientId: 1, seq: 1, moveX: 1, moveZ: 0 }, 1n);
  assert.equal(admitted.ok, true);
  if (admitted.ok) gw.enqueueMovement(world, admitted.input);
  world.commit(1n);
  assert.ok(world.store.view(pawn)!.position.x > 0);
  assert.equal(world.store.view(other)!.position.x, 0);
});

test("input targeting another entity is rejected", () => {
  const gw = new InputGateway();
  gw.connect(1, 10);
  const r = gw.admit({ clientId: 1, seq: 1, moveX: 1, entity: 99 }, 1n);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "not-owner");
});

test("duplicate and old sequences do not apply twice", () => {
  const world = new AuthoritativeWorld();
  const pawn = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  world.commit(0n);
  const gw = new InputGateway();
  gw.connect(1, pawn);
  const a = gw.admit({ clientId: 1, seq: 1, moveX: 1 }, 1n);
  assert.equal(a.ok, true);
  if (a.ok) gw.enqueueMovement(world, a.input);
  world.commit(1n);
  const x = world.store.view(pawn)!.position.x;
  const dup = gw.admit({ clientId: 1, seq: 1, moveX: 1 }, 2n);
  assert.equal(dup.ok, false);
  world.commit(2n);
  assert.equal(world.store.view(pawn)!.position.x, x);
});

test("future, non-finite, oversized, and rate-limited inputs are rejected", () => {
  const gw = new InputGateway({ policy: { maxPerTick: 1, maxBytes: 40, maxFuture: 2, maxAbsMove: 1, maxSeqGap: 32, maxOld: 64 } });
  gw.connect(1, 10);
  assert.equal(validateInput({ clientId: 1, seq: 1, moveX: Number.NaN }, 0).ok, false);
  assert.equal(validateInput({ clientId: 1, seq: 1, moveX: Infinity }, 0).ok, false);
  assert.equal(gw.admit({ clientId: 1, seq: 99, moveX: 1 }, 1n).ok, false);
  const big = { clientId: 1, seq: 1, moveX: 1, pad: "x".repeat(80) };
  assert.equal(validateInput(big, 0, gw.policy).ok, false);
  const first = gw.admit({ clientId: 1, seq: 1, moveX: 1 }, 1n);
  assert.equal(first.ok, true);
  const second = gw.admit({ clientId: 1, seq: 2, moveX: 1 }, 1n);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, "rate-limit");
});

test("disconnect and missing session cannot move the world", () => {
  const world = new AuthoritativeWorld();
  const pawn = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  world.commit(0n);
  const gw = new InputGateway();
  gw.connect(1, pawn);
  gw.disconnect(1);
  const r = gw.admit({ clientId: 1, seq: 1, moveX: 1 }, 1n);
  assert.equal(r.ok, false);
  assert.equal(gw.enqueueMovement(world, { clientId: 1, seq: 1, moveX: 1, moveZ: 0, yaw: 0 }), false);
  world.commit(1n);
  assert.equal(world.store.view(pawn)!.position.x, 0);
});
