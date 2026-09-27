import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DirectNetPath, type NetPath } from "../dist/index.js";

const snap = {
  type: "snap" as const,
  kind: "full" as const,
  seq: 7,
  tick: 3n,
  baseline: 0,
  lastProcessedInput: 0,
  worldVersion: "w",
  protocol: 1,
  spawns: [] as unknown[],
  updates: [] as unknown[],
  despawns: [] as unknown[],
};

test("DirectNetPath delivers a snapshot frame to an in-process sink in the same turn", async () => {
  const received: Array<{ frame: unknown; options: { to?: string; kind?: string } }> = [];
  let sinkCalls = 0;
  const path: NetPath<typeof snap> = new DirectNetPath((frame, options) => {
    sinkCalls += 1;
    received.push({ frame, options });
  });
  const pending = path.send(snap, { to: "client:1", kind: "snap" });
  assert.equal(sinkCalls, 1);
  assert.equal(received[0]!.frame, snap);
  assert.deepEqual(received[0]!.options, { to: "client:1", kind: "snap" });
  assert.equal(Object.hasOwn(received[0]!.frame as object, "payloadHash"), false);
  const receipt = await pending;
  assert.deepEqual(receipt, { ok: true, seq: 1 });
  assert.equal(Object.hasOwn(receipt, "payloadHash"), false);
});

test("DirectNetPath close drops the next frame", async () => {
  let calls = 0;
  const path = new DirectNetPath(() => {
    calls += 1;
  });
  path.close("bye");
  const receipt = await path.send({ type: "snap", seq: 1 }, { to: "client:1", kind: "snap" });
  assert.equal(calls, 0);
  assert.deepEqual(receipt, { ok: false });
});

test("production net-path declarations do not name the simulator", () => {
  const dts = readFileSync(new URL("../dist/net-path.d.ts", import.meta.url), "utf8");
  assert.match(dts, /export interface NetPath/);
  assert.match(dts, /export declare class DirectNetPath/);
  for (const banned of ["NetworkScheduler", "LinkProfile", "payloadHash", "conveyor-graph-simulator"]) {
    assert.equal(dts.includes(banned), false, banned);
  }
});
