import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MemoryBytesSource,
  MockTemplateParser,
  PresentationRuntime,
  RendererCache,
  memoryScene,
  rendererCacheKey,
} from "../dist/index.js";

test("same assetId+hash is one cache entry and requests coalesce", async () => {
  const parser = new MockTemplateParser();
  const cache = new RendererCache(parser);
  const bytes = new Uint8Array([1, 2, 3]);
  const [a, b] = await Promise.all([
    cache.load("model.pawn", "sha256:aaa", bytes),
    cache.load("model.pawn", "sha256:aaa", bytes),
  ]);
  assert.equal(a.key, b.key);
  assert.equal(a.key, rendererCacheKey("model.pawn", "sha256:aaa"));
  assert.equal(parser.parseCount, 1);
  assert.ok(cache.metrics.coalesced + cache.metrics.hits >= 1);
  const again = await cache.load("model.pawn", "sha256:aaa", bytes);
  assert.equal(again.key, a.key);
  assert.equal(cache.metrics.hits, 1);
});

test("hash change is a distinct generation; entity id is not a cache key", async () => {
  const cache = new RendererCache(new MockTemplateParser());
  const a = await cache.load("model.pawn", "sha256:old", new Uint8Array([1]));
  const b = await cache.load("model.pawn", "sha256:new", new Uint8Array([2]));
  assert.notEqual(a.key, b.key);
  assert.equal(cache.keys().length, 2);
});

test("two entity bindings share one cache entry; one release does not dispose", async () => {
  const scene = memoryScene();
  const cache = new RendererCache(new MockTemplateParser());
  const source = new MemoryBytesSource().put("pawn", new Uint8Array([9]), "sha256:p");
  const pres = new PresentationRuntime(scene, cache, source);
  await pres.bindEntity({ entity: 1, assetId: "pawn", contentHash: "sha256:p" });
  await pres.bindEntity({ entity: 2, assetId: "pawn", contentHash: "sha256:p" });
  assert.equal(pres.bindingCount(), 2);
  assert.notEqual(pres.binding(1), pres.binding(2));
  const entry = cache.get(rendererCacheKey("pawn", "sha256:p"))!;
  assert.equal(entry.leases, 2);
  pres.releaseEntity(1);
  assert.equal(entry.leases, 1);
  assert.equal(cache.get(rendererCacheKey("pawn", "sha256:p"))?.state, "ready");
  pres.releaseEntity(2);
  assert.equal(cache.get(rendererCacheKey("pawn", "sha256:p")), undefined);
});

test("static world attach, fallback, unload, and hash switch", async () => {
  const scene = memoryScene();
  const parser = new MockTemplateParser();
  const cache = new RendererCache(parser);
  const source = new MemoryBytesSource()
    .put("world.visual", new Uint8Array([1]), "sha256:v1")
    .put("world.visual.v2", new Uint8Array([2]), "sha256:v2")
    .put("primitive/box", new Uint8Array([3]), "sha256:box");
  const pres = new PresentationRuntime(scene, cache, source);
  assert.equal(await pres.attachWorld({ assetId: "world.visual", contentHash: "sha256:v1" }), "ready");
  assert.ok(pres.attachedWorld);
  assert.ok(scene.objects.some((o) => String(o.id).startsWith("world-")));

  source.missing.add("world.visual");
  parser.failIds.add("world.visual");
  const degraded = new PresentationRuntime(memoryScene(), new RendererCache(parser), source);
  assert.equal(
    await degraded.attachWorld({
      assetId: "world.visual",
      contentHash: "sha256:v1",
      fallbackAssetId: "primitive/box",
    }),
    "degraded",
  );

  const before = cache.metrics.worldDetaches;
  await pres.switchWorld({ assetId: "world.visual.v2", contentHash: "sha256:v2" });
  assert.ok(cache.metrics.worldDetaches >= before);
  assert.match(pres.attachedWorld ?? "", /v2/);
  pres.unload();
  assert.equal(pres.status, "idle");
  assert.equal(pres.bindingCount(), 0);
});
