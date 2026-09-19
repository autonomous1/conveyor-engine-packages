import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthoritativeWorld } from "conveyor-engine-world";
import { ClientMirror, Replicator } from "../dist/index.js";

const Q = { x: 0, y: 0, z: 0, w: 1 };
const S = { x: 1, y: 1, z: 1 };

function place(world: AuthoritativeWorld, id: number, x: number, z: number) {
  world.enqueue({
    kind: "setTransform",
    entity: id,
    position: { x, y: 0, z },
    rotation: Q,
    scale: S,
  });
}

test("two clients receive distinct relevance sets; owned always included", () => {
  const world = new AuthoritativeWorld();
  const a = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  const b = world.createEntity(0n, { type: "p", shape: "capsule" }, 2);
  const crate = world.createEntity(0n, { type: "crate", shape: "box" });
  place(world, a, 0, 0);
  place(world, b, 200, 0);
  place(world, crate, 2, 0);
  const snap = world.commit(1n);
  const rep = new Replicator();
  rep.connect(1, a, 16);
  rep.connect(2, b, 16);
  const envs = rep.publish(world, snap);
  const ids = (client: number) => {
    const e = envs.get(client)!;
    return new Set([...e.spawns, ...e.updates].map((r) => r.entity));
  };
  assert.ok(ids(1).has(a) && ids(1).has(crate) && !ids(1).has(b));
  assert.ok(ids(2).has(b) && !ids(2).has(a) && !ids(2).has(crate));
});

test("entering and leaving relevance emits spawn then despawn; mirror reconstructs", () => {
  const world = new AuthoritativeWorld();
  const pawn = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  const crate = world.createEntity(0n, { type: "crate", shape: "box" });
  place(world, pawn, 0, 0);
  place(world, crate, 100, 0);
  let snap = world.commit(1n);
  const rep = new Replicator();
  rep.connect(1, pawn, 16);
  const mirror = new ClientMirror();
  mirror.apply(rep.publish(world, snap).get(1)!);
  assert.equal(mirror.view(crate), undefined);

  place(world, crate, 2, 0);
  snap = world.commit(2n);
  const enter = rep.publish(world, snap).get(1)!;
  assert.ok(enter.spawns.some((s) => s.entity === crate));
  mirror.apply(enter);
  assert.ok(mirror.view(crate)?.present);

  place(world, crate, 100, 0);
  snap = world.commit(3n);
  const leave = rep.publish(world, snap).get(1)!;
  assert.ok(leave.despawns.some((d) => d.entity === crate && d.reason === "relevance-leave"));
  mirror.apply(leave);
  assert.equal(mirror.view(crate), undefined);
});

test("delta after full reconstructs; stale and duplicate records are ignored", () => {
  const world = new AuthoritativeWorld();
  const pawn = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  place(world, pawn, 0, 0);
  const snap1 = world.commit(1n);
  const rep = new Replicator();
  rep.connect(1, pawn, 32);
  const full = rep.publish(world, snap1).get(1)!;
  const mirror = new ClientMirror();
  mirror.apply(full);
  const ignored0 = mirror.ignored;
  mirror.apply(full);
  assert.ok(mirror.ignored > ignored0);

  place(world, pawn, 1, 0);
  const snap2 = world.commit(2n);
  const delta = rep.publish(world, snap2).get(1)!;
  assert.equal(delta.kind, "delta");
  mirror.apply(delta);
  assert.equal(mirror.view(pawn)!.position.x, 1);

  const stale = { ...delta, seq: delta.seq - 1, kind: "delta" as const };
  const before = mirror.view(pawn)!.position.x;
  mirror.apply(stale);
  assert.equal(mirror.view(pawn)!.position.x, before);

  const updateFirst = {
    ...delta,
    seq: delta.seq + 10,
    kind: "delta" as const,
    spawns: [],
    updates: delta.updates,
    despawns: [],
  };
  const empty = new ClientMirror();
  empty.apply(updateFirst);
  assert.equal(empty.view(pawn), undefined);
});

test("resync forces a full snapshot; tight budget still keeps owned entity", () => {
  const world = new AuthoritativeWorld();
  const pawn = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  const extras = [];
  place(world, pawn, 0, 0);
  for (let i = 0; i < 8; i++) {
    const id = world.createEntity(0n, { type: "crate", shape: "box" });
    extras.push(id);
    place(world, id, 1 + i * 0.1, 0);
  }
  const snap = world.commit(1n);
  const rep = new Replicator({ maxBytes: 80, maxEntities: 1, maxPendingLifecycle: 8 });
  rep.connect(1, pawn, 48);
  const first = rep.publish(world, snap).get(1)!;
  const ids = new Set([...first.spawns, ...first.updates].map((r) => r.entity));
  assert.ok(ids.has(pawn));
  assert.equal(ids.size, 1);
  assert.ok(rep.metrics.deferred > 0);
  rep.requestResync(1);
  const again = rep.publish(world, snap).get(1)!;
  assert.equal(again.kind, "full");
});
