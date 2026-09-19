import type { AssetId, ContentHash, LoadedPayload } from "./types.js";

export type CollisionRepresentation = "aabb" | "triangle-mesh" | "occupancy-grid" | "primitives";

export type CollisionCoordinateSystem = "y-up" | "z-up";

export type CollisionBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

/** Matches conveyor-engine-world StaticObstacle. No render fields. */
export type CollisionObstacle = {
  id: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type CollisionAabb = CollisionObstacle & {
  minY?: number;
  maxY?: number;
};

export type CollisionTriangleMesh = {
  positions: number[];
  indices: number[];
};

export type CollisionOccupancyGrid = {
  originX: number;
  originZ: number;
  cellSize: number;
  width: number;
  depth: number;
  /** Row-major occupancy, width * depth. 0 = free, nonzero = blocked. */
  cells: number[];
};

export type CollisionPrimitive =
  | { type: "box"; id: number; minX: number; maxX: number; minY?: number; maxY?: number; minZ: number; maxZ: number }
  | { type: "sphere"; id: number; x: number; y?: number; z: number; radius: number }
  | { type: "capsule"; id: number; x: number; y?: number; z: number; radius: number; height: number };

export type CollisionSpawnPoint = {
  id: string;
  x: number;
  y?: number;
  z: number;
  yaw?: number;
  team?: string;
  priority?: number;
  clearance?: number;
};

export type CollisionArtifact = {
  formatVersion: 1;
  representation: CollisionRepresentation;
  coordinateSystem: CollisionCoordinateSystem;
  unitScale: number;
  origin: { x: number; y: number; z: number };
  bounds: CollisionBounds;
  visualAssetId?: AssetId;
  contentHash?: ContentHash;
  aabbs?: CollisionAabb[];
  mesh?: CollisionTriangleMesh;
  grid?: CollisionOccupancyGrid;
  primitives?: CollisionPrimitive[];
  spawnPoints?: CollisionSpawnPoint[];
};

export type CollisionValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  triangleCount?: number;
  aabbCount?: number;
  primitiveCount?: number;
  occupiedCells?: number;
};

export class CollisionParseError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(issues.join("; "));
    this.name = "CollisionParseError";
    this.issues = issues;
  }
}

const REPS = new Set<CollisionRepresentation>(["aabb", "triangle-mesh", "occupancy-grid", "primitives"]);

export function parseCollisionArtifact(input: unknown): CollisionArtifact {
  const issues: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new CollisionParseError(["collision artifact must be an object"]);
  }
  const raw = input as Record<string, unknown>;
  rejectRenderLeak(raw, issues);

  if (raw.formatVersion !== 1) issues.push("formatVersion must be 1");
  if (typeof raw.representation !== "string" || !REPS.has(raw.representation as CollisionRepresentation)) {
    issues.push("unknown representation");
  }
  const coordinateSystem = raw.coordinateSystem === "z-up" ? "z-up" : raw.coordinateSystem === "y-up" ? "y-up" : undefined;
  if (!coordinateSystem) issues.push("coordinateSystem must be y-up or z-up");
  const unitScale = num(raw.unitScale, "unitScale", issues) ?? 1;
  if (unitScale <= 0) issues.push("unitScale must be > 0");

  const origin = vec3(raw.origin, "origin", issues) ?? { x: 0, y: 0, z: 0 };
  const bounds = parseBounds(raw.bounds, issues);

  const artifact: CollisionArtifact = {
    formatVersion: 1,
    representation: (raw.representation as CollisionRepresentation) ?? "aabb",
    coordinateSystem: coordinateSystem ?? "y-up",
    unitScale,
    origin,
    bounds: bounds ?? emptyBounds(),
    visualAssetId: typeof raw.visualAssetId === "string" ? raw.visualAssetId : undefined,
    contentHash: typeof raw.contentHash === "string" ? (raw.contentHash as ContentHash) : undefined,
    spawnPoints: parseSpawnPoints(raw.spawnPoints, issues),
  };

  if (artifact.representation === "aabb") {
    artifact.aabbs = parseAabbs(raw.aabbs, issues);
  } else if (artifact.representation === "triangle-mesh") {
    artifact.mesh = parseMesh(raw.mesh, issues);
  } else if (artifact.representation === "occupancy-grid") {
    artifact.grid = parseGrid(raw.grid, issues);
  } else if (artifact.representation === "primitives") {
    artifact.primitives = parsePrimitives(raw.primitives, issues);
  }

  if (issues.length) throw new CollisionParseError(issues);
  const check = validateCollisionArtifact(artifact);
  if (!check.ok) throw new CollisionParseError(check.errors);
  return artifact;
}

export function collisionFromPayload(payload: LoadedPayload): CollisionArtifact {
  if (payload.kind !== "json") {
    throw new CollisionParseError(["collision payload must be json"]);
  }
  return parseCollisionArtifact(payload.value);
}

export function validateCollisionArtifact(artifact: CollisionArtifact): CollisionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  assertFiniteBounds(artifact.bounds, errors);
  if (!Number.isFinite(artifact.unitScale) || artifact.unitScale <= 0) errors.push("invalid unitScale");
  for (const n of [artifact.origin.x, artifact.origin.y, artifact.origin.z]) {
    if (!Number.isFinite(n)) errors.push("origin contains a non-finite value");
  }

  let triangleCount: number | undefined;
  let aabbCount: number | undefined;
  let primitiveCount: number | undefined;
  let occupiedCells: number | undefined;

  if (artifact.representation === "aabb") {
    const list = artifact.aabbs ?? [];
    aabbCount = list.length;
    if (!list.length) errors.push("aabb representation requires aabbs");
    for (const box of list) {
      if (box.maxX < box.minX || box.maxZ < box.minZ) errors.push(`aabb ${box.id} has inverted xz`);
      if (!allFinite([box.minX, box.maxX, box.minZ, box.maxZ])) errors.push(`aabb ${box.id} is non-finite`);
    }
  }

  if (artifact.representation === "triangle-mesh") {
    const mesh = artifact.mesh;
    if (!mesh) errors.push("triangle-mesh representation requires mesh");
    else {
      if (mesh.positions.length % 3 !== 0) errors.push("positions length must be a multiple of 3");
      if (mesh.indices.length % 3 !== 0) errors.push("indices length must be a multiple of 3");
      const verts = mesh.positions.length / 3;
      for (const idx of mesh.indices) {
        if (!Number.isInteger(idx) || idx < 0 || idx >= verts) {
          errors.push("mesh index out of range");
          break;
        }
      }
      if (!allFinite(mesh.positions)) errors.push("mesh positions contain a non-finite value");
      triangleCount = Math.floor(mesh.indices.length / 3);
      if (triangleCount === 0) errors.push("mesh has no triangles");
      if (triangleCount > 250_000) warnings.push("triangle count exceeds 250000");
    }
  }

  if (artifact.representation === "occupancy-grid") {
    const grid = artifact.grid;
    if (!grid) errors.push("occupancy-grid representation requires grid");
    else {
      if (grid.width <= 0 || grid.depth <= 0 || grid.cellSize <= 0) errors.push("grid dimensions must be positive");
      if (grid.cells.length !== grid.width * grid.depth) {
        errors.push("grid cells length must equal width * depth");
      }
      occupiedCells = grid.cells.reduce((n, v) => n + (v ? 1 : 0), 0);
    }
  }

  if (artifact.representation === "primitives") {
    const list = artifact.primitives ?? [];
    primitiveCount = list.length;
    if (!list.length) errors.push("primitives representation requires primitives");
    for (const p of list) {
      if (p.type === "sphere" || p.type === "capsule") {
        if (!(p.radius > 0) || !Number.isFinite(p.radius)) errors.push(`primitive ${p.id} has invalid radius`);
      }
      if (p.type === "capsule" && (!(p.height > 0) || !Number.isFinite(p.height))) {
        errors.push(`primitive ${p.id} has invalid height`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, triangleCount, aabbCount, primitiveCount, occupiedCells };
}

/** Flatten any representation into world StaticObstacle-shaped AABBs on XZ. */
export function collisionToObstacles(artifact: CollisionArtifact): CollisionObstacle[] {
  if (artifact.representation === "aabb") {
    return (artifact.aabbs ?? []).map((b) => ({
      id: b.id,
      minX: b.minX,
      maxX: b.maxX,
      minZ: b.minZ,
      maxZ: b.maxZ,
    }));
  }
  if (artifact.representation === "primitives") {
    const out: CollisionObstacle[] = [];
    for (const p of artifact.primitives ?? []) {
      if (p.type === "box") {
        out.push({ id: p.id, minX: p.minX, maxX: p.maxX, minZ: p.minZ, maxZ: p.maxZ });
      } else if (p.type === "sphere") {
        out.push({
          id: p.id,
          minX: p.x - p.radius,
          maxX: p.x + p.radius,
          minZ: p.z - p.radius,
          maxZ: p.z + p.radius,
        });
      } else {
        out.push({
          id: p.id,
          minX: p.x - p.radius,
          maxX: p.x + p.radius,
          minZ: p.z - p.radius,
          maxZ: p.z + p.radius,
        });
      }
    }
    return out;
  }
  if (artifact.representation === "occupancy-grid" && artifact.grid) {
    const g = artifact.grid;
    const out: CollisionObstacle[] = [];
    let id = 1;
    for (let z = 0; z < g.depth; z++) {
      for (let x = 0; x < g.width; x++) {
        if (!g.cells[z * g.width + x]) continue;
        const minX = g.originX + x * g.cellSize;
        const minZ = g.originZ + z * g.cellSize;
        out.push({ id: id++, minX, maxX: minX + g.cellSize, minZ, maxZ: minZ + g.cellSize });
      }
    }
    return out;
  }
  if (artifact.representation === "triangle-mesh" && artifact.mesh) {
    return trianglesToAabbs(artifact.mesh);
  }
  return [];
}

function trianglesToAabbs(mesh: CollisionTriangleMesh): CollisionObstacle[] {
  const out: CollisionObstacle[] = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t]! * 3;
    const ib = mesh.indices[t + 1]! * 3;
    const ic = mesh.indices[t + 2]! * 3;
    const xs = [mesh.positions[ia]!, mesh.positions[ib]!, mesh.positions[ic]!];
    const zs = [mesh.positions[ia + 2]!, mesh.positions[ib + 2]!, mesh.positions[ic + 2]!];
    out.push({
      id: t / 3 + 1,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    });
  }
  return out;
}

const RENDER_KEYS = new Set([
  "THREE",
  "scene",
  "material",
  "texture",
  "renderer",
  "Object3D",
  "SkinnedMesh",
  "AnimationMixer",
  "gltf",
  "glb",
]);

function rejectRenderLeak(raw: Record<string, unknown>, issues: string[]): void {
  for (const key of Object.keys(raw)) {
    if (RENDER_KEYS.has(key)) issues.push(`render/three field ${key} is forbidden on collision artifacts`);
  }
}

function parseSpawnPoints(value: unknown, issues: string[]): CollisionSpawnPoint[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    issues.push("spawnPoints must be an array");
    return undefined;
  }
  const out: CollisionSpawnPoint[] = [];
  value.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      issues.push(`spawnPoints[${i}] invalid`);
      return;
    }
    const raw = item as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : typeof raw.id === "number" ? String(raw.id) : "";
    const x = num(raw.x, `spawnPoints[${i}].x`, issues);
    const z = num(raw.z, `spawnPoints[${i}].z`, issues);
    if (!id || x === undefined || z === undefined) {
      issues.push(`spawnPoints[${i}] requires id, x, z`);
      return;
    }
    out.push({
      id,
      x,
      y: typeof raw.y === "number" ? raw.y : undefined,
      z,
      yaw: typeof raw.yaw === "number" ? raw.yaw : undefined,
      team: typeof raw.team === "string" ? raw.team : undefined,
      priority: typeof raw.priority === "number" ? raw.priority : undefined,
      clearance: typeof raw.clearance === "number" ? raw.clearance : undefined,
    });
  });
  return out;
}

function parseBounds(value: unknown, issues: string[]): CollisionBounds | undefined {
  if (!value || typeof value !== "object") {
    issues.push("bounds required");
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const bounds: CollisionBounds = {
    minX: num(raw.minX, "bounds.minX", issues) ?? 0,
    maxX: num(raw.maxX, "bounds.maxX", issues) ?? 0,
    minY: num(raw.minY, "bounds.minY", issues) ?? 0,
    maxY: num(raw.maxY, "bounds.maxY", issues) ?? 0,
    minZ: num(raw.minZ, "bounds.minZ", issues) ?? 0,
    maxZ: num(raw.maxZ, "bounds.maxZ", issues) ?? 0,
  };
  return bounds;
}

function parseAabbs(value: unknown, issues: string[]): CollisionAabb[] {
  if (!Array.isArray(value)) {
    issues.push("aabbs must be an array");
    return [];
  }
  const out: CollisionAabb[] = [];
  value.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      issues.push(`aabbs[${i}] invalid`);
      return;
    }
    const raw = item as Record<string, unknown>;
    const id = num(raw.id, `aabbs[${i}].id`, issues);
    const minX = num(raw.minX, `aabbs[${i}].minX`, issues);
    const maxX = num(raw.maxX, `aabbs[${i}].maxX`, issues);
    const minZ = num(raw.minZ, `aabbs[${i}].minZ`, issues);
    const maxZ = num(raw.maxZ, `aabbs[${i}].maxZ`, issues);
    if (id === undefined || minX === undefined || maxX === undefined || minZ === undefined || maxZ === undefined) return;
    out.push({
      id,
      minX,
      maxX,
      minZ,
      maxZ,
      minY: typeof raw.minY === "number" ? raw.minY : undefined,
      maxY: typeof raw.maxY === "number" ? raw.maxY : undefined,
    });
  });
  return out;
}

function parseMesh(value: unknown, issues: string[]): CollisionTriangleMesh | undefined {
  if (!value || typeof value !== "object") {
    issues.push("mesh required");
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.positions) || !Array.isArray(raw.indices)) {
    issues.push("mesh.positions and mesh.indices required");
    return undefined;
  }
  return {
    positions: raw.positions.map((n, i) => num(n, `mesh.positions[${i}]`, issues) ?? NaN),
    indices: raw.indices.map((n, i) => num(n, `mesh.indices[${i}]`, issues) ?? NaN),
  };
}

function parseGrid(value: unknown, issues: string[]): CollisionOccupancyGrid | undefined {
  if (!value || typeof value !== "object") {
    issues.push("grid required");
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.cells)) {
    issues.push("grid.cells required");
    return undefined;
  }
  return {
    originX: num(raw.originX, "grid.originX", issues) ?? 0,
    originZ: num(raw.originZ, "grid.originZ", issues) ?? 0,
    cellSize: num(raw.cellSize, "grid.cellSize", issues) ?? 1,
    width: num(raw.width, "grid.width", issues) ?? 0,
    depth: num(raw.depth, "grid.depth", issues) ?? 0,
    cells: raw.cells.map((n, i) => num(n, `grid.cells[${i}]`, issues) ?? 0),
  };
}

function parsePrimitives(value: unknown, issues: string[]): CollisionPrimitive[] {
  if (!Array.isArray(value)) {
    issues.push("primitives must be an array");
    return [];
  }
  const out: CollisionPrimitive[] = [];
  value.forEach((item, i) => {
    if (!item || typeof item !== "object") {
      issues.push(`primitives[${i}] invalid`);
      return;
    }
    const raw = item as Record<string, unknown>;
    const type = raw.type;
    const id = num(raw.id, `primitives[${i}].id`, issues);
    if (id === undefined) return;
    if (type === "box") {
      const minX = num(raw.minX, `primitives[${i}].minX`, issues);
      const maxX = num(raw.maxX, `primitives[${i}].maxX`, issues);
      const minZ = num(raw.minZ, `primitives[${i}].minZ`, issues);
      const maxZ = num(raw.maxZ, `primitives[${i}].maxZ`, issues);
      if (minX === undefined || maxX === undefined || minZ === undefined || maxZ === undefined) return;
      out.push({ type: "box", id, minX, maxX, minZ, maxZ });
      return;
    }
    if (type === "sphere" || type === "capsule") {
      const x = num(raw.x, `primitives[${i}].x`, issues);
      const z = num(raw.z, `primitives[${i}].z`, issues);
      const radius = num(raw.radius, `primitives[${i}].radius`, issues);
      if (x === undefined || z === undefined || radius === undefined) return;
      if (type === "capsule") {
        const height = num(raw.height, `primitives[${i}].height`, issues);
        if (height === undefined) return;
        out.push({ type: "capsule", id, x, y: typeof raw.y === "number" ? raw.y : undefined, z, radius, height });
      } else {
        out.push({ type: "sphere", id, x, y: typeof raw.y === "number" ? raw.y : undefined, z, radius });
      }
      return;
    }
    issues.push(`primitives[${i}] unknown type`);
  });
  return out;
}

function vec3(value: unknown, path: string, issues: string[]): { x: number; y: number; z: number } | undefined {
  if (!value || typeof value !== "object") {
    issues.push(`${path} required`);
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const x = num(raw.x, `${path}.x`, issues);
  const y = num(raw.y, `${path}.y`, issues);
  const z = num(raw.z, `${path}.z`, issues);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return { x, y, z };
}

function num(value: unknown, path: string, issues: string[]): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${path} must be a finite number`);
    return undefined;
  }
  return value;
}

function allFinite(values: number[]): boolean {
  return values.every((n) => Number.isFinite(n));
}

function assertFiniteBounds(bounds: CollisionBounds, errors: string[]): void {
  for (const [k, v] of Object.entries(bounds)) {
    if (!Number.isFinite(v)) errors.push(`bounds.${k} is non-finite`);
  }
  if (bounds.maxX < bounds.minX || bounds.maxZ < bounds.minZ) errors.push("bounds are inverted on xz");
}

function emptyBounds(): CollisionBounds {
  return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
}
