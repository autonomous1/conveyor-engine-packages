import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssetAdmissionQueue,
  AssetRuntime,
  FixtureRegistry,
  StaticAdmissionError,
  hashBytes,
  parseManifest,
} from "../src/index.ts";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test("requireStaticReady fails closed when collision bytes are missing", async () => {
  const vis = bytes("visual");
  const fixtures = new FixtureRegistry().success("memory:visual", vis);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "arena.collision",
        kind: "static-collision-scene",
        authority: "authoritative-static",
        version: "1.0.0",
        contentHash: hashBytes(bytes("collision")),
        runtimeUri: "memory:collision",
      },
      {
        id: "arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "1.0.0",
        contentHash: hashBytes(vis),
        runtimeUri: "memory:visual",
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const queue = new AssetAdmissionQueue(runtime);
  await assert.rejects(() => queue.requireStaticReady(), (err: unknown) => {
    assert.ok(err instanceof StaticAdmissionError);
    assert.deepEqual(err.missing, ["arena.collision"]);
    return true;
  });
});

test("requireStaticReady pins static auth assets and ignores presentation readiness", async () => {
  const col = bytes('{"grid":[1]}');
  const vis = bytes("visual");
  const fixtures = new FixtureRegistry().success("memory:collision", col).success("memory:visual", vis);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    protocolVersion: "engine-1",
    assets: [
      {
        id: "arena.collision",
        kind: "static-collision-scene",
        authority: "authoritative-static",
        version: "1.0.0",
        contentHash: hashBytes(col),
        runtimeUri: "memory:collision",
      },
      {
        id: "arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "1.0.0",
        contentHash: hashBytes(vis),
        runtimeUri: "memory:visual",
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const queue = new AssetAdmissionQueue(runtime);
  const compat = await queue.requireStaticReady();
  assert.deepEqual(compat.assets.map((a) => a.id), ["arena.collision"]);
  assert.equal(runtime.cacheSize(), 1);
  const visual = await runtime.request("arena.visual");
  assert.equal(visual.state, "ready");
  visual.release();
});

test("admitted assets stage off-tick and apply only at takeAdmitted(tick)", async () => {
  const patch = bytes('{"maxSpeed":9}');
  const fixtures = new FixtureRegistry().delay("memory:patch", patch, 15);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "rules.move.patch",
        kind: "rules-patch",
        authority: "authoritative-admitted",
        version: "2.0.0",
        contentHash: hashBytes(patch),
        runtimeUri: "memory:patch",
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const queue = new AssetAdmissionQueue(runtime);
  const events: string[] = [];
  runtime.on((e) => {
    if (e.type === "admission-applied") events.push(`${e.record.outcome}@${e.record.tick}`);
  });

  assert.equal(queue.peek().length, 0);
  const staging = queue.stage("rules.move.patch");
  assert.equal(queue.history().length, 0);
  await staging;
  assert.equal(queue.peek().length, 1);
  assert.equal(queue.history().length, 0);

  const records = queue.takeAdmitted(10n);
  assert.equal(records.length, 1);
  assert.equal(records[0].outcome, "accepted");
  assert.equal(records[0].tick, 10n);
  assert.equal(records[0].assetId, "rules.move.patch");
  assert.equal(records[0].version, "2.0.0");
  assert.equal(records[0].contentHash, hashBytes(patch));
  assert.deepEqual(events, ["accepted@10"]);
  assert.equal(runtime.metrics.admissionAcceptedCount, 1);
  assert.equal(queue.peek().length, 0);
});

test("presentation and static assets cannot be admitted mid-session", async () => {
  const vis = bytes("visual");
  const col = bytes("collision");
  const fixtures = new FixtureRegistry().success("memory:visual", vis).success("memory:collision", col);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "1",
        contentHash: hashBytes(vis),
        runtimeUri: "memory:visual",
      },
      {
        id: "arena.collision",
        kind: "static-collision-scene",
        authority: "authoritative-static",
        version: "1",
        contentHash: hashBytes(col),
        runtimeUri: "memory:collision",
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const queue = new AssetAdmissionQueue(runtime);
  await queue.stage("arena.visual");
  await queue.stage("arena.collision");
  const records = queue.takeAdmitted(3n);
  assert.equal(records.every((r) => r.outcome === "rejected"), true);
  assert.equal(runtime.metrics.admissionRejectedCount, 2);
});

test("failed stage becomes a rejected admission record at the tick", async () => {
  const fixtures = new FixtureRegistry().fail("memory:patch", "not-found", "gone");
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "rules.move.patch",
        kind: "rules-patch",
        authority: "authoritative-admitted",
        version: "2.0.0",
        contentHash: hashBytes(bytes("patch")),
        runtimeUri: "memory:patch",
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const queue = new AssetAdmissionQueue(runtime);
  await queue.stage("rules.move.patch");
  const [record] = queue.takeAdmitted(7n);
  assert.equal(record.outcome, "rejected");
  assert.equal(record.tick, 7n);
  assert.match(record.reason ?? "", /gone|not-found|provider/);
});
