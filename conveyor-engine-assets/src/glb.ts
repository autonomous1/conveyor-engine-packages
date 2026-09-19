export type RendererCapabilities = {
  supportsStaticMeshes: boolean;
  supportsSkins: boolean;
  supportsAnimations: boolean;
  supportsDraco: boolean;
  supportsKtx2: boolean;
  supportsMaterialExtensions: boolean;
  supportsInstancing: boolean;
};

export const DEFAULT_CAPABILITIES: RendererCapabilities = {
  supportsStaticMeshes: true,
  supportsSkins: false,
  supportsAnimations: false,
  supportsDraco: false,
  supportsKtx2: false,
  supportsMaterialExtensions: false,
  supportsInstancing: false,
};

export type GlbSupportLevel = "static-mesh" | "unsupported";

export type GlbNodeInfo = {
  index: number;
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
};

export type GlbSceneInfo = {
  index: number;
  name?: string;
  nodes: number[];
};

export type GlbValidationReport = {
  ok: boolean;
  support: GlbSupportLevel;
  version?: number;
  jsonByteLength: number;
  binByteLength: number;
  sceneCount: number;
  nodeCount: number;
  meshCount: number;
  primitiveCount: number;
  materialCount: number;
  textureCount: number;
  imageCount: number;
  bufferCount: number;
  bufferViewCount: number;
  accessorCount: number;
  skinCount: number;
  animationCount: number;
  animationNames: string[];
  jointCount: number;
  extensionsUsed: string[];
  extensionsRequired: string[];
  unsupportedRequired: string[];
  scenes: GlbSceneInfo[];
  nodes: GlbNodeInfo[];
  finiteTransforms: boolean;
  errors: string[];
  warnings: string[];
};

export class GlbParseError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "GlbParseError";
    this.issues = issues;
  }
}

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const EXTENSION_CAP: Record<string, keyof RendererCapabilities> = {
  KHR_draco_mesh_compression: "supportsDraco",
  EXT_meshopt_compression: "supportsStaticMeshes",
  KHR_texture_basisu: "supportsKtx2",
  KHR_materials_transmission: "supportsMaterialExtensions",
  KHR_materials_volume: "supportsMaterialExtensions",
  KHR_materials_clearcoat: "supportsMaterialExtensions",
  KHR_materials_ior: "supportsMaterialExtensions",
  KHR_materials_iridescence: "supportsMaterialExtensions",
  KHR_materials_anisotropy: "supportsMaterialExtensions",
  EXT_mesh_gpu_instancing: "supportsInstancing",
};

export function sniffGlb(
  bytes: Uint8Array,
  capabilities: RendererCapabilities = DEFAULT_CAPABILITIES,
): GlbValidationReport {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const errors: string[] = [];
  const warnings: string[] = [];
  if (bytes.byteLength < 12) throw new GlbParseError(["GLB header too short"]);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) throw new GlbParseError(["not a GLB (missing glTF magic)"]);
  const version = view.getUint32(4, true);
  const length = view.getUint32(8, true);
  if (version !== 2) errors.push(`unsupported glTF container version ${version}`);
  if (length > bytes.byteLength) errors.push("declared length exceeds buffer");

  let offset = 12;
  let jsonBytes: Uint8Array | undefined;
  let binByteLength = 0;
  while (offset + 8 <= bytes.byteLength && offset < length) {
    const chunkLen = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    const end = start + chunkLen;
    if (end > bytes.byteLength) {
      errors.push("chunk overruns buffer");
      break;
    }
    if (chunkType === CHUNK_JSON) jsonBytes = bytes.subarray(start, end);
    else if (chunkType === CHUNK_BIN) binByteLength = chunkLen;
    offset = end + ((4 - (chunkLen % 4)) % 4);
  }

  if (!jsonBytes?.byteLength) throw new GlbParseError(["GLB missing JSON chunk"]);

  let doc: Record<string, unknown>;
  try {
    const text = new TextDecoder().decode(jsonBytes).replace(/\0+$/g, "").trimEnd();
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    throw new GlbParseError([`GLB JSON parse failed: ${(err as Error).message}`]);
  }

  const extensionsUsed = strList(doc.extensionsUsed);
  const extensionsRequired = strList(doc.extensionsRequired);
  const unsupportedRequired = extensionsRequired.filter((ext) => {
    const cap = EXTENSION_CAP[ext];
    if (!cap) return true;
    return capabilities[cap] !== true;
  });

  const scenesRaw = Array.isArray(doc.scenes) ? doc.scenes : [];
  const nodesRaw = Array.isArray(doc.nodes) ? doc.nodes : [];
  const meshesRaw = Array.isArray(doc.meshes) ? doc.meshes : [];
  const materialsRaw = Array.isArray(doc.materials) ? doc.materials : [];
  const texturesRaw = Array.isArray(doc.textures) ? doc.textures : [];
  const imagesRaw = Array.isArray(doc.images) ? doc.images : [];
  const skinsRaw = Array.isArray(doc.skins) ? doc.skins : [];
  const animationsRaw = Array.isArray(doc.animations) ? doc.animations : [];
  const buffersRaw = Array.isArray(doc.buffers) ? doc.buffers : [];
  const bufferViewsRaw = Array.isArray(doc.bufferViews) ? doc.bufferViews : [];
  const accessorsRaw = Array.isArray(doc.accessors) ? doc.accessors : [];

  const scenes: GlbSceneInfo[] = scenesRaw.map((s, index) => {
    const row = asObj(s);
    return {
      index,
      name: typeof row.name === "string" ? row.name : undefined,
      nodes: Array.isArray(row.nodes) ? row.nodes.filter((n): n is number => typeof n === "number") : [],
    };
  });
  const nodes: GlbNodeInfo[] = nodesRaw.map((n, index) => {
    const row = asObj(n);
    return {
      index,
      name: typeof row.name === "string" ? row.name : undefined,
      mesh: typeof row.mesh === "number" ? row.mesh : undefined,
      children: Array.isArray(row.children) ? row.children.filter((c): c is number => typeof c === "number") : undefined,
      translation: numList(row.translation),
      rotation: numList(row.rotation),
      scale: numList(row.scale),
    };
  });

  let primitiveCount = 0;
  for (const mesh of meshesRaw) {
    const prims = asObj(mesh).primitives;
    if (Array.isArray(prims)) primitiveCount += prims.length;
  }

  let finiteTransforms = true;
  for (const node of nodes) {
    for (const list of [node.translation, node.rotation, node.scale]) {
      if (list && list.some((n) => !Number.isFinite(n))) finiteTransforms = false;
    }
    if (node.rotation && node.rotation.length === 4) {
      const [x, y, z, w] = node.rotation;
      const len = Math.hypot(x!, y!, z!, w!);
      if (Math.abs(len - 1) > 0.01) warnings.push(`node ${node.index} rotation is not unit length`);
    }
  }

  if (!meshesRaw.length) errors.push("no meshes in GLB");
  if (unsupportedRequired.length) {
    errors.push(`unsupported required extensions: ${unsupportedRequired.join(", ")}`);
  }
  if (skinsRaw.length && !capabilities.supportsSkins) {
    warnings.push("skins present but renderer does not declare skin support");
  }
  if (animationsRaw.length && !capabilities.supportsAnimations) {
    warnings.push("animations present but renderer does not declare animation support");
  }

  const support: GlbSupportLevel = errors.length || !capabilities.supportsStaticMeshes ? "unsupported" : "static-mesh";

  return {
    ok: errors.length === 0,
    support,
    version,
    jsonByteLength: jsonBytes.byteLength,
    binByteLength,
    sceneCount: scenesRaw.length,
    nodeCount: nodesRaw.length,
    meshCount: meshesRaw.length,
    primitiveCount,
    materialCount: materialsRaw.length,
    textureCount: texturesRaw.length,
    imageCount: imagesRaw.length,
    bufferCount: buffersRaw.length,
    bufferViewCount: bufferViewsRaw.length,
    accessorCount: accessorsRaw.length,
    skinCount: skinsRaw.length,
    animationCount: animationsRaw.length,
    animationNames: animationsRaw
      .map((a) => (asObj(a).name as string | undefined) ?? "")
      .filter((n) => n.length > 0),
    jointCount: skinsRaw.reduce((n, s) => {
      const joints = asObj(s).joints;
      return n + (Array.isArray(joints) ? joints.length : 0);
    }, 0),
    extensionsUsed,
    extensionsRequired,
    unsupportedRequired,
    scenes,
    nodes,
    finiteTransforms,
    errors,
    warnings,
  };
}

export function encodeGlb(doc: unknown, bin?: Uint8Array): Uint8Array {
  let json = JSON.stringify(doc);
  while (json.length % 4 !== 0) json += " ";
  const jsonBytes = new TextEncoder().encode(json);
  const binPadded = pad4(bin ?? new Uint8Array(0));
  const hasBin = (bin?.byteLength ?? 0) > 0;
  const total = 12 + 8 + jsonBytes.byteLength + (hasBin ? 8 + binPadded.byteLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.byteLength, true);
  view.setUint32(16, CHUNK_JSON, true);
  out.set(jsonBytes, 20);
  if (hasBin) {
    const start = 20 + jsonBytes.byteLength;
    view.setUint32(start, binPadded.byteLength, true);
    view.setUint32(start + 4, CHUNK_BIN, true);
    out.set(binPadded, start + 8);
  }
  return out;
}

function pad4(bytes: Uint8Array): Uint8Array {
  const pad = (4 - (bytes.byteLength % 4)) % 4;
  if (!pad) return bytes;
  const out = new Uint8Array(bytes.byteLength + pad);
  out.set(bytes);
  return out;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function numList(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((n): n is number => typeof n === "number");
}

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
