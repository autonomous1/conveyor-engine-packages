import { encodeGlb } from "./glb.js";
import { HUMANOID_BASIC_V1 } from "./animation-profile.js";

/**
 * Tiny in-place skinned GLB: one joint, one mesh, four named clips.
 * Structural fixture for sniff + profile validation. Not a production character.
 */
export function encodeSkinnedDemoGlb(): Uint8Array {
  const doc = {
    asset: { version: "2.0", generator: "conveyor-engine-assets/skinned-demo" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: "Root", children: [1, 2] },
      { name: "Hips", translation: [0, 1, 0] },
      { name: "Body", mesh: 0, skin: 0 },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 },
            indices: 3,
          },
        ],
      },
    ],
    skins: [{ name: "Armature", joints: [1], skeleton: 1, inverseBindMatrices: 4 }],
    animations: [
      clip("Idle", 0),
      clip("Walk", 1),
      clip("Run", 2),
      clip("Attack", 3),
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", max: [1, 1, 0], min: [-1, 0, 0] },
      { bufferView: 1, componentType: 5121, count: 3, type: "VEC4" },
      { bufferView: 2, componentType: 5126, count: 3, type: "VEC4" },
      { bufferView: 3, componentType: 5123, count: 3, type: "SCALAR" },
      { bufferView: 4, componentType: 5126, count: 1, type: "MAT4" },
      { bufferView: 5, componentType: 5126, count: 2, type: "SCALAR" },
      { bufferView: 6, componentType: 5126, count: 2, type: "VEC4" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 12 },
      { buffer: 0, byteOffset: 48, byteLength: 48 },
      { buffer: 0, byteOffset: 96, byteLength: 6 },
      { buffer: 0, byteOffset: 112, byteLength: 64 },
      { buffer: 0, byteOffset: 176, byteLength: 8 },
      { buffer: 0, byteOffset: 184, byteLength: 32 },
    ],
    buffers: [{ byteLength: 216 }],
  };
  return encodeGlb(doc, new Uint8Array(216));
}

function clip(name: string, _i: number) {
  return {
    name,
    channels: [{ sampler: 0, target: { node: 1, path: "rotation" } }],
    samplers: [{ input: 5, output: 6, interpolation: "LINEAR" }],
  };
}

export const SKINNED_DEMO_PROFILE = HUMANOID_BASIC_V1;
