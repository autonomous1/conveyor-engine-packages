export type RenderProfileId = "workstation-high" | "desktop-balanced" | "diagnostic" | "minimal";

export type ToneMappingMode = "none" | "linear" | "reinhard" | "aces-filmic" | "agx" | "neutral";

export type ShadowUpdatePolicy = "always" | "on-change" | "static-once-plus-dynamic" | "disabled";

export type RenderProfile = {
  id: RenderProfileId;
  antialias: boolean;
  pixelRatioCap: number;
  outputColorSpace: "srgb";
  toneMapping: ToneMappingMode;
  exposure: number;
  environment: boolean;
  pmrem: boolean;
  keyLightIntensity: number;
  fillLightIntensity: number;
  shadows: boolean;
  shadowMap: "basic" | "pcf" | "pcfsoft" | "vsm";
  shadowMapSize: number;
  shadowUpdate: ShadowUpdatePolicy;
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;
  clearColor: number;
  fog: boolean;
  diagnostics: "off" | "basic" | "full";
};

export type LightingDescriptor = {
  keyAzimuthDeg: number;
  keyElevationDeg: number;
  keyColor: number;
  keyIntensity: number;
  fillIntensity: number;
  fillSkyColor: number;
  fillGroundColor: number;
  environmentAssetId?: string;
  environmentFallbackAssetId?: string;
  environmentIntensity: number;
  environmentRotationY: number;
};

export type PresentationVisualDescriptor = {
  visualAssetId?: string;
  environmentAssetId?: string;
  environmentFallbackAssetId?: string;
  background: "environment" | "clear" | "none";
  lighting: LightingDescriptor;
  allowToneMappingOverride: boolean;
  exposure?: number;
  preferredProfile?: RenderProfileId;
};

export class RenderProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderProfileError";
  }
}

export const DEFAULT_LIGHTING: LightingDescriptor = {
  keyAzimuthDeg: 35,
  keyElevationDeg: 50,
  keyColor: 0xfff2d6,
  keyIntensity: 1.6,
  fillIntensity: 0.45,
  fillSkyColor: 0xc8d8ff,
  fillGroundColor: 0x3a3228,
  environmentIntensity: 1,
  environmentRotationY: 0,
};

export const RENDER_PROFILES: Record<RenderProfileId, RenderProfile> = {
  "workstation-high": {
    id: "workstation-high",
    antialias: true,
    pixelRatioCap: 2,
    outputColorSpace: "srgb",
    toneMapping: "aces-filmic",
    exposure: 1,
    environment: true,
    pmrem: true,
    keyLightIntensity: 1.8,
    fillLightIntensity: 0.35,
    shadows: true,
    shadowMap: "pcfsoft",
    shadowMapSize: 2048,
    shadowUpdate: "always",
    bloom: true,
    bloomStrength: 0.25,
    bloomThreshold: 0.85,
    bloomRadius: 0.4,
    clearColor: 0x0b0d12,
    fog: false,
    diagnostics: "full",
  },
  "desktop-balanced": {
    id: "desktop-balanced",
    antialias: true,
    pixelRatioCap: 1.5,
    outputColorSpace: "srgb",
    toneMapping: "aces-filmic",
    exposure: 1,
    environment: true,
    pmrem: true,
    keyLightIntensity: 1.5,
    fillLightIntensity: 0.45,
    shadows: true,
    shadowMap: "pcf",
    shadowMapSize: 1024,
    shadowUpdate: "always",
    bloom: false,
    bloomStrength: 0.2,
    bloomThreshold: 0.9,
    bloomRadius: 0.3,
    clearColor: 0x10141c,
    fog: false,
    diagnostics: "basic",
  },
  diagnostic: {
    id: "diagnostic",
    antialias: false,
    pixelRatioCap: 1,
    outputColorSpace: "srgb",
    toneMapping: "none",
    exposure: 1,
    environment: false,
    pmrem: false,
    keyLightIntensity: 1.1,
    fillLightIntensity: 0.7,
    shadows: false,
    shadowMap: "basic",
    shadowMapSize: 512,
    shadowUpdate: "disabled",
    bloom: false,
    bloomStrength: 0,
    bloomThreshold: 1,
    bloomRadius: 0,
    clearColor: 0x202830,
    fog: false,
    diagnostics: "full",
  },
  minimal: {
    id: "minimal",
    antialias: false,
    pixelRatioCap: 1,
    outputColorSpace: "srgb",
    toneMapping: "none",
    exposure: 1,
    environment: false,
    pmrem: false,
    keyLightIntensity: 0.9,
    fillLightIntensity: 0.5,
    shadows: false,
    shadowMap: "basic",
    shadowMapSize: 256,
    shadowUpdate: "disabled",
    bloom: false,
    bloomStrength: 0,
    bloomThreshold: 1,
    bloomRadius: 0,
    clearColor: 0x111111,
    fog: false,
    diagnostics: "off",
  },
};

const AUTHORITATIVE_KEYS = new Set([
  "tickRate",
  "collision",
  "replication",
  "canonicalSeed",
  "authoritativeHash",
  "bundleId",
]);

export function validateRenderProfile(input: unknown): RenderProfile {
  if (!input || typeof input !== "object") throw new RenderProfileError("profile must be an object");
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (AUTHORITATIVE_KEYS.has(key)) throw new RenderProfileError(`profile must not contain authoritative field ${key}`);
  }
  const id = raw.id;
  if (id !== "workstation-high" && id !== "desktop-balanced" && id !== "diagnostic" && id !== "minimal") {
    throw new RenderProfileError("unknown profile id");
  }
  return RENDER_PROFILES[id];
}

export function parsePresentationVisual(input: unknown): PresentationVisualDescriptor {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const lightingIn = raw.lighting && typeof raw.lighting === "object" ? (raw.lighting as Partial<LightingDescriptor>) : {};
  return {
    visualAssetId: typeof raw.visualAssetId === "string" ? raw.visualAssetId : undefined,
    environmentAssetId: typeof raw.environmentAssetId === "string" ? raw.environmentAssetId : undefined,
    environmentFallbackAssetId: typeof raw.environmentFallbackAssetId === "string" ? raw.environmentFallbackAssetId : undefined,
    background: raw.background === "environment" || raw.background === "none" ? raw.background : "clear",
    lighting: { ...DEFAULT_LIGHTING, ...lightingIn },
    allowToneMappingOverride: raw.allowToneMappingOverride === true,
    exposure: typeof raw.exposure === "number" ? raw.exposure : undefined,
    preferredProfile: typeof raw.preferredProfile === "string" ? (raw.preferredProfile as RenderProfileId) : undefined,
  };
}
