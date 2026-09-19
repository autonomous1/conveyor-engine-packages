/** Structural copies of assets render-profile fields so three need not import assets at runtime. */
type RenderProfile = {
  id: string;
  antialias: boolean;
  pixelRatioCap: number;
  outputColorSpace: string;
  toneMapping: string;
  exposure: number;
  environment: boolean;
  keyLightIntensity: number;
  fillLightIntensity: number;
  shadows: boolean;
  shadowMap: string;
  shadowMapSize: number;
  bloom: boolean;
  clearColor: number;
};

type LightingDescriptor = {
  keyAzimuthDeg: number;
  keyElevationDeg: number;
  keyColor: number;
  fillSkyColor: number;
  fillGroundColor: number;
  environmentIntensity: number;
};

/** Adapter so profiles apply without constructing a real WebGLRenderer in CI. */
export type RendererTarget = {
  antialias?: boolean;
  pixelRatio: number;
  toneMapping: string;
  exposure: number;
  shadowMapEnabled: boolean;
  shadowMapType: string;
  shadowMapSize: number;
  clearColor: number;
  outputColorSpace: string;
};

export type SceneLightingTarget = {
  keyIntensity: number;
  keyColor: number;
  keyAzimuthDeg: number;
  keyElevationDeg: number;
  fillIntensity: number;
  fillSkyColor: number;
  fillGroundColor: number;
  environment: boolean;
  environmentIntensity: number;
  shadows: boolean;
};

export type AppliedVisual = {
  profileId: string;
  renderer: RendererTarget;
  lighting: SceneLightingTarget;
  bloom: boolean;
};

export function applyRenderProfile(
  profile: RenderProfile,
  lighting: LightingDescriptor,
  devicePixelRatio = 1,
): AppliedVisual {
  return {
    profileId: profile.id,
    renderer: {
      antialias: profile.antialias,
      pixelRatio: Math.min(devicePixelRatio, profile.pixelRatioCap),
      toneMapping: profile.toneMapping,
      exposure: profile.exposure,
      shadowMapEnabled: profile.shadows,
      shadowMapType: profile.shadowMap,
      shadowMapSize: profile.shadowMapSize,
      clearColor: profile.clearColor,
      outputColorSpace: profile.outputColorSpace,
    },
    lighting: {
      keyIntensity: profile.keyLightIntensity,
      keyColor: lighting.keyColor,
      keyAzimuthDeg: lighting.keyAzimuthDeg,
      keyElevationDeg: lighting.keyElevationDeg,
      fillIntensity: profile.fillLightIntensity,
      fillSkyColor: lighting.fillSkyColor,
      fillGroundColor: lighting.fillGroundColor,
      environment: profile.environment,
      environmentIntensity: lighting.environmentIntensity,
      shadows: profile.shadows,
    },
    bloom: profile.bloom,
  };
}
