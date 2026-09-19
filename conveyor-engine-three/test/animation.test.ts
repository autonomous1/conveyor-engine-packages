import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AnimationDirector,
  MockTemplateParser,
  RendererCache,
  rendererCacheKey,
} from "../dist/index.js";

test("two entities share cache and keep independent mixers", async () => {
  const cache = new RendererCache(new MockTemplateParser());
  const entry = await cache.load("char", "sha256:c", new Uint8Array([1]));
  const dir = new AnimationDirector(cache);
  dir.bind(1, entry);
  dir.bind(2, entry);
  assert.equal(entry.leases, 2);
  assert.equal(dir.binding(1)!.cacheKey, rendererCacheKey("char", "sha256:c"));
  dir.apply(1, { locomotion: "walk", speed: 2, action: "none", actionEpoch: 0 });
  dir.apply(2, { locomotion: "idle", speed: 0, action: "none", actionEpoch: 0 });
  assert.equal(dir.binding(1)!.mixer.current, "walk");
  assert.equal(dir.binding(2)!.mixer.current, "idle");
  dir.apply(1, { locomotion: "walk", speed: 2, action: "action-primary", actionEpoch: 1 });
  dir.apply(1, { locomotion: "walk", speed: 2, action: "action-primary", actionEpoch: 1 });
  dir.apply(1, { locomotion: "walk", speed: 2, action: "action-primary", actionEpoch: 0 });
  assert.equal(dir.binding(1)!.mixer.actionTriggers, 1);
  assert.ok(dir.binding(1)!.mixer.staleIgnored >= 1);
  dir.release(1);
  assert.equal(entry.leases, 1);
  assert.equal(dir.binding(2)!.mixer.stopped, false);
  dir.unload();
  assert.equal(dir.metrics.mixers, 0);
});
