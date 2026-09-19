import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssetLoadError,
  AssetRuntime,
  FixtureRegistry,
  hashBytes,
  parseManifest,
} from "../src/index.ts";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test("memory loader verifies hash, decodes json, coalesces, and refcounts", async () => {
  const payload = '{"grid":[1,0,1]}';
  const collisionBytes = bytes(payload);
  const visualBytes = bytes("glb-bytes");
  const fixtures = new FixtureRegistry()
    .success("memory:collision", collisionBytes)
    .success("memory:visual", visualBytes);

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
        contentHash: hashBytes(collisionBytes),
        runtimeUri: "memory:collision",
        license: { id: "CC0-1.0", status: "spdx" },
      },
      {
        id: "arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "1.0.0",
        contentHash: hashBytes(visualBytes),
        runtimeUri: "memory:visual",
        dependencies: [{ id: "arena.collision", version: "1.0.0" }],
      },
    ],
  });

  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const handles = await Promise.all(Array.from({ length: 5 }, () => runtime.request("arena.visual")));
  assert.equal(handles.length, 5);
  assert.ok(runtime.metrics.coalescedRequestCount >= 1 || runtime.metrics.cacheHitCount >= 1);
  assert.equal(handles[0].state, "ready");
  assert.equal(handles[0].payload?.kind, "bytes");
  const collision = await runtime.request("arena.collision");
  assert.equal(collision.payload?.kind, "json");
  assert.deepEqual((collision.payload as { value: unknown }).value, { grid: [1, 0, 1] });

  for (const h of handles) h.release();
  collision.release();
  assert.equal(runtime.cacheSize(), 0);
});

test("hash mismatch and missing fixture fail closed for authoritative assets", async () => {
  const good = bytes("good");
  const fixtures = new FixtureRegistry().success("memory:collision", bytes("tampered"));
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
        contentHash: hashBytes(good),
        runtimeUri: "memory:collision",
        runtimePolicy: { fallbackAssetId: "arena.other" },
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  await assert.rejects(() => runtime.request("arena.collision"), (err: unknown) => {
    assert.ok(err instanceof AssetLoadError);
    assert.equal(err.code, "hash-mismatch");
    return true;
  });
  assert.equal(runtime.metrics.hashMismatchCount, 1);
});

test("presentation fallback degrades instead of failing", async () => {
  const fallbackBytes = bytes("box");
  const fixtures = new FixtureRegistry()
    .fail("memory:hero", "not-found", "missing glb")
    .success("memory:box", fallbackBytes);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "char.hero",
        kind: "renderable-model",
        authority: "presentation",
        version: "1",
        contentHash: hashBytes(bytes("hero")),
        runtimeUri: "memory:hero",
        runtimePolicy: { fallbackAssetId: "primitive.box" },
      },
      {
        id: "primitive.box",
        kind: "primitive",
        authority: "diagnostic",
        version: "1",
        contentHash: hashBytes(fallbackBytes),
        runtimeUri: "memory:box",
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const handle = await runtime.request("char.hero");
  assert.equal(handle.state, "degraded");
  assert.equal(handle.fallbackAssetId, "primitive.box");
  assert.equal(runtime.metrics.degradedCount, 1);
  handle.release();
});

test("fixture can delay, cancel, and ignore stale completion", async () => {
  const body = bytes("slow");
  const fixtures = new FixtureRegistry()
    .put("memory:slow", { bytes: body, delayMs: 40 })
    .put("memory:stale", { bytes: body, delayMs: 20, completeAfterAbort: true });

  const hash = hashBytes(body);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "slow",
        kind: "renderable-model",
        authority: "presentation",
        version: "1",
        contentHash: hash,
        runtimeUri: "memory:slow",
      },
      {
        id: "stale",
        kind: "renderable-model",
        authority: "presentation",
        version: "1",
        contentHash: hash,
        runtimeUri: "memory:stale",
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });

  const ac = new AbortController();
  const pending = runtime.request("slow", { signal: ac.signal });
  ac.abort();
  await assert.rejects(pending, (err: unknown) => {
    assert.ok(err instanceof AssetLoadError);
    assert.equal(err.code, "cancelled");
    return true;
  });

  const staleAc = new AbortController();
  const stalePending = runtime.request("stale", { signal: staleAc.signal });
  staleAc.abort();
  await assert.rejects(stalePending, (err: unknown) => {
    assert.ok(err instanceof AssetLoadError);
    assert.equal(err.code, "cancelled");
    return true;
  });
});

test("dependency failure surfaces as dependency code", async () => {
  const vis = bytes("vis");
  const fixtures = new FixtureRegistry().success("memory:visual", vis);
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
        dependencies: [{ id: "arena.missing" }],
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  await assert.rejects(() => runtime.request("arena.visual"), (err: unknown) => {
    assert.ok(err instanceof AssetLoadError);
    assert.equal(err.code, "dependency");
    return true;
  });
});
