import assert from "node:assert/strict";
import { test } from "node:test";
import { HUMANOID_BASIC_V1, validateAnimationProfile } from "../src/index.ts";

test("humanoid profile requires disabled root motion and four aliases", () => {
  const ok = validateAnimationProfile(HUMANOID_BASIC_V1);
  assert.equal(ok.ok, true);
  const bad = validateAnimationProfile({ ...HUMANOID_BASIC_V1, rootMotion: "enabled" as "disabled" });
  assert.equal(bad.ok, false);
});

test("sniffed clip names must match aliases when provided", () => {
  const miss = validateAnimationProfile(HUMANOID_BASIC_V1, {
    ok: true,
    skinCount: 1,
    animationCount: 3,
    animationNames: ["Idle", "Walk", "Run"],
  });
  assert.equal(miss.ok, false);
  assert.ok(miss.errors.some((e) => e.includes("Attack")));
});
