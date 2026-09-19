import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthoritativeWorld } from "./conveyor-engine-world/dist/index.js";
import { Replicator, validateInput } from "./conveyor-engine-replication/dist/index.js";
import { EngineClient } from "./conveyor-engine-client/dist/index.js";
import { ThreeProjector, memoryScene } from "./conveyor-engine-three/dist/index.js";

test("world → replicate → predict → project loopback", () => {
  const world = new AuthoritativeWorld();
  const pawn = world.createEntity(0n, { type: "pawn", shape: "capsule", color: 0x33aa66 }, 1);
  world.commit(0n);
  const rep = new Replicator();
  rep.connect(1, pawn, 32);
  const client = new EngineClient(1);
  client.connect(pawn);
  const scene = memoryScene();
  const three = new ThreeProjector(scene);

  for (let tick = 1; tick <= 8; tick++) {
    const raw = { clientId: 1, seq: tick, moveX: 1, moveZ: 0, yaw: 0 };
    const admitted = validateInput(raw, rep.get(1)!.lastProcessedInput);
    assert.equal(admitted.ok, true);
    if (admitted.ok) {
      world.enqueue({
        kind: "applyInput",
        entity: pawn,
        seq: admitted.input.seq,
        moveX: admitted.input.moveX,
        moveZ: admitted.input.moveZ,
        yaw: admitted.input.yaw,
      });
      rep.setProcessedInput(1, admitted.input.seq);
      client.collectInput({
        moveX: admitted.input.moveX,
        moveZ: admitted.input.moveZ,
        yaw: admitted.input.yaw,
        buttons: 0,
      });
    }
    const snap = world.commit(BigInt(tick));
    const env = rep.publish(world, snap).get(1)!;
    client.applySnapshot({
      kind: env.kind,
      seq: env.seq,
      tick: env.tick,
      lastProcessedInput: env.lastProcessedInput,
      spawns: env.spawns.map((s) => ({ entity: s.entity, view: s.view })),
      updates: env.updates.map((u) => ({ entity: u.entity, view: u.view })),
      despawns: env.despawns.map((d) => ({ entity: d.entity })),
    }, tick * 50);
    three.apply(client.renderSnapshot(tick * 50 + 10));
  }

  const view = world.store.view(pawn)!;
  assert.ok(view.position.x > 0);
  assert.equal(client.metrics.lastAckInput, 8);
  assert.equal(three.binding(pawn)?.object.visible, true);
  assert.ok(Object.isFrozen(world.snapshot()));
});
