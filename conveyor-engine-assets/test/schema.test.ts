import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ManifestSchemaError,
  collectAuthoritativeCompatibility,
  collectPresentationCompatibility,
  evaluateManifest,
  hashBytes,
  parseManifest,
} from "../src/index.ts";

const hash = hashBytes(new TextEncoder().encode("collision-v1"));

test("portable sha256 matches empty and abc vectors", () => {
  assert.equal(hashBytes(new Uint8Array()), "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(hashBytes(new TextEncoder().encode("abc")), "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

function baseAsset(over: Record<string, unknown> = {}) {
  return {
    id: "world.arena.collision",
    kind: "static-collision-scene",
    authority: "authoritative-static",
    version: "1.0.0",
    contentHash: hash,
    runtimeUri: "memory:collision",
    license: { id: "CC0-1.0", status: "spdx" },
    provenance: { origin: "generated-test-fixture" },
    ...over,
  };
}

test("parseManifest accepts a valid authoritative + presentation bundle", () => {
  const visualHash = hashBytes(new TextEncoder().encode("visual"));
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "test.arena",
    bundleVersion: "1.3.0",
    protocolVersion: "engine-1",
    schemaVersion: "world-1",
    developerNotes: "not part of compatibility",
    assets: [
      baseAsset(),
      {
        id: "world.arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "1.3.0",
        contentHash: visualHash,
        runtimeUri: "memory:visual",
        license: "CC-BY-4.0",
        provenance: { origin: "manual" },
        runtimePolicy: { fallbackAssetId: "primitive/box" },
      },
    ],
  });
  assert.equal(manifest.bundleId, "test.arena");
  assert.equal(manifest.assets.length, 2);
  const auth = collectAuthoritativeCompatibility(manifest);
  assert.deepEqual(auth.assets.map((a) => a.id), ["world.arena.collision"]);
  const pres = collectPresentationCompatibility(manifest);
  assert.deepEqual(pres.assets.map((a) => a.id), ["world.arena.visual"]);
  assert.ok(!JSON.stringify(auth).includes("developerNotes"));
});

test("parseManifest rejects secrets, signed URLs, and absolute paths", () => {
  const attempts = [
    { extra: { apiKey: "secret" }, path: "apiKey" },
    {
      asset: baseAsset({ runtimeUri: "https://cdn.example/a.glb?token=abc" }),
      path: "runtimeUri",
    },
    {
      asset: baseAsset({ runtimeUri: "/Users/me/assets/a.glb" }),
      path: "runtimeUri",
    },
    {
      asset: baseAsset({ contentHash: "md5:00" }),
      path: "contentHash",
    },
  ];
  for (const attempt of attempts) {
    assert.throws(
      () =>
        parseManifest({
          formatVersion: 1,
          bundleId: "x",
          bundleVersion: "1",
          apiKey: (attempt as { extra?: { apiKey?: string } }).extra?.apiKey,
          assets: [attempt.asset ?? baseAsset()],
        }),
      ManifestSchemaError,
    );
  }
});

test("evaluateManifest fails release-strict on unknown license and missing collision companion", () => {
  const visualHash = hashBytes(new TextEncoder().encode("visual"));
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "x",
    bundleVersion: "1",
    assets: [
      {
        id: "world.arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "1",
        contentHash: visualHash,
        runtimeUri: "memory:visual",
      },
    ],
  });
  const dev = evaluateManifest(manifest, "development");
  assert.equal(dev.ok, true);
  assert.ok(dev.warnings.some((w) => /license/.test(w)));
  const strict = evaluateManifest(manifest, "release-strict");
  assert.equal(strict.ok, false);
  assert.ok(strict.errors.some((e) => /license/.test(e)));
  assert.ok(strict.errors.some((e) => /collision/.test(e)));
});
