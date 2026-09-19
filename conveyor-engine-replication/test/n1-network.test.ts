import assert from "node:assert/strict";
import { test } from "node:test";
import { defineScenario, run, type LinkProfile, type NetworkScheduler } from "conveyor-graph-simulator/reference";
import { SimulatedNetPath } from "../dist/index.js";

const Q = { type: "pawn" as const, shape: "capsule" as const };

function twoClientScenario(id: string, seed: bigint, profile: LinkProfile, ticks = 6, extra?: (path: SimulatedNetPath, net: NetworkScheduler) => void) {
  const path = new SimulatedNetPath({ radius: 24 });
  return {
    path,
    scenario: defineScenario({
      id,
      seed,
      initialState: {},
      ticks,
      setupNetwork(net) {
        path.setupNetwork(net, profile);
        extra?.(path, net);
      },
      buildAdmit(g, ctx) {
        path.buildAdmit(g, ctx);
      },
      buildSim(g, ctx) {
        path.buildSim(g, ctx);
      },
      schedule(rt, due) {
        if (due === 5n) path.replicator.requestResync(1);
        rt.scheduleExternal(`t-${due}`, {
          creates:
            due === 1n
              ? [
                  { render: Q, owner: 1 },
                  { render: Q, owner: 2 },
                  { render: { type: "crate", shape: "box" } },
                ]
              : undefined,
          inputs:
            due === 1n
              ? []
              : [
                  { clientId: 1, seq: Number(due) - 1, moveX: 1, moveZ: 0 },
                  { clientId: 2, seq: Number(due) - 1, moveX: 0, moveZ: 1 },
                ],
        });
      },
    }),
  };
}

test("N1 lossless: identical world hashes and both mirrors see both pawns", async () => {
  const a = twoClientScenario("n1-loss-a", 11n, {});
  const b = twoClientScenario("n1-loss-b", 11n, {});
  const ra = await run(a.scenario, "deterministicFast");
  const rb = await run(b.scenario, "deterministicFast");
  assert.deepEqual(ra.hashes, rb.hashes);
  for (const path of [a.path, b.path]) {
    assert.ok(path.deliveries > 0);
    const m1 = path.mirrors.get(1)!;
    const m2 = path.mirrors.get(2)!;
    assert.equal(m1.ids().length >= 2, true);
    assert.equal(m2.ids().length >= 2, true);
  }
});

test("N1 drop+resync: partition then heal delivers a full snapshot to the mirror", async () => {
  const pack = twoClientScenario("n1-part", 13n, {}, 8, (path, net) => {
    path.partition(net, 1, 1n, 4n);
  });
  await run(pack.scenario, "deterministicFast");
  const m1 = pack.path.mirrors.get(1)!;
  assert.ok(m1.ids().length >= 1, "resync after partition should populate mirror");
});

test("N1 duplicates do not double-apply on the mirror", async () => {
  const pack = twoClientScenario("n1-dup", 17n, { dupPerU64: (1n << 64n) - 1n }, 5);
  await run(pack.scenario, "deterministicFast");
  assert.ok(pack.path.duplicateIgnored > 0);
  const m1 = pack.path.mirrors.get(1)!;
  const counts = new Map<number, number>();
  for (const id of m1.ids()) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const n of counts.values()) assert.equal(n, 1);
});

test("N1 delayed link still converges", async () => {
  const pack = twoClientScenario("n1-delay", 19n, { latencyTicks: 2, jitterTicks: 1 }, 8);
  const result = await run(pack.scenario, "deterministicFast");
  assert.ok(result.hashes.length > 1);
  assert.ok(pack.path.sends > 0);
  assert.ok(pack.path.mirrors.get(1)!.ids().length >= 1);
});

test("N1 capacity rejects extras; world hash still formed", async () => {
  const pack = twoClientScenario("n1-cap", 23n, { latencyTicks: 3, capacity: 1 }, 5);
  const result = await run(pack.scenario, "deterministicFast");
  assert.ok(pack.path.rejects > 0);
  assert.ok(result.hashes.at(-1));
});
