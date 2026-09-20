import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthoritativeWorld } from "conveyor-engine-world";
import { ClientMirror } from "conveyor-engine-replication";
import { EngineWsClient, EngineWsServer, memoryPair } from "../dist/index.js";

function flush(): void {
  /* memory sockets are synchronous */
}

test("compatible handshake assigns session; incompatible world is rejected", () => {
  const pair = memoryPair();
  const server = new EngineWsServer();
  server.attach(pair.server);
  let welcome = 0;
  let reject = "";
  const ok = new EngineWsClient(pair.client, { onWelcome: () => welcome++ });
  ok.hello();
  flush();
  assert.equal(welcome, 1);
  assert.equal(ok.clientId, 1);
  assert.ok(ok.reconnectToken);

  const badPair = memoryPair();
  server.attach(badPair.server);
  const bad = new EngineWsClient(badPair.client, {
    compatibility: { protocol: 1, world: "other" },
    onReject: (m) => {
      reject = m.reason;
    },
  });
  bad.hello();
  assert.match(reject, /world/);
  assert.equal(server.metrics.rejected, 1);
});

test("admitted input reaches onAdmit; snapshots are delivered and mirrored", () => {
  const world = new AuthoritativeWorld();
  const pawn = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
  world.commit(0n);
  const admitted: number[] = [];
  const pair = memoryPair();
  const server = new EngineWsServer({
    onHello: () => pawn,
    onAdmit: (input) => admitted.push(input.seq),
  });
  server.attach(pair.server);
  const snapshots: string[] = [];
  const mirror = new ClientMirror();
  const client = new EngineWsClient(pair.client, {
    onSnapshot: (env) => {
      snapshots.push(env.kind);
      mirror.apply(env);
    },
  });
  client.hello();
  server.setTick(1n);
  client.sendInput({ seq: 1, moveX: 1, moveZ: 0 });
  assert.deepEqual(admitted, [1]);
  const snap = world.commit(1n);
  const env = server.replicator.publish(world, snap).get(1)!;
  assert.equal(env.kind, "full");
  server.sendSnapshot(1, env);
  assert.deepEqual(snapshots, ["full"]);
  assert.ok(mirror.view(pawn));

  world.enqueue({
    kind: "setTransform",
    entity: pawn,
    position: { x: 2, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const snap2 = world.commit(2n);
  const delta = server.replicator.publish(world, snap2).get(1)!;
  assert.equal(delta.kind, "delta");
  server.sendSnapshot(1, delta);
  assert.deepEqual(snapshots, ["full", "delta"]);
});

test("disconnect clears session; reconnect with token forces resync", () => {
  const pair = memoryPair();
  const server = new EngineWsServer({ onHello: () => 10 });
  server.attach(pair.server);
  const client = new EngineWsClient(pair.client);
  client.hello();
  const token = client.reconnectToken!;
  assert.deepEqual(server.connected, [1]);
  client.close();
  assert.deepEqual(server.connected, []);
  assert.equal(server.gateway.get(1)?.connected, false);

  const pair2 = memoryPair();
  server.attach(pair2.server);
  const client2 = new EngineWsClient(pair2.client, { token });
  client2.hello();
  assert.equal(client2.clientId, 1);
  assert.equal(client2.ownedEntityId, 10);
  assert.equal(server.replicator.get(1)?.needsFull, true);
});

test("welcome carries owned entity; ack advances replicator baseline", () => {
  const world = new AuthoritativeWorld();
  const pawn = world.createEntity(0n, { type: "p", shape: "capsule" }, 7);
  world.commit(0n);
  const pair = memoryPair();
  const server = new EngineWsServer({ onHello: () => pawn });
  server.attach(pair.server);
  const kinds = [];
  const client = new EngineWsClient(pair.client, {
    onSnapshot: (env) => kinds.push(env.kind),
  });
  client.hello();
  assert.equal(client.ownedEntityId, pawn);
  const snap = world.commit(1n);
  const full = server.replicator.publish(world, snap).get(1);
  assert.equal(full.kind, "full");
  server.sendSnapshot(1, full);
  client.ack(full.seq);
  assert.equal(server.replicator.get(1).lastAckSeq, full.seq);
  world.enqueue({
    kind: "setTransform",
    entity: pawn,
    position: { x: 1, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  const snap2 = world.commit(2n);
  const delta = server.replicator.publish(world, snap2).get(1);
  assert.equal(delta.kind, "delta");
  server.sendSnapshot(1, delta);
  assert.deepEqual(kinds, ["full", "delta"]);
});

test("malformed and oversized frames do not drop the process", () => {
  const pair = memoryPair();
  const server = new EngineWsServer({ maxFrameBytes: 32 });
  server.attach(pair.server);
  const errors: string[] = [];
  const client = new EngineWsClient(pair.client, { onError: (e) => errors.push(e.reason) });
  client.hello();
  pair.client.send("{not-json");
  pair.client.send("x".repeat(64));
  assert.ok(server.metrics.malformed >= 1);
  assert.ok(server.metrics.oversized >= 1);
  assert.ok(errors.includes("malformed"));
  assert.ok(errors.includes("oversized"));
});

test("per-tick frame cap rate-limits a chatty client", () => {
  const pair = memoryPair();
  const server = new EngineWsServer({ maxFramesPerTick: 2, onHello: () => 10 });
  server.attach(pair.server);
  const reasons: string[] = [];
  const client = new EngineWsClient(pair.client, { onError: (e) => reasons.push(e.reason) });
  client.hello();
  server.setTick(1n);
  client.sendInput({ seq: 1, moveX: 0, moveZ: 0 });
  client.sendInput({ seq: 2, moveX: 0, moveZ: 0 });
  client.sendInput({ seq: 3, moveX: 0, moveZ: 0 });
  assert.ok(server.metrics.rateLimited >= 1);
  assert.ok(reasons.includes("rate-limit"));
});
