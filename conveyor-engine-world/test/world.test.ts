import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthoritativeWorld, CommitWindowError } from "../dist/index.js";

const ident = { x: 0, y: 0, z: 0, w: 1 };
const unit = { x: 1, y: 1, z: 1 };

test("stable ids, packed mutate, deterministic query and snapshot freeze", () => {
  const w = new AuthoritativeWorld({ worldVersion: "t" });
  const a = w.createEntity(1n, { type: "pawn", shape: "capsule" });
  const b = w.createEntity(1n, { type: "box", shape: "box" });
  w.enqueue({ kind: "setTransform", entity: a, position: { x: 1, y: 0, z: 0 }, rotation: ident, scale: unit });
  w.enqueue({ kind: "setOwnership", entity: a, owner: 7 });
  const snap = w.commit(1n);
  assert.equal(snap.tick, 1n);
  assert.equal(snap.entities.length, 2);
  assert.equal(snap.created[0], a);
  assert.ok(Object.isFrozen(snap));
  assert.ok(w.exists(a) && w.exists(b));
  const q = w.query({ owner: 7 });
  assert.equal(q.length, 1);
  assert.equal(q[0]!.id, a);
  const h1 = w.canonicalJson();
  const h2 = w.canonicalJson();
  assert.equal(h1, h2);
  w.enqueue({ kind: "destroy", entity: b });
  const snap2 = w.commit(2n);
  assert.deepEqual(snap2.destroyed, [b]);
  assert.equal(w.exists(b), false);
  assert.notEqual(w.canonicalJson(), h1);
});

test("movement applyInput is deterministic across worlds", () => {
  const w = new AuthoritativeWorld();
  const e = w.createEntity(0n, { type: "p", shape: "sphere" }, 1);
  w.commit(0n);
  w.enqueue({ kind: "applyInput", entity: e, seq: 1, moveX: 1, moveZ: 0, yaw: 0 });
  w.commit(1n);
  const v1 = w.store.view(e)!;
  const w2 = new AuthoritativeWorld();
  const e2 = w2.createEntity(0n, { type: "p", shape: "sphere" }, 1);
  w2.commit(0n);
  w2.enqueue({ kind: "applyInput", entity: e2, seq: 1, moveX: 1, moveZ: 0, yaw: 0 });
  w2.commit(1n);
  assert.deepEqual(w2.store.view(e2)!.position, v1.position);
});

test("mutating the packed store outside commit throws", () => {
  const w = new AuthoritativeWorld();
  const e = w.createEntity(0n, { type: "p", shape: "box" });
  w.commit(0n);
  assert.equal(w.store.commitOpen, false);
  assert.throws(() => w.store.setVelocity(e, { x: 1, y: 0, z: 0 }), CommitWindowError);
});

test("no-op tick advances tick but does not bump component versions", () => {
  const w = new AuthoritativeWorld();
  const e = w.createEntity(1n, { type: "p", shape: "box" });
  w.commit(1n);
  const before = w.store.view(e)!;
  const snap = w.commit(2n);
  const after = w.store.view(e)!;
  assert.equal(snap.tick, 2n);
  assert.equal(snap.created.length, 0);
  assert.equal(after.transformVersion, before.transformVersion);
  assert.equal(after.replicationVersion, before.replicationVersion);
  assert.deepEqual(after.position, before.position);
});

test("1k entity transform updates stay packed and finish quickly", () => {
  const w = new AuthoritativeWorld();
  const ids = [];
  for (let i = 0; i < 1000; i++) ids.push(w.createEntity(0n, { type: "p", shape: "box" }));
  w.commit(0n);
  const t0 = Date.now();
  for (let tick = 1n; tick <= 10n; tick++) {
    for (const id of ids) {
      w.enqueue({
        kind: "setTransform",
        entity: id,
        position: { x: Number(tick), y: 0, z: 0 },
        rotation: ident,
        scale: unit,
      });
    }
    w.commit(tick);
  }
  const ms = Date.now() - t0;
  assert.equal(w.store.entityCount, 1000);
  assert.equal(w.store.view(ids[0]!)!.position.x, 10);
  assert.ok(ms < 5_000, `1k x 10 commits took ${ms}ms`);
});

test("static AABB blocks movement with deterministic axis slide", () => {
  const w = new AuthoritativeWorld();
  w.addObstacle({ id: 2, minX: 1, maxX: 3, minZ: -1, maxZ: 1 });
  const e = w.createEntity(0n, { type: "p", shape: "sphere" }, 1);
  w.commit(0n);
  w.enqueue({ kind: "setTransform", entity: e, position: { x: 1, y: 0, z: 0 }, rotation: ident, scale: unit });
  w.commit(1n);
  const x = w.store.view(e)!.position.x;
  assert.ok(x <= 0.5 + 1e-9, `slid out, got x=${x}`);
  const w2 = new AuthoritativeWorld();
  w2.addObstacle({ id: 2, minX: 1, maxX: 3, minZ: -1, maxZ: 1 });
  const e2 = w2.createEntity(0n, { type: "p", shape: "sphere" }, 1);
  w2.commit(0n);
  w2.enqueue({ kind: "setTransform", entity: e2, position: { x: 1, y: 0, z: 0 }, rotation: ident, scale: unit });
  w2.commit(1n);
  assert.equal(w2.canonicalJson(), w.canonicalJson());
});

test("clearInput zeroes planar velocity", () => {
  const w = new AuthoritativeWorld();
  const e = w.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  w.commit(0n);
  w.enqueue({ kind: "applyInput", entity: e, seq: 1, moveX: 1, moveZ: 0, yaw: 0 });
  w.commit(1n);
  assert.ok(Math.hypot(w.store.view(e)!.velocity.x, w.store.view(e)!.velocity.z) > 0);
  w.clearInput(e);
  w.commit(2n);
  assert.equal(w.store.view(e)!.velocity.x, 0);
  assert.equal(w.store.view(e)!.velocity.z, 0);
});

test("despawn removes spatial occupancy", () => {
  const w = new AuthoritativeWorld();
  const a = w.createEntity(0n, { type: "p", shape: "box" });
  const b = w.createEntity(0n, { type: "p", shape: "box" });
  w.enqueue({ kind: "setTransform", entity: a, position: { x: 0, y: 0, z: 0 }, rotation: ident, scale: unit });
  w.enqueue({ kind: "setTransform", entity: b, position: { x: 1, y: 0, z: 0 }, rotation: ident, scale: unit });
  w.commit(1n);
  assert.equal(w.spatial.occupancy(), 2);
  assert.ok(w.queryRadius(0, 0, 8).some((e) => e.id === a));
  w.enqueue({ kind: "destroy", entity: a });
  w.commit(2n);
  assert.equal(w.exists(a), false);
  assert.equal(w.spatial.occupancy(), 1);
  assert.equal(w.queryRadius(0, 0, 8).some((e) => e.id === a), false);
  assert.ok(w.queryRadius(0, 0, 8).some((e) => e.id === b));
});
