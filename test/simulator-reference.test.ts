import assert from "node:assert/strict";
import { test } from "node:test";
import { defineScenario, run } from "conveyor-graph-simulator/reference";
import { SimulatedWorld } from "conveyor-engine-world";
import { SimulatedReplication } from "conveyor-engine-replication";

function movementScenario() {
  const host: { world?: SimulatedWorld; rep?: SimulatedReplication } = {};
  return defineScenario({
    id: "engine-movement-hash",
    seed: 7n,
    initialState: {},
    ticks: 6,
    buildAdmit(g, ctx) {
      host.world = new SimulatedWorld();
      host.world.buildAdmit(g, ctx);
    },
    buildSim(g, ctx) {
      host.world!.buildSim(g, ctx);
    },
    buildPublish(g, ctx) {
      host.rep = new SimulatedReplication(host.world!.world, () => host.world!.lastSnapshot);
      host.rep.replicator.connect(1, undefined, 32);
      host.rep.buildPublish(g, ctx);
    },
    schedule(rt, due) {
      rt.scheduleExternal(`in-${due}`, {
        type: "input",
        clientId: 1,
        seq: Number(due),
        moveX: 1,
        moveZ: 0,
        yaw: 0,
        ...(due === 1n
          ? { create: { render: { type: "pawn", shape: "capsule" }, owner: 1 } }
          : {}),
      });
    },
  });
}

test("reference runtime hashes world projection and replay verifies", async () => {
  const a = await run(movementScenario(), "deterministicFast");
  const b = await run(movementScenario(), "deterministicFast");
  assert.equal(a.hashes.length, 7);
  assert.deepEqual(a.hashes, b.hashes);
  const world = a.runtime.store.read(["world"]) as { tick: bigint; entities: Array<{ position: { x: number } }> };
  assert.ok(world);
  assert.equal(world.tick, 6n);
  assert.ok(world.entities[0]!.position.x > 0);

  const verified = await run(movementScenario(), "replayVerify");
  assert.equal(verified.report?.ok, true);
});
