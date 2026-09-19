import assert from "node:assert/strict";
import { test } from "node:test";
import { tryLoadThree } from "../dist/index.js";

test("optional Three.js peer is loadable or cleanly absent", async () => {
  const api = await tryLoadThree();
  if (!api) {
    assert.equal(api, undefined);
    return;
  }
  assert.equal(typeof api.GLTFLoader, "function");
  assert.equal(typeof api.SkeletonUtils.clone, "function");
  assert.equal(typeof api.AnimationMixer, "function");
});
