import assert from "node:assert/strict";
import { test } from "node:test";
import { EngineClient } from "../dist/index.js";

test("predict, ack, replay, interpolate remote, freeze render snapshot", () => {
  const c = new EngineClient(1);
  c.connect(10);
  const view = (id: number, x: number, owner = 0) => ({
    id,
    owner,
    position: { x, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    radius: 0.5,
    replicationVersion: 1,
    inputSeq: 0,
    render: { type: "p", shape: "capsule" },
  });
  c.applySnapshot({
    kind: "full",
    seq: 1,
    tick: 1n,
    lastProcessedInput: 0,
    spawns: [
      { entity: 10, view: view(10, 0, 1) },
      { entity: 11, view: view(11, 5) },
    ],
    updates: [],
    despawns: [],
  }, 1000);
  const i1 = c.collectInput({ moveX: 1, moveZ: 0, yaw: 0, buttons: 0 });
  const i2 = c.collectInput({ moveX: 1, moveZ: 0, yaw: 0, buttons: 0 });
  assert.equal(i1.seq, 1);
  assert.equal(i2.seq, 2);
  assert.ok((c as unknown as { predicted?: { position: { x: number } } }).predicted);
  c.applySnapshot({
    kind: "delta",
    seq: 2,
    tick: 2n,
    lastProcessedInput: 1,
    spawns: [],
    updates: [{ entity: 10, view: { ...view(10, 0.1, 1), inputSeq: 1, replicationVersion: 2 } }],
    despawns: [],
  }, 1100);
  assert.equal(c.metrics.lastAckInput, 1);
  assert.equal(c.metrics.unacked, 1);
  const rs = c.renderSnapshot(1200);
  assert.ok(Object.isFrozen(rs));
  assert.equal(rs.entities.length, 2);
  const owned = rs.entities.find((e) => e.id === 10)!;
  const remote = rs.entities.find((e) => e.id === 11)!;
  assert.equal(owned.predicted, true);
  assert.equal(remote.predicted, false);
});

test("stale and reordered snapshots are ignored", () => {
  const c = new EngineClient(1);
  c.connect(10);
  const view = (x: number) => ({
    id: 10,
    owner: 1,
    position: { x, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    radius: 0.5,
    replicationVersion: 1,
    inputSeq: 0,
    render: { type: "p", shape: "capsule" },
  });
  c.applySnapshot({
    kind: "full",
    seq: 2,
    tick: 2n,
    lastProcessedInput: 0,
    spawns: [{ entity: 10, view: view(4) }],
    updates: [],
    despawns: [],
  }, 200);
  c.applySnapshot({
    kind: "delta",
    seq: 1,
    tick: 1n,
    lastProcessedInput: 0,
    spawns: [],
    updates: [{ entity: 10, view: view(0) }],
    despawns: [],
  }, 300);
  assert.equal(c.metrics.staleSnapshots, 1);
  assert.equal(c.authoritative(10)!.position.x, 4);
});

test("single-sample extrapolation uses velocity then holds after extraMs", () => {
  const c = new EngineClient(1, { delayMs: 0, extraMs: 50 });
  const view = {
    id: 11,
    owner: 0,
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    velocity: { x: 10, y: 0, z: 0 },
    radius: 0.5,
    replicationVersion: 1,
    inputSeq: 0,
    render: { type: "p", shape: "box" },
  };
  c.applySnapshot({
    kind: "full",
    seq: 1,
    tick: 1n,
    lastProcessedInput: 0,
    spawns: [{ entity: 11, view }],
    updates: [],
    despawns: [],
  }, 1000);
  const moving = c.renderSnapshot(1020).entities.find((e) => e.id === 11)!;
  assert.ok(moving.position.x > 0);
  assert.ok(moving.position.x < 0.3);
  const held = c.renderSnapshot(1200).entities.find((e) => e.id === 11)!;
  assert.equal(held.position.x, 0);
});

test("soft correction blends presentation; hard correction snaps", () => {
  const soft = new EngineClient(1, { present: { blend: 0.5 }, policy: { softDistance: 0.25, hardDistance: 4, maxHistory: 64 } });
  soft.connect(10);
  const view = (x: number) => ({
    id: 10,
    owner: 1,
    position: { x, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    velocity: { x: 0, y: 0, z: 0 },
    radius: 0.5,
    replicationVersion: 1,
    inputSeq: 0,
    render: { type: "p", shape: "capsule" },
  });
  soft.applySnapshot({
    kind: "full",
    seq: 1,
    tick: 1n,
    lastProcessedInput: 0,
    spawns: [{ entity: 10, view: view(0) }],
    updates: [],
    despawns: [],
  }, 0);
  soft.collectInput({ moveX: 1, moveZ: 0, yaw: 0, buttons: 0 });
  const afterPredict = soft.renderSnapshot(10).entities.find((e) => e.id === 10)!.position.x;
  soft.applySnapshot({
    kind: "delta",
    seq: 2,
    tick: 2n,
    lastProcessedInput: 0,
    spawns: [],
    updates: [{ entity: 10, view: { ...view(0.05), replicationVersion: 2 } }],
    despawns: [],
  }, 20);
  const blended = soft.renderSnapshot(30).entities.find((e) => e.id === 10)!.position.x;
  assert.ok(blended !== afterPredict);

  const hard = new EngineClient(1, { policy: { softDistance: 0.1, hardDistance: 0.01, maxHistory: 64 } });
  hard.connect(10);
  hard.applySnapshot({
    kind: "full",
    seq: 1,
    tick: 1n,
    lastProcessedInput: 0,
    spawns: [{ entity: 10, view: view(0) }],
    updates: [],
    despawns: [],
  }, 0);
  hard.collectInput({ moveX: 1, moveZ: 0, yaw: 0, buttons: 0 });
  hard.applySnapshot({
    kind: "delta",
    seq: 2,
    tick: 2n,
    lastProcessedInput: 0,
    spawns: [],
    updates: [{ entity: 10, view: { ...view(10), replicationVersion: 2 } }],
    despawns: [],
  }, 20);
  const snapped = hard.renderSnapshot(30).entities.find((e) => e.id === 10)!.position.x;
  assert.ok(Math.abs(snapped - 10) < 1 || snapped > 1);
});
