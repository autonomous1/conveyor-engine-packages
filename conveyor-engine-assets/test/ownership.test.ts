import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssetRuntime,
  FixtureRegistry,
  hashBytes,
  parseManifest,
  type AssetRuntimeEvent,
} from "../src/index.ts";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function visualManifest(uriBytes: Uint8Array) {
  return parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "1.0.0",
        contentHash: hashBytes(uriBytes),
        runtimeUri: "memory:visual",
      },
    ],
  });
}

test("pin keeps cache after last handle release; unpin disposes", async () => {
  const body = bytes("visual-bytes");
  const fixtures = new FixtureRegistry().success("memory:visual", body);
  const runtime = new AssetRuntime({ manifest: visualManifest(body), provider: fixtures.provider });
  const events: AssetRuntimeEvent["type"][] = [];
  runtime.on((e) => events.push(e.type));

  const handle = await runtime.request("arena.visual");
  runtime.pin("arena.visual");
  handle.release();
  assert.equal(runtime.cacheSize(), 1);
  assert.equal(runtime.metrics.releaseCount, 1);
  assert.equal(runtime.metrics.ownershipCount, 0);
  assert.ok(events.includes("ready"));
  assert.ok(events.includes("pinned"));
  assert.ok(events.includes("released"));
  assert.ok(!events.includes("disposed"));

  runtime.unpin("arena.visual");
  assert.equal(runtime.cacheSize(), 0);
  assert.ok(events.includes("disposed"));
});

test("preload pins listed assets", async () => {
  const body = bytes("visual-bytes");
  const fixtures = new FixtureRegistry().success("memory:visual", body);
  const runtime = new AssetRuntime({ manifest: visualManifest(body), provider: fixtures.provider });
  const lease = await runtime.preload(["arena.visual"]);
  assert.equal(runtime.cacheSize(), 1);
  lease.release();
  assert.equal(runtime.cacheSize(), 0);
});

test("client disconnect releases scoped handles only", async () => {
  const body = bytes("visual-bytes");
  const fixtures = new FixtureRegistry().success("memory:visual", body);
  const runtime = new AssetRuntime({ manifest: visualManifest(body), provider: fixtures.provider });
  const a = await runtime.request("arena.visual", { scope: { clientId: 1 } });
  const b = await runtime.request("arena.visual", { scope: { clientId: 2 } });
  assert.equal(runtime.liveHandleCount(), 2);
  runtime.notifyClientDisconnected(1);
  assert.equal(runtime.liveHandleCount(), 1);
  assert.equal(runtime.metrics.releaseCount, 1);
  b.release();
});

test("region unload releases region-scoped handles", async () => {
  const body = bytes("visual-bytes");
  const fixtures = new FixtureRegistry().success("memory:visual", body);
  const runtime = new AssetRuntime({ manifest: visualManifest(body), provider: fixtures.provider });
  await runtime.request("arena.visual", { scope: { regionId: "north" } });
  await runtime.request("arena.visual", { scope: { regionId: "south" } });
  runtime.notifyRegionUnloaded("north");
  assert.equal(runtime.liveHandleCount(), 1);
});

test("replaceResource evicts cached presentation bytes", async () => {
  const body = bytes("visual-bytes");
  const fixtures = new FixtureRegistry().success("memory:visual", body);
  const runtime = new AssetRuntime({ manifest: visualManifest(body), provider: fixtures.provider });
  const handle = await runtime.request("arena.visual");
  runtime.replaceResource("arena.visual", hashBytes(body));
  assert.equal(runtime.cacheSize(), 0);
  handle.release();
});
