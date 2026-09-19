import type { AssetId } from "./types.js";
import type { GlbValidationReport } from "./glb.js";

export type AnimationSemantic = "idle" | "walk" | "run" | "action-primary";

export type AnimationProfile = {
  id: string;
  clips: Partial<Record<AnimationSemantic, string>>;
  rootMotion: "disabled";
  idleWalkFadeMs?: number;
  walkRunFadeMs?: number;
  actionFadeInMs?: number;
  actionFadeOutMs?: number;
  walkSpeed?: number;
  runSpeed?: number;
  minPlayback?: number;
  maxPlayback?: number;
  idleThreshold?: number;
  runThreshold?: number;
};

export type AnimationProfileValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

const REQUIRED: AnimationSemantic[] = ["idle", "walk", "run", "action-primary"];

export function validateAnimationProfile(
  profile: AnimationProfile,
  sniffed?: Pick<GlbValidationReport, "animationNames" | "skinCount" | "animationCount" | "ok">,
): AnimationProfileValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!profile.id) errors.push("profile.id required");
  if (profile.rootMotion !== "disabled") errors.push("A4 requires rootMotion: disabled");
  for (const sem of REQUIRED) {
    if (!profile.clips[sem]) errors.push(`missing clip alias for ${sem}`);
  }
  if (sniffed) {
    if (!sniffed.ok) errors.push("skinned GLB failed structural validation");
    if (sniffed.skinCount < 1) errors.push("skinned-model requires at least one skin");
    if (sniffed.animationCount < 1) errors.push("animated-model requires at least one animation");
    const names = new Set(sniffed.animationNames ?? []);
    if (names.size) {
      for (const [sem, clip] of Object.entries(profile.clips)) {
        if (clip && !names.has(clip)) errors.push(`clip alias ${sem} → ${clip} not in GLB`);
      }
    }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export const HUMANOID_BASIC_V1: AnimationProfile = {
  id: "humanoid-basic-v1",
  clips: {
    idle: "Idle",
    walk: "Walk",
    run: "Run",
    "action-primary": "Attack",
  },
  rootMotion: "disabled",
  idleWalkFadeMs: 120,
  walkRunFadeMs: 100,
  actionFadeInMs: 80,
  actionFadeOutMs: 120,
  walkSpeed: 2,
  runSpeed: 5,
  minPlayback: 0.5,
  maxPlayback: 1.5,
  idleThreshold: 0.2,
  runThreshold: 4,
};

export type SkinnedModelMeta = {
  assetId: AssetId;
  profileId: string;
  rootMotion: "disabled";
  fallbackAssetId?: AssetId;
};
