export type AssetKey = string;
export type AssetId = string;
export type AssetVersion = string;
export type ContentHash = `sha256:${string}`;
export type RequestId = string;

export type PrimitiveShape = "box" | "sphere" | "capsule" | "plane" | "line" | "point";

/** Legacy catalog kinds kept for the primitive shim. */
export type LegacyAssetKind = "primitive" | "material" | "texture";

export type AssetKind =
  | LegacyAssetKind
  | "static-visual-scene"
  | "static-collision-scene"
  | "navigation-spatial"
  | "renderable-model"
  | "skinned-character-model"
  | "animation-set"
  | "material-descriptor"
  | "audio"
  | "render-descriptor"
  | "simulation-configuration"
  | "rules-patch"
  | "spawn-trigger-metadata"
  | "world-manifest"
  | "asset-bundle"
  | "development-source"
  | "conversion-artifact"
  | "custom";

export type AuthorityClass =
  | "authoritative"
  | "authoritative-static"
  | "authoritative-admitted"
  | "presentation"
  | "presentation-required"
  | "development"
  | "diagnostic";

export type RuntimeRole =
  | "collision"
  | "navigation"
  | "spawn"
  | "trigger"
  | "rules"
  | "world-bounds"
  | "visual-scene"
  | "model"
  | "material"
  | "texture"
  | "audio"
  | "animation"
  | "render-descriptor"
  | "bundle"
  | "source"
  | "diagnostic"
  | "unknown";

export type AssetLifecycleState =
  | "unresolved"
  | "resolving"
  | "queued"
  | "loading"
  | "verifying"
  | "decoding"
  | "ready"
  | "degraded"
  | "failed"
  | "cancelled"
  | "disposing"
  | "disposed";

export type OriginCategory =
  | "manual"
  | "procedural"
  | "imported-open-content"
  | "imported-third-party"
  | "ai-assisted"
  | "scanned"
  | "generated-test-fixture"
  | "derived"
  | "unknown";

export type BuildProfile =
  | "development"
  | "test"
  | "demo"
  | "release-strict"
  | "server-authoritative"
  | "client-presentation"
  | "low-memory"
  | "workstation-high";

export type FailureCode =
  | "not-found"
  | "invalid-manifest"
  | "missing-hash"
  | "hash-mismatch"
  | "dependency"
  | "timeout"
  | "cancelled"
  | "decode"
  | "policy"
  | "unsupported"
  | "provider"
  | "stale"
  | "size-limit";

export type LicenseStatus =
  | "spdx"
  | "text-reference"
  | "unknown"
  | "needs-review"
  | "internal-only"
  | "public-approved";

export type RedistributionStatus = "allowed" | "denied" | "unknown";

export type ProvenanceRecord = {
  origin: OriginCategory;
  sourceProject?: string;
  creator?: string;
  originalRef?: string;
  originalAssetId?: string;
  sourceHash?: ContentHash;
  acquiredAt?: string;
  conversionTool?: string;
  conversionVersion?: string;
  conversionSettingsId?: string;
  editor?: string;
  aiModel?: string;
  aiWorkflow?: string;
  promptHash?: string;
  parentAssetIds?: AssetId[];
  notes?: string;
  limitations?: string[];
};

export type LicenseRecord = {
  id?: string;
  textRef?: string;
  attribution?: string;
  attributionUrl?: string;
  redistribution?: RedistributionStatus;
  commercialUse?: boolean;
  modification?: boolean;
  shareAlike?: boolean;
  status: LicenseStatus;
};

export type ValidationRecord = {
  status: "pass" | "warn" | "fail" | "unchecked";
  warnings?: string[];
  errors?: string[];
  checkedAt?: string;
};

export type RuntimePolicy = {
  cache?: "none" | "memory" | "refcount";
  preload?: boolean;
  pin?: boolean;
  fallbackAssetId?: AssetId;
  retryLimit?: number;
  timeoutMs?: number;
  disposeOnRelease?: boolean;
};

export type DependencyRef = {
  id: AssetId;
  version?: string;
};

export type BuildRecord = {
  tool?: string;
  version?: string;
  settingsId?: string;
};

export type AssetEntry = {
  id: AssetId;
  kind: AssetKind;
  authority: AuthorityClass;
  version: AssetVersion;
  contentHash: ContentHash;
  runtimeUri: string;
  dependencies?: DependencyRef[];
  license?: LicenseRecord;
  attribution?: string;
  provenance?: ProvenanceRecord;
  build?: BuildRecord;
  validation?: ValidationRecord;
  runtimePolicy?: RuntimePolicy;
  runtimeRole?: RuntimeRole;
  requiredExtensions?: string[];
  metadata?: Record<string, unknown>;
};

export type EngineManifest = {
  formatVersion: number;
  bundleId: string;
  bundleVersion: string;
  protocolVersion?: string;
  schemaVersion?: string;
  assets: AssetEntry[];
  developerNotes?: string;
};

export type CompatibilityAsset = {
  id: AssetId;
  version: AssetVersion;
  contentHash: ContentHash;
  kind: AssetKind;
  authority: AuthorityClass;
};

export type AuthoritativeCompatibility = {
  bundleId: string;
  bundleVersion: string;
  protocolVersion?: string;
  schemaVersion?: string;
  assets: CompatibilityAsset[];
};

export type PresentationCompatibility = {
  bundleId: string;
  bundleVersion: string;
  assets: CompatibilityAsset[];
};

/** Presentation catalog entry. Never written into AuthoritativeWorld. */
export type AssetRecord = {
  key: AssetKey;
  kind: AssetKind | LegacyAssetKind;
  shape?: PrimitiveShape;
  type?: string;
  color?: number;
  material?: string;
  texture?: string;
};

export type RenderRef = {
  type: string;
  shape: PrimitiveShape;
  color?: number;
  material?: string;
  assetKey: AssetKey;
};

export type AssetMetrics = {
  requestCount: number;
  coalescedRequestCount: number;
  cacheHitCount: number;
  cacheMissCount: number;
  bytesAcquired: number;
  readyCount: number;
  degradedCount: number;
  failureCount: number;
  cancellationCount: number;
  retryCount: number;
  hashMismatchCount: number;
  ownershipCount: number;
  releaseCount: number;
  disposalCount: number;
  pinCount: number;
  pinnedCount: number;
  admissionStagedCount: number;
  admissionAcceptedCount: number;
  admissionRejectedCount: number;
};

export type OwnershipScope = {
  consumer?: string;
  clientId?: number;
  regionId?: string;
  entityId?: number;
};

export type AdmissionOutcome = "accepted" | "rejected";

export type AdmissionRecord = {
  assetId: AssetId;
  version: AssetVersion;
  contentHash: ContentHash;
  authority: AuthorityClass;
  tick: bigint;
  outcome: AdmissionOutcome;
  requestId: RequestId;
  reason?: string;
};

export type AssetRuntimeEvent =
  | { type: "ready"; snapshot: AssetSnapshot }
  | { type: "degraded"; snapshot: AssetSnapshot }
  | { type: "failed"; snapshot: AssetSnapshot }
  | { type: "cancelled"; snapshot: AssetSnapshot }
  | { type: "released"; snapshot: AssetSnapshot }
  | { type: "disposed"; assetId: AssetId; version?: AssetVersion; contentHash?: ContentHash }
  | { type: "pinned"; assetId: AssetId }
  | { type: "unpinned"; assetId: AssetId }
  | { type: "region-loaded"; regionId: string }
  | { type: "region-unloaded"; regionId: string }
  | { type: "client-disconnected"; clientId: number }
  | { type: "resource-replaced"; assetId: AssetId; previousHash?: ContentHash; nextHash?: ContentHash }
  | { type: "admission-staged"; record: Omit<AdmissionRecord, "tick" | "outcome"> }
  | { type: "admission-applied"; record: AdmissionRecord };

export type LoadedPayload =
  | { kind: "bytes"; bytes: Uint8Array }
  | { kind: "json"; value: unknown }
  | { kind: "text"; value: string };

export type AssetSnapshot = {
  requestId: RequestId;
  assetId: AssetId;
  version?: AssetVersion;
  contentHash?: ContentHash;
  state: AssetLifecycleState;
  role?: RuntimeRole;
  failureCode?: FailureCode;
  failureMessage?: string;
  retryCount: number;
  degraded: boolean;
  fallbackAssetId?: AssetId;
};
