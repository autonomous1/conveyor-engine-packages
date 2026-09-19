import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthoritativeWorld } from "conveyor-engine-world";
import { Replicator, validateInput } from "../dist/index.js";

test("full then delta, relevance spawn/despawn, input validation", () => {
  const world = new AuthoritativeWorld();
  const owned = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  const far = world.createEntity(0n, { type: "crate", shape: "box" });
  world.enqueue({
    kind: "setTransform",
    entity: far,
    position: { x: 1000, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const near = world.createEntity(0n, { type: "crate", shape: "box" });
  world.enqueue({
    kind: "setTransform",
    entity: near,
    position: { x: 2, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const snap = world.commit(1n);
  const rep = new Replicator();
  rep.connect(1, owned, 16);
  const first = rep.publish(world, snap).get(1)!;
  assert.equal(first.kind, "full");
  const ids = new Set([...first.spawns.map((s) => s.entity), ...first.updates.map((u) => u.entity)]);
  assert.ok(ids.has(owned));
  assert.ok(ids.has(near));
  assert.ok(!ids.has(far));

  world.enqueue({
    kind: "setTransform",
    entity: owned,
    position: { x: 0.2, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const snap2 = world.commit(2n);
  const second = rep.publish(world, snap2).get(1)!;
  assert.equal(second.kind, "delta");
  assert.ok(second.updates.some((u) => u.entity === owned));

  const bad = validateInput({ clientId: 1, seq: 1, position: { x: 1 } }, 0);
  assert.equal(bad.ok, false);
  const good = validateInput({ clientId: 1, seq: 1, moveX: 0.5, moveZ: 0 }, 0);
  assert.equal(good.ok, true);
});
