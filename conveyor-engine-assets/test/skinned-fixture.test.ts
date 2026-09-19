import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeSkinnedDemoGlb,
  sniffGlb,
  validateAnimationProfile,
  HUMANOID_BASIC_V1,
} from "../src/index.ts";

test("skinned demo GLB sniffs skins and named clips", () => {
  const bytes = encodeSkinnedDemoGlb();
  const report = sniffGlb(bytes);
  assert.equal(report.ok, true);
  assert.ok(report.skinCount >= 1);
  assert.ok(report.animationCount >= 4);
  assert.ok(report.animationNames.includes("Idle"));
  assert.ok(report.animationNames.includes("Attack"));
  const v = validateAnimationProfile(HUMANOID_BASIC_V1, report);
  assert.equal(v.ok, true);
});
