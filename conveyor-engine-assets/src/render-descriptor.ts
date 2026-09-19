import type { AssetId, PrimitiveShape } from "./types.js";
import type { GlbValidationReport } from "./glb.js";

export type PrimitiveFallback = {
  shape: PrimitiveShape;
  color?: number;
  material?: string;
};

export type EngineRenderDescriptor = {
  id: string;
  modelAssetId?: AssetId;
  nodeSelector?: string;
  sceneSelector?: string;
  fallback: PrimitiveFallback;
  materialClass?: string;
  tint?: number;
  scalePolicy?: "source" | "uniform" | "fit-bounds";
  shadowPolicy?: "off" | "cast" | "receive" | "cast-receive";
  visibility?: string;
  instancingEligible?: boolean;
  animationProfileId?: string;
  placeholderPolicy?: "primitive" | "hide";
  diagnostic?: boolean;
};

export class RenderDescriptorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderDescriptorError";
  }
}

export function parseRenderDescriptor(input: unknown): EngineRenderDescriptor {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new RenderDescriptorError("render descriptor must be an object");
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) throw new RenderDescriptorError("id required");
  const fallbackRaw = raw.fallback && typeof raw.fallback === "object" ? (raw.fallback as Record<string, unknown>) : raw;
  const shape = fallbackRaw.shape ?? raw.shape ?? "box";
  if (!isShape(shape)) throw new RenderDescriptorError("fallback.shape required");
  return {
    id: raw.id,
    modelAssetId: optStr(raw.modelAssetId),
    nodeSelector: optStr(raw.nodeSelector),
    sceneSelector: optStr(raw.sceneSelector),
    fallback: {
      shape,
      color: typeof fallbackRaw.color === "number" ? fallbackRaw.color : typeof raw.color === "number" ? raw.color : undefined,
      material: optStr(fallbackRaw.material) ?? optStr(raw.material),
    },
    materialClass: optStr(raw.materialClass),
    tint: typeof raw.tint === "number" ? raw.tint : undefined,
    scalePolicy: raw.scalePolicy as EngineRenderDescriptor["scalePolicy"],
    shadowPolicy: raw.shadowPolicy as EngineRenderDescriptor["shadowPolicy"],
    visibility: optStr(raw.visibility),
    instancingEligible: typeof raw.instancingEligible === "boolean" ? raw.instancingEligible : undefined,
    animationProfileId: optStr(raw.animationProfileId),
    placeholderPolicy: raw.placeholderPolicy === "hide" ? "hide" : "primitive",
    diagnostic: typeof raw.diagnostic === "boolean" ? raw.diagnostic : undefined,
  };
}

export type ResolvedRender =
  | { kind: "glb-node"; descriptor: EngineRenderDescriptor; sceneIndex: number; nodeIndex?: number; report: GlbValidationReport }
  | { kind: "primitive"; descriptor: EngineRenderDescriptor; reason: string };

export function resolveRenderDescriptor(
  descriptor: EngineRenderDescriptor,
  report?: GlbValidationReport,
): ResolvedRender {
  if (!descriptor.modelAssetId || !report || !report.ok) {
    return { kind: "primitive", descriptor, reason: report && !report.ok ? report.errors.join("; ") : "no glb report" };
  }
  let sceneIndex = 0;
  if (descriptor.sceneSelector) {
    const found = report.scenes.find((s) => s.name === descriptor.sceneSelector);
    if (!found) return { kind: "primitive", descriptor, reason: `scene ${descriptor.sceneSelector} missing` };
    sceneIndex = found.index;
  }
  if (descriptor.nodeSelector) {
    // Node lookup is by name across the file, not restricted to the selected scene.
    const found = report.nodes.find((n) => n.name === descriptor.nodeSelector);
    if (!found) return { kind: "primitive", descriptor, reason: `node ${descriptor.nodeSelector} missing` };
    return { kind: "glb-node", descriptor, sceneIndex, nodeIndex: found.index, report };
  }
  return { kind: "glb-node", descriptor, sceneIndex, report };
}

export type SkeletalMetadata = {
  modelAssetId: AssetId;
  skeletonId?: string;
  jointCount: number;
  rootJoint?: string;
  attachmentPoints?: string[];
  coordinateSystem?: "y-up" | "z-up";
  bindPoseValid?: boolean;
  clips: Array<{
    name: string;
    duration: number;
    tags?: string[];
  }>;
  requiredCapability?: "supportsSkins" | "supportsAnimations";
  warnings?: string[];
};

export function parseSkeletalMetadata(input: unknown): SkeletalMetadata {
  if (!input || typeof input !== "object") throw new RenderDescriptorError("skeletal metadata must be an object");
  const raw = input as Record<string, unknown>;
  if (typeof raw.modelAssetId !== "string") throw new RenderDescriptorError("modelAssetId required");
  const jointCount = raw.jointCount;
  if (typeof jointCount !== "number" || !Number.isInteger(jointCount) || jointCount < 0) {
    throw new RenderDescriptorError("jointCount must be a non-negative integer");
  }
  const clips = Array.isArray(raw.clips)
    ? raw.clips.flatMap((c) => {
        if (!c || typeof c !== "object") return [];
        const row = c as Record<string, unknown>;
        if (typeof row.name !== "string" || typeof row.duration !== "number" || !Number.isFinite(row.duration) || row.duration < 0) return [];
        return [{
          name: row.name,
          duration: row.duration,
          tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : undefined,
        }];
      })
    : [];
  return {
    modelAssetId: raw.modelAssetId,
    skeletonId: optStr(raw.skeletonId),
    jointCount,
    rootJoint: optStr(raw.rootJoint),
    attachmentPoints: Array.isArray(raw.attachmentPoints)
      ? raw.attachmentPoints.filter((t): t is string => typeof t === "string")
      : undefined,
    coordinateSystem: raw.coordinateSystem === "z-up" ? "z-up" : "y-up",
    bindPoseValid: typeof raw.bindPoseValid === "boolean" ? raw.bindPoseValid : undefined,
    clips,
    requiredCapability: raw.requiredCapability === "supportsSkins" ? "supportsSkins" : "supportsAnimations",
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((t): t is string => typeof t === "string") : undefined,
  };
}

function isShape(value: unknown): value is PrimitiveShape {
  return value === "box" || value === "sphere" || value === "capsule" || value === "plane" || value === "line" || value === "point";
}

function optStr(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
