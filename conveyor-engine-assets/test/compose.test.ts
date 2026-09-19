import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssetAdmissionQueue,
  AssetRuntime,
  FixtureRegistry,
  assetComposeStageSpecs,
  createAssetStages,
  encodeGlb,
  hashBytes,
  loadThroughPipeline,
  parseManifest,
  runAssetPipeline,
} from "../src/index.ts";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test("pipeline loads presentation GLB, sniffs it, and fans out presentation-ready only", async () => {
  const glb = encodeGlb({
    asset: { version: "2.0" },
    scenes: [{ name: "S", nodes: [0] }],
    nodes: [{ name: "N", mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  });
  const fixtures = new FixtureRegistry().success("memory:visual", glb);
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
        contentHash: hashBytes(glb),
        runtimeUri: "memory:visual",
        provenance: { origin: "manual" },
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const presented: string[] = [];
  const auth: string[] = [];
  const provenance: string[] = [];
  const work = await loadThroughPipeline(
    {
      runtime,
      sinks: {
        onPresentationReady: (w) => presented.push(w.assetId),
        onAuthoritativeReady: (w) => auth.push(w.assetId),
        onProvenance: (w) => provenance.push(w.assetId),
      },
    },
    "arena.visual",
  );
  assert.equal(work.error, undefined);
  assert.equal(work.glb?.ok, true);
  assert.deepEqual(presented, ["arena.visual"]);
  assert.deepEqual(auth, []);
  assert.deepEqual(provenance, ["arena.visual"]);
  work.handle?.release();
});

test("pipeline decodes collision and fans out authoritative-ready, not presentation", async () => {
  const json = JSON.stringify({
    formatVersion: 1,
    representation: "aabb",
    coordinateSystem: "y-up",
    unitScale: 1,
    origin: { x: 0, y: 0, z: 0 },
    bounds: { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 },
    aabbs: [{ id: 1, minX: 0, maxX: 1, minZ: 0, maxZ: 1 }],
  });
  const fixtures = new FixtureRegistry().success("memory:collision", json);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "arena.collision",
        kind: "static-collision-scene",
        authority: "authoritative-static",
        version: "1",
        contentHash: hashBytes(bytes(json)),
        runtimeUri: "memory:collision",
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const presented: string[] = [];
  const auth: string[] = [];
  const work = await loadThroughPipeline(
    {
      runtime,
      sinks: {
        onPresentationReady: (w) => presented.push(w.assetId),
        onAuthoritativeReady: (w) => auth.push(w.assetId),
      },
    },
    "arena.collision",
  );
  assert.equal(work.collision?.aabbs?.length, 1);
  assert.deepEqual(auth, ["arena.collision"]);
  assert.deepEqual(presented, []);
  work.handle?.release();
});

test("admitted assets are staged by the sink without applying a tick", async () => {
  const patch = bytes('{"maxSpeed":3}');
  const fixtures = new FixtureRegistry().success("memory:patch", patch);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "rules.patch",
        kind: "rules-patch",
        authority: "authoritative-admitted",
        version: "1",
        contentHash: hashBytes(patch),
        runtimeUri: "memory:patch",
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const admission = new AssetAdmissionQueue(runtime);
  const staged: string[] = [];
  await loadThroughPipeline(
    {
      runtime,
      admission,
      sinks: { onAuthoritativeStaged: (w) => staged.push(w.assetId) },
    },
    "rules.patch",
  );
  assert.deepEqual(staged, ["rules.patch"]);
  assert.equal(admission.peek().length, 1);
  assert.equal(admission.history().length, 0);
  const records = admission.takeAdmitted(4n);
  assert.equal(records[0]?.tick, 4n);
  assert.equal(records[0]?.outcome, "accepted");
});

test("compose stage specs keep stable ids for graph-compose wiring", () => {
  const fixtures = new FixtureRegistry();
  const runtime = new AssetRuntime({
    manifest: parseManifest({ formatVersion: 1, bundleId: "x", bundleVersion: "1", assets: [] }),
    provider: fixtures.provider,
  });
  assert.deepEqual(
    assetComposeStageSpecs({ runtime }).map((s) => s.id),
    ["resolve-manifest", "resolve-deps", "acquire-verify-decode-own", "sink"],
  );
});

test("pipeline abort and missing asset surface as work.error", async () => {
  const fixtures = new FixtureRegistry();
  const runtime = new AssetRuntime({
    manifest: parseManifest({ formatVersion: 1, bundleId: "x", bundleVersion: "1", assets: [] }),
    provider: fixtures.provider,
  });
  const missing = await runAssetPipeline(createAssetStages({ runtime }), { assetId: "nope" });
  assert.equal(missing.error?.code, "not-found");
  const ac = new AbortController();
  ac.abort();
  const cancelled = await runAssetPipeline(createAssetStages({ runtime }), { assetId: "nope" }, ac.signal);
  assert.equal(cancelled.error?.code, "cancelled");
});
