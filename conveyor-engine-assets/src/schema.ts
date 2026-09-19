import { hashCanonicalJson, isContentHash } from "./hash.js";
import type {
  AssetEntry,
  AssetKind,
  AuthorityClass,
  AuthoritativeCompatibility,
  EngineManifest,
  LicenseRecord,
  LicenseStatus,
  OriginCategory,
  PresentationCompatibility,
  ProvenanceRecord,
  RedistributionStatus,
  RuntimeRole,
} from "./types.js";

export type SchemaIssue = { path: string; message: string };

export class ManifestSchemaError extends Error {
  readonly issues: SchemaIssue[];
  constructor(issues: SchemaIssue[]) {
    super(issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    this.name = "ManifestSchemaError";
    this.issues = issues;
  }
}

const KINDS = new Set<AssetKind>([
  "primitive",
  "material",
  "texture",
  "static-visual-scene",
  "static-collision-scene",
  "navigation-spatial",
  "renderable-model",
  "skinned-character-model",
  "animation-set",
  "material-descriptor",
  "audio",
  "render-descriptor",
  "simulation-configuration",
  "rules-patch",
  "spawn-trigger-metadata",
  "world-manifest",
  "asset-bundle",
  "development-source",
  "conversion-artifact",
  "custom",
]);

const LICENSE_STATUSES = new Set<LicenseStatus>([
  "spdx",
  "text-reference",
  "unknown",
  "needs-review",
  "internal-only",
  "public-approved",
]);
const REDIST = new Set<RedistributionStatus>(["allowed", "denied", "unknown"]);
const ORIGINS = new Set<OriginCategory>([
  "manual",
  "procedural",
  "imported-open-content",
  "imported-third-party",
  "ai-assisted",
  "scanned",
  "generated-test-fixture",
  "derived",
  "unknown",
]);
const ROLES = new Set<RuntimeRole>([
  "collision",
  "navigation",
  "spawn",
  "trigger",
  "rules",
  "world-bounds",
  "visual-scene",
  "model",
  "material",
  "texture",
  "audio",
  "animation",
  "render-descriptor",
  "bundle",
  "source",
  "diagnostic",
  "unknown",
]);

const AUTHORITIES = new Set<AuthorityClass>([
  "authoritative",
  "authoritative-static",
  "authoritative-admitted",
  "presentation",
  "presentation-required",
  "development",
  "diagnostic",
]);

const SECRET_KEY_RE =
  /^(accessToken|signedUrl|apiKey|api_key|secret|password|cookie|sessionCookie|authorization|authToken|privateKey)$/i;

const SIGNED_URI_RE = /[?&](X-Amz-|token=|sig=|signature=|expires=)/i;
const ABS_PATH_RE = /^([A-Za-z]:[\\/]|\/)/;
const WORKSTATION_RE = /^\/(Users|home|tmp|var\/folders)\b/;

export function parseManifest(input: unknown): EngineManifest {
  const issues: SchemaIssue[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ManifestSchemaError([{ path: "$", message: "manifest must be an object" }]);
  }
  const raw = input as Record<string, unknown>;
  scanSecrets(raw, "$", issues);

  const formatVersion = raw.formatVersion;
  if (formatVersion !== 1) {
    issues.push({ path: "formatVersion", message: "must be 1" });
  }
  if (typeof raw.bundleId !== "string" || !raw.bundleId) {
    issues.push({ path: "bundleId", message: "required string" });
  }
  if (typeof raw.bundleVersion !== "string" || !raw.bundleVersion) {
    issues.push({ path: "bundleVersion", message: "required string" });
  }
  if (!Array.isArray(raw.assets)) {
    issues.push({ path: "assets", message: "required array" });
    throw new ManifestSchemaError(issues);
  }

  const assets: AssetEntry[] = [];
  const seen = new Set<string>();
  raw.assets.forEach((item, i) => {
    const path = `assets[${i}]`;
    const entry = parseEntry(item, path, issues);
    if (!entry) return;
    if (seen.has(entry.id)) {
      issues.push({ path: `${path}.id`, message: `duplicate id ${entry.id}` });
    }
    seen.add(entry.id);
    assets.push(entry);
  });

  if (issues.length) throw new ManifestSchemaError(issues);

  return {
    formatVersion: 1,
    bundleId: raw.bundleId as string,
    bundleVersion: raw.bundleVersion as string,
    protocolVersion: optString(raw.protocolVersion),
    schemaVersion: optString(raw.schemaVersion),
    assets,
    developerNotes: optString(raw.developerNotes),
  };
}

export function parseManifestJson(text: string): EngineManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new ManifestSchemaError([{ path: "$", message: `invalid json: ${(err as Error).message}` }]);
  }
  return parseManifest(parsed);
}

function parseEntry(item: unknown, path: string, issues: SchemaIssue[]): AssetEntry | undefined {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    issues.push({ path, message: "entry must be an object" });
    return undefined;
  }
  const raw = item as Record<string, unknown>;
  const id = raw.id;
  const kind = raw.kind;
  const authority = raw.authority;
  const version = raw.version;
  const contentHash = raw.contentHash;
  const runtimeUri = raw.runtimeUri;

  if (typeof id !== "string" || !id) issues.push({ path: `${path}.id`, message: "required string" });
  if (typeof kind !== "string" || !KINDS.has(kind as AssetKind)) {
    issues.push({ path: `${path}.kind`, message: "unknown kind" });
  }
  if (typeof authority !== "string" || !AUTHORITIES.has(authority as AuthorityClass)) {
    issues.push({ path: `${path}.authority`, message: "unknown authority" });
  }
  if (typeof version !== "string" || !version) issues.push({ path: `${path}.version`, message: "required string" });
  if (typeof contentHash !== "string" || !isContentHash(contentHash)) {
    issues.push({ path: `${path}.contentHash`, message: "must be sha256:<64 hex>" });
  }
  if (typeof runtimeUri !== "string" || !runtimeUri) {
    issues.push({ path: `${path}.runtimeUri`, message: "required string" });
  } else {
    if (ABS_PATH_RE.test(runtimeUri) || WORKSTATION_RE.test(runtimeUri)) {
      issues.push({ path: `${path}.runtimeUri`, message: "absolute or workstation paths are forbidden" });
    }
    if (SIGNED_URI_RE.test(runtimeUri)) {
      issues.push({ path: `${path}.runtimeUri`, message: "signed or tokenized URLs are forbidden" });
    }
    if (runtimeUri.startsWith("http:") || runtimeUri.startsWith("https:")) {
      // allowed as a scheme hint only if no query credentials; still not identity
    }
  }

  const dependencies: { id: string; version?: string }[] = [];
  if (raw.dependencies !== undefined) {
    if (!Array.isArray(raw.dependencies)) {
      issues.push({ path: `${path}.dependencies`, message: "must be an array" });
    } else {
      raw.dependencies.forEach((dep, j) => {
        if (typeof dep === "string") {
          dependencies.push({ id: dep });
          return;
        }
        if (!dep || typeof dep !== "object") {
          issues.push({ path: `${path}.dependencies[${j}]`, message: "invalid dependency" });
          return;
        }
        const d = dep as Record<string, unknown>;
        if (typeof d.id !== "string") {
          issues.push({ path: `${path}.dependencies[${j}].id`, message: "required string" });
          return;
        }
        dependencies.push({ id: d.id, version: optString(d.version) });
      });
    }
  }

  if (typeof id !== "string" || typeof kind !== "string" || typeof authority !== "string" || typeof version !== "string" || typeof contentHash !== "string" || typeof runtimeUri !== "string") {
    return undefined;
  }
  if (!KINDS.has(kind as AssetKind) || !AUTHORITIES.has(authority as AuthorityClass) || !isContentHash(contentHash)) {
    return undefined;
  }

  return {
    id,
    kind: kind as AssetKind,
    authority: authority as AuthorityClass,
    version,
    contentHash,
    runtimeUri,
    dependencies: dependencies.length ? dependencies : undefined,
    license: parseLicense(raw.license, `${path}.license`, issues),
    attribution: optString(raw.attribution),
    provenance: parseProvenance(raw.provenance, `${path}.provenance`, issues),
    runtimePolicy: parsePolicy(raw.runtimePolicy, `${path}.runtimePolicy`, issues),
    runtimeRole: parseRole(raw.runtimeRole, `${path}.runtimeRole`, issues),
    requiredExtensions: Array.isArray(raw.requiredExtensions)
      ? raw.requiredExtensions.filter((x): x is string => typeof x === "string")
      : undefined,
    metadata: raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>)
      : undefined,
  };
}

function parseLicense(value: unknown, path: string, issues: SchemaIssue[]): LicenseRecord | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    return { id: value, status: "spdx" };
  }
  if (!value || typeof value !== "object") {
    issues.push({ path, message: "invalid license" });
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const statusRaw = optString(raw.status) ?? (raw.id ? "spdx" : "unknown");
  if (!LICENSE_STATUSES.has(statusRaw as LicenseStatus)) {
    issues.push({ path: `${path}.status`, message: "unknown license status" });
  }
  const redist = raw.redistribution;
  if (redist !== undefined && !REDIST.has(redist as RedistributionStatus)) {
    issues.push({ path: `${path}.redistribution`, message: "unknown redistribution status" });
  }
  return {
    id: optString(raw.id),
    textRef: optString(raw.textRef),
    attribution: optString(raw.attribution),
    attributionUrl: optString(raw.attributionUrl),
    redistribution: REDIST.has(redist as RedistributionStatus) ? (redist as RedistributionStatus) : undefined,
    commercialUse: typeof raw.commercialUse === "boolean" ? raw.commercialUse : undefined,
    modification: typeof raw.modification === "boolean" ? raw.modification : undefined,
    shareAlike: typeof raw.shareAlike === "boolean" ? raw.shareAlike : undefined,
    status: LICENSE_STATUSES.has(statusRaw as LicenseStatus) ? (statusRaw as LicenseStatus) : "unknown",
  };
}

function parseProvenance(value: unknown, path: string, issues: SchemaIssue[]): ProvenanceRecord | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") {
    issues.push({ path, message: "invalid provenance" });
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const originRaw = optString(raw.origin) ?? "unknown";
  if (!ORIGINS.has(originRaw as OriginCategory)) {
    issues.push({ path: `${path}.origin`, message: "unknown origin category" });
  }
  return {
    origin: ORIGINS.has(originRaw as OriginCategory) ? (originRaw as OriginCategory) : "unknown",
    sourceProject: optString(raw.sourceProject),
    creator: optString(raw.creator),
    originalRef: optString(raw.originalRef),
    originalAssetId: optString(raw.originalAssetId),
    sourceHash: typeof raw.sourceHash === "string" && isContentHash(raw.sourceHash) ? raw.sourceHash : undefined,
    acquiredAt: optString(raw.acquiredAt),
    conversionTool: optString(raw.conversionTool),
    conversionVersion: optString(raw.conversionVersion),
    conversionSettingsId: optString(raw.conversionSettingsId),
    editor: optString(raw.editor),
    aiModel: optString(raw.aiModel),
    aiWorkflow: optString(raw.aiWorkflow),
    promptHash: optString(raw.promptHash),
    notes: optString(raw.notes),
    limitations: Array.isArray(raw.limitations)
      ? raw.limitations.filter((x): x is string => typeof x === "string")
      : undefined,
    parentAssetIds: Array.isArray(raw.parentAssetIds)
      ? raw.parentAssetIds.filter((x): x is string => typeof x === "string")
      : undefined,
  };
}

function parsePolicy(value: unknown, path: string, issues: SchemaIssue[]): AssetEntry["runtimePolicy"] {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const cache = raw.cache;
  if (cache !== undefined && cache !== "none" && cache !== "memory" && cache !== "refcount") {
    issues.push({ path: `${path}.cache`, message: "unknown cache policy" });
  }
  return {
    cache: cache === "none" || cache === "memory" || cache === "refcount" ? cache : undefined,
    preload: typeof raw.preload === "boolean" ? raw.preload : undefined,
    pin: typeof raw.pin === "boolean" ? raw.pin : undefined,
    fallbackAssetId: optString(raw.fallbackAssetId),
    retryLimit: typeof raw.retryLimit === "number" ? raw.retryLimit : undefined,
    timeoutMs: typeof raw.timeoutMs === "number" ? raw.timeoutMs : undefined,
    disposeOnRelease: typeof raw.disposeOnRelease === "boolean" ? raw.disposeOnRelease : undefined,
  };
}

function scanSecrets(value: unknown, path: string, issues: SchemaIssue[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanSecrets(v, `${path}[${i}]`, issues));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) {
      issues.push({ path: `${path}.${k}`, message: "secrets and credentials are forbidden in manifests" });
    }
    scanSecrets(v, `${path}.${k}`, issues);
  }
}

function parseRole(value: unknown, path: string, issues: SchemaIssue[]): RuntimeRole | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !ROLES.has(value as RuntimeRole)) {
    issues.push({ path, message: "unknown runtimeRole" });
    return undefined;
  }
  return value as RuntimeRole;
}

function optString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

const AUTH_CLASSES: AuthorityClass[] = [
  "authoritative",
  "authoritative-static",
  "authoritative-admitted",
];

export function authoritativeAssets(manifest: EngineManifest): AssetEntry[] {
  return manifest.assets.filter((a) => AUTH_CLASSES.includes(a.authority));
}

export function presentationAssets(manifest: EngineManifest): AssetEntry[] {
  return manifest.assets.filter(
    (a) => a.authority === "presentation" || a.authority === "presentation-required",
  );
}

export function collectAuthoritativeCompatibility(manifest: EngineManifest): AuthoritativeCompatibility {
  return {
    bundleId: manifest.bundleId,
    bundleVersion: manifest.bundleVersion,
    protocolVersion: manifest.protocolVersion,
    schemaVersion: manifest.schemaVersion,
    assets: authoritativeAssets(manifest)
      .map((a) => ({
        id: a.id,
        version: a.version,
        contentHash: a.contentHash,
        kind: a.kind,
        authority: a.authority,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function hashCompatibility(compat: AuthoritativeCompatibility | PresentationCompatibility): string {
  return hashCanonicalJson(compat);
}

export function collectPresentationCompatibility(manifest: EngineManifest): PresentationCompatibility {
  return {
    bundleId: manifest.bundleId,
    bundleVersion: manifest.bundleVersion,
    assets: presentationAssets(manifest)
      .map((a) => ({
        id: a.id,
        version: a.version,
        contentHash: a.contentHash,
        kind: a.kind,
        authority: a.authority,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export function evaluateManifest(
  manifest: EngineManifest,
  profile: import("./types.js").BuildProfile = "development",
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set(manifest.assets.map((a) => a.id));

  for (const a of manifest.assets) {
    if (!a.contentHash) errors.push(`${a.id}: missing hash`);
    for (const dep of a.dependencies ?? []) {
      if (!ids.has(dep.id)) errors.push(`${a.id}: missing dependency ${dep.id}`);
    }
    if ((profile === "release-strict" || profile === "demo") && (!a.license || a.license.status === "unknown")) {
      errors.push(`${a.id}: unknown or missing license under ${profile}`);
    } else if (!a.license || a.license.status === "unknown") {
      warnings.push(`${a.id}: unknown license`);
    }
    if (profile === "release-strict" && !a.provenance) {
      errors.push(`${a.id}: missing provenance under release-strict`);
    }
    if (a.authority === "authoritative-static" && a.kind === "static-visual-scene") {
      warnings.push(`${a.id}: visual scene marked authoritative-static`);
    }
  }

  const hasVisualWorld = manifest.assets.some((a) => a.kind === "static-visual-scene");
  const hasCollision = manifest.assets.some(
    (a) => a.kind === "static-collision-scene" && a.authority.startsWith("authoritative"),
  );
  if (hasVisualWorld && !hasCollision && (profile === "release-strict" || profile === "server-authoritative")) {
    errors.push("visual world is missing an authoritative collision companion");
  }

  return { ok: errors.length === 0, errors, warnings };
}
