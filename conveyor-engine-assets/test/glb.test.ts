import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssetRuntime,
  DEFAULT_CAPABILITIES,
  FixtureRegistry,
  GlbParseError,
  encodeGlb,
  hashBytes,
  parseManifest,
  parseRenderDescriptor,
  parseSkeletalMetadata,
  resolveRenderDescriptor,
  sniffGlb,
} from "../src/index.ts";

const staticDoc = {
  asset: { version: "2.0" },
  scene: 0,
  scenes: [{ name: "Arena", nodes: [0] }],
  nodes: [{ name: "Floor", mesh: 0, translation: [0, 0, 0], rotation: [0, 0, 0, 1] }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  materials: [{ name: "Default" }],
};

test("sniffGlb reads scenes/nodes and accepts a static mesh GLB", () => {
  const bytes = encodeGlb(staticDoc);
  const report = sniffGlb(bytes);
  assert.equal(report.ok, true);
  assert.equal(report.support, "static-mesh");
  assert.equal(report.sceneCount, 1);
  assert.equal(report.scenes[0]?.name, "Arena");
  assert.equal(report.nodes[0]?.name, "Floor");
  assert.equal(report.meshCount, 1);
  assert.equal(report.finiteTransforms, true);
});

test("required Draco extension fails under default capabilities", () => {
  const bytes = encodeGlb({
    ...staticDoc,
    extensionsUsed: ["KHR_draco_mesh_compression"],
    extensionsRequired: ["KHR_draco_mesh_compression"],
  });
  const report = sniffGlb(bytes, DEFAULT_CAPABILITIES);
  assert.equal(report.ok, false);
  assert.deepEqual(report.unsupportedRequired, ["KHR_draco_mesh_compression"]);
  const allowed = sniffGlb(bytes, { ...DEFAULT_CAPABILITIES, supportsDraco: true });
  assert.equal(allowed.ok, true);
});

test("garbage bytes are not a GLB", () => {
  assert.throws(() => sniffGlb(new TextEncoder().encode("not-glb")), GlbParseError);
});

test("render descriptor maps to a named GLB node or primitive fallback", () => {
  const report = sniffGlb(encodeGlb(staticDoc));
  const descriptor = parseRenderDescriptor({
    id: "env.arena",
    modelAssetId: "arena.visual",
    nodeSelector: "Floor",
    sceneSelector: "Arena",
    fallback: { shape: "box", color: 0x334455 },
  });
  const hit = resolveRenderDescriptor(descriptor, report);
  assert.equal(hit.kind, "glb-node");
  if (hit.kind === "glb-node") assert.equal(hit.nodeIndex, 0);

  const missing = resolveRenderDescriptor(
    parseRenderDescriptor({
      id: "env.arena",
      modelAssetId: "arena.visual",
      nodeSelector: "Missing",
      fallback: { shape: "plane" },
    }),
    report,
  );
  assert.equal(missing.kind, "primitive");

  const noGlb = resolveRenderDescriptor(
    parseRenderDescriptor({ id: "pawn", fallback: { shape: "capsule" } }),
  );
  assert.equal(noGlb.kind, "primitive");
});

test("skeletal metadata is declarative and has no bone transforms", () => {
  const meta = parseSkeletalMetadata({
    modelAssetId: "char.hero",
    skeletonId: "hero-rig",
    jointCount: 18,
    rootJoint: "hips",
    attachmentPoints: ["hand.L", "hand.R"],
    clips: [{ name: "walk", duration: 1.2, tags: ["locomotion"] }],
    requiredCapability: "supportsAnimations",
  });
  assert.equal(meta.jointCount, 18);
  assert.equal(meta.clips[0]?.name, "walk");
  assert.equal("bones" in meta, false);
  assert.equal("matrices" in meta, false);
});

test("AssetRuntime can acquire a hashed GLB and sniff it without three", async () => {
  const glb = encodeGlb(staticDoc);
  const fixtures = new FixtureRegistry().success("memory:visual", glb);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "arena.visual",
        kind: "static-visual-scene",
        authority: "presentation",
        version: "1.0.0",
        contentHash: hashBytes(glb),
        runtimeUri: "memory:visual",
        requiredExtensions: [],
      },
    ],
  });
  const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
  const handle = await runtime.request("arena.visual");
  assert.equal(handle.payload?.kind, "bytes");
  const report = sniffGlb((handle.payload as { bytes: Uint8Array }).bytes);
  assert.equal(report.ok, true);
  handle.release();
});
