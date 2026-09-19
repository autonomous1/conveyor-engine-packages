import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssetAdmissionQueue,
  AssetRuntime,
  collectAuthoritativeCompatibility,
  collisionFromPayload,
  hashCompatibility,
  loadThroughPipeline,
} from "conveyor-engine-assets";
import { AuthoritativeWorld, applyCollisionArtifact, bindAuthoritativeCompatibility } from "conveyor-engine-world";
import { Replicator } from "conveyor-engine-replication";
import { PresentationCatalog } from "conveyor-engine-client";
import { PrimitiveVisualFactory } from "conveyor-engine-three";
import { arenaFixtures, arenaManifest } from "../conveyor-engine-example/src/arena-assets.ts";

test("static collision binds into the world without touching presentation or three", async () => {
  const manifest = arenaManifest();
  const runtime = new AssetRuntime({ manifest, provider: arenaFixtures().provider });
  const queue = new AssetAdmissionQueue(runtime);
  const compat = await queue.requireStaticReady();
  const world = new AuthoritativeWorld({ worldVersion: "arena-1" });
  const hash = bindAuthoritativeCompatibility(world, compat);
  assert.equal(hash, hashCompatibility(collectAuthoritativeCompatibility(manifest)));
  assert.equal(world.assetsCompatHash, hash);

  const handle = await runtime.request("environment.test-arena.collision");
  const n = applyCollisionArtifact(world, collisionFromPayload(handle.payload!));
  assert.equal(n, 1);
  assert.equal(world.listObstacles().length, 1);
  const before = world.canonicalPlain();
  const visual = await loadThroughPipeline({ runtime }, "environment.test-arena.visual");
  assert.equal(visual.glb?.ok, true);
  assert.deepEqual(world.canonicalPlain(), before);
  handle.release();
  visual.handle?.release();
});

test("replicator hello can carry assetsCompatHash without handles", () => {
  const world = new AuthoritativeWorld();
  world.createEntity(1n, { type: "pawn", shape: "capsule" });
  const snap = world.commit(1n);
  const rep = new Replicator();
  rep.setAssetCompatibilityHash("sha256:deadbeef");
  rep.connect(1);
  const env = rep.publish(world, snap).get(1);
  assert.ok(env);
  assert.equal(env.assetsCompatHash, "sha256:deadbeef");
  assert.equal("handle" in env, false);
});

test("client presentation ready is local and three factory stays primitive", () => {
  const catalog = new PresentationCatalog();
  const key = { type: "pawn", shape: "capsule", assetKey: "char.hero" };
  assert.equal(catalog.resolveRender(key).state, "placeholder");
  catalog.markReady("char.hero");
  assert.equal(catalog.resolveRender(key).state, "ready");
  const factory = new PrimitiveVisualFactory();
  const resource = factory.resolve(key);
  assert.equal(resource.kind, "primitive");
  assert.equal(resource.placeholder, false);
  factory.release(resource);
  assert.equal(factory.liveCount(), 0);
});
