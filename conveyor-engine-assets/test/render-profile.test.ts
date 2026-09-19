import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RENDER_PROFILES,
  validateRenderProfile,
  parsePresentationVisual,
  RenderProfileError,
} from "../src/index.ts";

test("four profiles validate and reject authoritative fields", () => {
  for (const id of Object.keys(RENDER_PROFILES)) {
    assert.equal(validateRenderProfile({ id }).id, id);
  }
  assert.throws(() => validateRenderProfile({ id: "desktop-balanced", authoritativeHash: "x" }), RenderProfileError);
});

test("presentation visual descriptor is presentation-only", () => {
  const d = parsePresentationVisual({
    visualAssetId: "world.visual",
    lighting: { keyIntensity: 2 },
    background: "environment",
  });
  assert.equal(d.visualAssetId, "world.visual");
  assert.equal(d.background, "environment");
  assert.equal(d.lighting.keyIntensity, 2);
  assert.ok(!("bundleId" in d));
});
