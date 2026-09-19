import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthoritativeWorld, deriveLocomotion, intentFromVelocity } from "../dist/index.js";

test("locomotion thresholds are deterministic", () => {
  assert.equal(deriveLocomotion(0), "idle");
  assert.equal(deriveLocomotion(0.2), "idle");
  assert.equal(deriveLocomotion(0.21), "walk");
  assert.equal(deriveLocomotion(4), "run");
  assert.deepEqual(intentFromVelocity(3, 0).locomotion, "walk");
});

test("action epoch increments and is omitted from canonical when unused", () => {
  const w = new AuthoritativeWorld();
  const e = w.createEntity(0n, { type: "p", shape: "capsule" });
  w.commit(1n);
  assert.equal(w.canonicalPlain().entities[0]!.actionEpoch, undefined);
  assert.equal(w.triggerAction(e), 1);
  assert.equal(w.triggerAction(e), 2);
  w.commit(2n);
  assert.equal(w.snapshot().entities[0]!.actionEpoch, 2);
  assert.equal(w.canonicalPlain().entities[0]!.actionEpoch, 2);
});
