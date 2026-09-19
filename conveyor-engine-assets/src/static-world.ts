import { parseCollisionArtifact, type CollisionAabb, type CollisionArtifact, type CollisionBounds } from "./collision.js";
import { hashCanonicalJson } from "./hash.js";
import { collectAuthoritativeCompatibility, parseManifest } from "./schema.js";
import type { AssetEntry, AssetId, ContentHash, EngineManifest, LoadedPayload } from "./types.js";

export type SpawnPoint = {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  team?: string;
  priority?: number;
  clearance?: number;
};

export type StaticWorldDefinition = {
  bundleId: string;
  bundleVersion: string;
  schemaVersion: string;
  protocolVersion?: string;
  coordinateSystem: "y-up" | "z-up";
  unitScale: number;
  bounds: CollisionBounds;
  spawnPoints: SpawnPoint[];
  aabbs: CollisionAabb[];
  collisionAssetId: AssetId;
  collisionContentHash: ContentHash;
  visualAssetId?: AssetId;
  visualContentHash?: ContentHash;
  fallbackAssetId?: AssetId;
};

export type StaticWorldCompatibilityRecord = {
  schemaVersion: string;
  bundleId: string;
  bundleVersion: string;
  protocolVersion?: string;
  coordinateSystem: "y-up" | "z-up";
  unitScale: number;
  collisionAssetId: AssetId;
  collisionContentHash: ContentHash;
  bounds: CollisionBounds;
  spawnPoints: SpawnPoint[];
  aabbs: Array<{ id: number; minX: number; maxX: number; minY?: number; maxY?: number; minZ: number; maxZ: number }>;
};

export type StaticWorldValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export class StaticWorldError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "StaticWorldError";
    this.issues = issues;
  }
}

export type PresentationResolveState = "idle" | "loading" | "ready" | "degraded" | "failed";

export type PresentationResolveResult = {
  state: PresentationResolveState;
  assetId?: AssetId;
  fallbackAssetId?: AssetId;
  usedFallback: boolean;
  failureCode?: string;
  failureMessage?: string;
};

const ARENA_MIN_SPAWNS = 2;

export function parseSpawnPoint(input: unknown, path = "spawn"): SpawnPoint {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new StaticWorldError([`${path} must be an object`]);
  }
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : typeof raw.id === "number" ? String(raw.id) : "";
  if (!id) throw new StaticWorldError([`${path}.id required`]);
  const x = num(raw.x, `${path}.x`);
  const y = raw.y === undefined ? 0 : num(raw.y, `${path}.y`);
  const z = num(raw.z, `${path}.z`);
  const yaw = raw.yaw === undefined ? 0 : num(raw.yaw, `${path}.yaw`);
  return {
    id,
    x,
    y,
    z,
    yaw,
    team: typeof raw.team === "string" ? raw.team : undefined,
    priority: typeof raw.priority === "number" ? raw.priority : undefined,
    clearance: typeof raw.clearance === "number" ? raw.clearance : undefined,
  };
}

export function definitionFromCollision(
  artifact: CollisionArtifact,
  opts: {
    bundleId: string;
    bundleVersion: string;
    schemaVersion?: string;
    protocolVersion?: string;
    collisionAssetId: AssetId;
    collisionContentHash: ContentHash;
    visualAssetId?: AssetId;
    visualContentHash?: ContentHash;
    fallbackAssetId?: AssetId;
    spawnPoints?: SpawnPoint[];
  },
): StaticWorldDefinition {
  const spawnPoints =
    opts.spawnPoints ??
    (artifact.spawnPoints ?? []).map((s) =>
      parseSpawnPoint({
        id: s.id,
        x: s.x,
        y: s.y ?? 0,
        z: s.z,
        yaw: s.yaw ?? 0,
        team: s.team,
        priority: s.priority,
        clearance: s.clearance,
      }),
    );
  return {
    bundleId: opts.bundleId,
    bundleVersion: opts.bundleVersion,
    schemaVersion: opts.schemaVersion ?? "static-world-v1",
    protocolVersion: opts.protocolVersion,
    coordinateSystem: artifact.coordinateSystem,
    unitScale: artifact.unitScale,
    bounds: artifact.bounds,
    spawnPoints,
    aabbs: artifact.aabbs ?? [],
    collisionAssetId: opts.collisionAssetId,
    collisionContentHash: opts.collisionContentHash,
    visualAssetId: opts.visualAssetId,
    visualContentHash: opts.visualContentHash,
    fallbackAssetId: opts.fallbackAssetId,
  };
}

export function staticWorldCompatibilityRecord(def: StaticWorldDefinition): StaticWorldCompatibilityRecord {
  return {
    schemaVersion: def.schemaVersion,
    bundleId: def.bundleId,
    bundleVersion: def.bundleVersion,
    protocolVersion: def.protocolVersion,
    coordinateSystem: def.coordinateSystem,
    unitScale: def.unitScale,
    collisionAssetId: def.collisionAssetId,
    collisionContentHash: def.collisionContentHash,
    bounds: { ...def.bounds },
    spawnPoints: def.spawnPoints.map(sortSpawn).sort((a, b) => a.id.localeCompare(b.id)),
    aabbs: def.aabbs
      .map((b) => ({
        id: b.id,
        minX: b.minX,
        maxX: b.maxX,
        ...(b.minY !== undefined ? { minY: b.minY } : {}),
        ...(b.maxY !== undefined ? { maxY: b.maxY } : {}),
        minZ: b.minZ,
        maxZ: b.maxZ,
      }))
      .sort((a, b) => a.id - b.id),
  };
}

export function hashStaticWorld(def: StaticWorldDefinition): ContentHash {
  return hashCanonicalJson(staticWorldCompatibilityRecord(def));
}

export function validateStaticWorld(
  def: StaticWorldDefinition,
  profile: "minimal" | "example-arena" = "minimal",
): StaticWorldValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!def.bundleId) errors.push("bundleId required");
  if (!def.bundleVersion) errors.push("bundleVersion required");
  if (!def.collisionAssetId) errors.push("collisionAssetId required");
  if (!def.collisionContentHash) errors.push("collisionContentHash required");
  assertBounds(def.bounds, errors);
  if (!Number.isFinite(def.unitScale) || def.unitScale <= 0) errors.push("unitScale must be > 0");
  if (profile === "example-arena" && def.spawnPoints.length < ARENA_MIN_SPAWNS) {
    errors.push("example-arena requires at least two spawn points");
  }
  if (profile === "example-arena" && def.aabbs.length < 4) {
    errors.push("example-arena requires at least four static AABBs");
  }
  const seenSpawn = new Set<string>();
  for (const s of def.spawnPoints) {
    if (seenSpawn.has(s.id)) errors.push(`duplicate spawn id ${s.id}`);
    seenSpawn.add(s.id);
    if (!finite(s.x, s.y, s.z, s.yaw)) errors.push(`spawn ${s.id} is non-finite`);
    if (!inBounds(s.x, s.z, def.bounds)) errors.push(`spawn ${s.id} is outside world bounds`);
    const r = s.clearance ?? 0.5;
    for (const box of def.aabbs) {
      if (pointHitsAabb(s.x, s.z, r, box)) errors.push(`spawn ${s.id} intersects aabb ${box.id}`);
    }
  }
  const seenBox = new Set<number>();
  for (const box of def.aabbs) {
    if (seenBox.has(box.id)) errors.push(`duplicate aabb id ${box.id}`);
    seenBox.add(box.id);
    if (box.maxX < box.minX || box.maxZ < box.minZ) errors.push(`aabb ${box.id} has inverted xz`);
    if (!finite(box.minX, box.maxX, box.minZ, box.maxZ)) errors.push(`aabb ${box.id} is non-finite`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function assertValidStaticWorld(def: StaticWorldDefinition, profile: "minimal" | "example-arena" = "minimal"): void {
  const check = validateStaticWorld(def, profile);
  if (!check.ok) throw new StaticWorldError(check.errors);
}

export function collisionAssetFromManifest(manifest: EngineManifest): AssetEntry | undefined {
  return manifest.assets.find(
    (a) => a.kind === "static-collision-scene" && a.authority.startsWith("authoritative"),
  );
}

export function visualAssetFromManifest(manifest: EngineManifest): AssetEntry | undefined {
  return manifest.assets.find((a) => a.kind === "static-visual-scene" && a.authority.startsWith("presentation"));
}

export function resolveStaticWorld(opts: {
  manifest: EngineManifest;
  collision: CollisionArtifact | LoadedPayload | unknown;
  profile?: "minimal" | "example-arena";
}): { definition: StaticWorldDefinition; hash: ContentHash; collision: CollisionArtifact } {
  const collisionEntry = collisionAssetFromManifest(opts.manifest);
  if (!collisionEntry) throw new StaticWorldError(["manifest is missing an authoritative static-collision-scene"]);
  const visual = visualAssetFromManifest(opts.manifest);
  const artifact = normalizeCollision(opts.collision);
  const extraSpawns = (artifact.spawnPoints ?? []).map((s) =>
    parseSpawnPoint({
      id: s.id,
      x: s.x,
      y: s.y ?? 0,
      z: s.z,
      yaw: s.yaw ?? 0,
      team: s.team,
      priority: s.priority,
      clearance: s.clearance,
    }),
  );
  const def = definitionFromCollision(artifact, {
    bundleId: opts.manifest.bundleId,
    bundleVersion: opts.manifest.bundleVersion,
    schemaVersion: opts.manifest.schemaVersion ?? "static-world-v1",
    protocolVersion: opts.manifest.protocolVersion,
    collisionAssetId: collisionEntry.id,
    collisionContentHash: collisionEntry.contentHash,
    visualAssetId: visual?.id,
    visualContentHash: visual?.contentHash,
    fallbackAssetId: visual?.runtimePolicy?.fallbackAssetId,
    spawnPoints: extraSpawns.length ? extraSpawns : undefined,
  });
  assertValidStaticWorld(def, opts.profile ?? "minimal");
  return { definition: def, hash: hashStaticWorld(def), collision: artifact };
}

export function resolveStaticWorldFromParts(opts: {
  manifestInput: unknown;
  collisionInput: unknown;
  profile?: "minimal" | "example-arena";
}): ReturnType<typeof resolveStaticWorld> {
  return resolveStaticWorld({
    manifest: parseManifest(opts.manifestInput),
    collision: opts.collisionInput,
    profile: opts.profile,
  });
}

/** Presentation plane only — never feeds canonical/replay. */
export function resolvePresentation(
  visual: AssetEntry | undefined,
  load: "ready" | "missing" | "decode-failed" | "hash-mismatch" | "skipped",
): PresentationResolveResult {
  if (!visual || load === "skipped") {
    return { state: "idle", usedFallback: false };
  }
  if (load === "ready") {
    return { state: "ready", assetId: visual.id, fallbackAssetId: visual.runtimePolicy?.fallbackAssetId, usedFallback: false };
  }
  const fallback = visual.runtimePolicy?.fallbackAssetId;
  if (fallback) {
    return {
      state: "degraded",
      assetId: visual.id,
      fallbackAssetId: fallback,
      usedFallback: true,
      failureCode: load,
      failureMessage: `visual ${visual.id} ${load}`,
    };
  }
  return {
    state: "failed",
    assetId: visual.id,
    usedFallback: false,
    failureCode: load,
    failureMessage: `visual ${visual.id} ${load} and no fallbackAssetId`,
  };
}

export function authoritativeManifestHash(manifest: EngineManifest): ContentHash {
  return hashCanonicalJson(collectAuthoritativeCompatibility(manifest));
}

function normalizeCollision(input: CollisionArtifact | LoadedPayload | unknown): CollisionArtifact {
  if (input && typeof input === "object" && "kind" in (input as object)) {
    const payload = input as LoadedPayload;
    if (payload.kind === "json") return parseCollisionArtifact(payload.value);
    throw new StaticWorldError(["collision payload must be json"]);
  }
  return parseCollisionArtifact(input);
}

function parseSpawnList(value: unknown): SpawnPoint[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new StaticWorldError(["spawnPoints must be an array"]);
  return value.map((item, i) => parseSpawnPoint(item, `spawnPoints[${i}]`));
}

function sortSpawn(s: SpawnPoint): SpawnPoint {
  const out: SpawnPoint = { id: s.id, x: s.x, y: s.y, z: s.z, yaw: s.yaw };
  if (s.team !== undefined) out.team = s.team;
  if (s.priority !== undefined) out.priority = s.priority;
  if (s.clearance !== undefined) out.clearance = s.clearance;
  return out;
}

function num(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new StaticWorldError([`${path} must be a finite number`]);
  return value;
}

function finite(...ns: number[]): boolean {
  return ns.every((n) => Number.isFinite(n));
}

function assertBounds(b: CollisionBounds, errors: string[]): void {
  if (!finite(b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ)) errors.push("world bounds contain a non-finite value");
  if (b.maxX < b.minX || b.maxY < b.minY || b.maxZ < b.minZ) errors.push("world bounds are inverted");
}

function inBounds(x: number, z: number, b: CollisionBounds): boolean {
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

function pointHitsAabb(x: number, z: number, r: number, box: CollisionAabb): boolean {
  return x + r > box.minX && x - r < box.maxX && z + r > box.minZ && z - r < box.maxZ;
}
