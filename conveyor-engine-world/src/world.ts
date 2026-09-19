import { compareId, type EntityId, type OwnerId, type Tick } from "conveyor-engine-core";
import { PackedWorldStore } from "./store.js";
import { UniformGrid } from "./spatial.js";
import {
  DEFAULT_MOVEMENT,
  type CanonicalWorldState,
  type MovementConfig,
  type QueryFilter,
  type StaticObstacle,
  type WorldBounds,
  type WorldCommand,
  type WorldMetrics,
  type WorldSnapshot,
  type WorldSpawnPoint,
  type ImmutableEntityView,
} from "./types.js";

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value as object)) freezeDeep(v);
  }
  return value;
}

export class AuthoritativeWorld {
  readonly store = new PackedWorldStore();
  readonly spatial: UniformGrid;
  readonly worldVersion: string;
  readonly movement: MovementConfig;
  private tick: Tick = 0n;
  private pending: WorldCommand[] = [];
  private readonly obstacles: StaticObstacle[] = [];
  private seq = 0;
  private createdThisTick: EntityId[] = [];
  private destroyedThisTick: EntityId[] = [];
  readonly metrics: WorldMetrics = {
    entityCount: 0,
    createCount: 0,
    destroyCount: 0,
    commandCount: 0,
    commitDurationMs: 0,
    queryCount: 0,
    spatialUpdateCount: 0,
    spatialOccupancy: 0,
  };

  /** Session compatibility hash for authoritative assets. */
  assetsCompatHash?: string;
  bundleId?: string;
  /** Circle-circle pawn separation. Off by default so stacked test entities stay put. */
  actorSeparation = false;
  private bounds?: WorldBounds;
  private spawnPoints: WorldSpawnPoint[] = [];
  private spawnCursor = 0;
  private readonly actionEpoch = new Map<EntityId, number>();
  private readonly actionName = new Map<EntityId, string>();

  constructor(opts: { worldVersion?: string; cellSize?: number; movement?: Partial<MovementConfig> } = {}) {
    this.worldVersion = opts.worldVersion ?? "world-v1";
    this.spatial = new UniformGrid(opts.cellSize ?? 16);
    this.movement = { ...DEFAULT_MOVEMENT, ...opts.movement };
  }

  setAssetCompatibilityHash(hash: string | undefined): void {
    this.assetsCompatHash = hash;
  }

  get currentTick(): Tick {
    return this.tick;
  }

  exists(id: EntityId): boolean {
    return this.store.has(id);
  }

  enqueue(cmd: WorldCommand): void {
    this.pending.push(cmd);
  }

  addObstacle(obstacle: StaticObstacle): void {
    this.obstacles.push({
      id: obstacle.id,
      minX: Math.min(obstacle.minX, obstacle.maxX),
      maxX: Math.max(obstacle.minX, obstacle.maxX),
      minZ: Math.min(obstacle.minZ, obstacle.maxZ),
      maxZ: Math.max(obstacle.minZ, obstacle.maxZ),
    });
    this.obstacles.sort((a, b) => a.id - b.id);
  }

  listObstacles(): readonly StaticObstacle[] {
    return this.obstacles;
  }

  setWorldBounds(bounds: WorldBounds): void {
    this.bounds = { ...bounds };
  }

  getWorldBounds(): WorldBounds | undefined {
    return this.bounds ? { ...this.bounds } : undefined;
  }

  setBundleIdentity(bundleId: string | undefined, hash: string | undefined): void {
    this.bundleId = bundleId;
    this.assetsCompatHash = hash;
  }

  addSpawnPoint(spawn: WorldSpawnPoint): void {
    this.spawnPoints.push({ ...spawn });
    this.spawnPoints.sort((a, b) => a.id.localeCompare(b.id));
  }

  listSpawnPoints(): readonly WorldSpawnPoint[] {
    return this.spawnPoints;
  }

  /** Deterministic spawn pick: clientId-derived index, not wall clock. */
  selectSpawn(clientId: number): WorldSpawnPoint {
    if (this.spawnPoints.length === 0) {
      return { id: "origin", x: 0, y: 0, z: 0, yaw: 0 };
    }
    const idx = ((clientId - 1) % this.spawnPoints.length + this.spawnPoints.length) % this.spawnPoints.length;
    return { ...this.spawnPoints[idx]! };
  }

  triggerAction(entity: EntityId, action = "action-primary"): number {
    const next = (this.actionEpoch.get(entity) ?? 0) + 1;
    this.actionEpoch.set(entity, next);
    this.actionName.set(entity, action);
    return next;
  }

  animationOf(entity: EntityId): { actionEpoch: number; action?: string } {
    return { actionEpoch: this.actionEpoch.get(entity) ?? 0, action: this.actionName.get(entity) };
  }

  nextSpawnRoundRobin(): WorldSpawnPoint {
    if (this.spawnPoints.length === 0) {
      return { id: "origin", x: 0, y: 0, z: 0, yaw: 0 };
    }
    const spawn = this.spawnPoints[this.spawnCursor % this.spawnPoints.length]!;
    this.spawnCursor += 1;
    return { ...spawn };
  }

  clearInput(entity: EntityId): void {
    this.enqueue({ kind: "clearInput", entity });
  }

  createEntity(tick: Tick = this.tick, render?: ImmutableEntityView["render"], owner?: OwnerId): EntityId {
    const id = this.store.allocateId();
    this.enqueue({ kind: "create", entity: id, tick, render, owner });
    return id;
  }

  /**
   * Command order: kind priority, then enqueue sequence, then entity id.
   */
  private rank(cmd: WorldCommand): number {
    switch (cmd.kind) {
      case "create": return 0;
      case "setLifecycle": return 1;
      case "setOwnership": return 2;
      case "setBounds": return 3;
      case "setReplication": return 4;
      case "setVelocity": return 5;
      case "applyInput": return 6;
      case "clearInput": return 7;
      case "setTransform": return 8;
      case "event": return 9;
      case "destroy": return 10;
    }
  }

  commit(tick: Tick): WorldSnapshot {
    const t0 = Date.now();
    this.tick = tick;
    this.createdThisTick = [];
    this.destroyedThisTick = [];
    const cmds = this.pending.map((c, i) => ({ c, i }));
    this.pending = [];
    cmds.sort((a, b) => {
      const r = this.rank(a.c) - this.rank(b.c);
      if (r !== 0) return r;
      if (a.i !== b.i) return a.i - b.i;
      return compareId(a.c.entity, b.c.entity);
    });
    this.store.beginCommit();
    try {
      for (const { c } of cmds) this.apply(c);
      this.resolveObstacles();
      if (this.actorSeparation) this.resolveActors();
    } finally {
      this.store.endCommit();
    }
    this.store.forEachAlive((id) => {
      const p = this.store.positionOf(id);
      const v = this.store.view(id);
      if (p && v) {
        this.spatial.update(id, p.x, p.z, v.radius);
        this.metrics.spatialUpdateCount++;
      }
    });
    this.metrics.entityCount = this.store.entityCount;
    this.metrics.commandCount += cmds.length;
    this.metrics.spatialOccupancy = this.spatial.occupancy();
    this.metrics.commitDurationMs = Date.now() - t0;
    return this.snapshot();
  }

  private resolveObstacles(): void {
    if (this.obstacles.length === 0 && !this.bounds) return;
    this.store.forEachAlive((id) => {
      const view = this.store.view(id);
      if (!view) return;
      let x = view.position.x;
      let z = view.position.z;
      let vx = view.velocity.x;
      let vz = view.velocity.z;
      const r = view.radius;
      let moved = false;
      for (const obs of this.obstacles) {
        const minX = obs.minX - r;
        const maxX = obs.maxX + r;
        const minZ = obs.minZ - r;
        const maxZ = obs.maxZ + r;
        if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) continue;
        const pushLeft = x - minX;
        const pushRight = maxX - x;
        const pushDown = z - minZ;
        const pushUp = maxZ - z;
        const smallest = Math.min(pushLeft, pushRight, pushDown, pushUp);
        if (smallest === pushLeft) {
          x = minX;
          vx = Math.min(0, vx);
        } else if (smallest === pushRight) {
          x = maxX;
          vx = Math.max(0, vx);
        } else if (smallest === pushDown) {
          z = minZ;
          vz = Math.min(0, vz);
        } else {
          z = maxZ;
          vz = Math.max(0, vz);
        }
        moved = true;
      }
      if (this.bounds) {
        const b = this.bounds;
        const clampedX = Math.min(b.maxX - r, Math.max(b.minX + r, x));
        const clampedZ = Math.min(b.maxZ - r, Math.max(b.minZ + r, z));
        if (clampedX !== x) vx = 0;
        if (clampedZ !== z) vz = 0;
        if (clampedX !== x || clampedZ !== z) {
          x = clampedX;
          z = clampedZ;
          moved = true;
        }
      }
      if (moved) {
        this.store.setTransform(id, { x, y: view.position.y, z }, view.rotation, view.scale);
        this.store.setVelocity(id, { x: vx, y: view.velocity.y, z: vz });
      }
    });
  }

  /** Deterministic circle-circle separation for live pawns. Static AABBs stay authoritative for world geometry. */
  private resolveActors(): void {
    const ids = this.store.idsSorted();
    for (let i = 0; i < ids.length; i++) {
      const aId = ids[i]!;
      const a = this.store.view(aId);
      if (!a || a.radius <= 0) continue;
      for (let j = i + 1; j < ids.length; j++) {
        const bId = ids[j]!;
        const b = this.store.view(bId);
        if (!b || b.radius <= 0) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const dist = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (dist >= min || dist === 0) continue;
        const nx = dist > 1e-8 ? dx / dist : 1;
        const nz = dist > 1e-8 ? dz / dist : 0;
        const push = (min - dist) / 2;
        this.store.setTransform(
          aId,
          { x: a.position.x - nx * push, y: a.position.y, z: a.position.z - nz * push },
          a.rotation,
          a.scale,
        );
        this.store.setTransform(
          bId,
          { x: b.position.x + nx * push, y: b.position.y, z: b.position.z + nz * push },
          b.rotation,
          b.scale,
        );
      }
    }
  }

  private apply(cmd: WorldCommand): void {
    switch (cmd.kind) {
      case "create":
        this.store.create(cmd.entity, this.tick, cmd.render, cmd.owner);
        this.createdThisTick.push(cmd.entity);
        this.metrics.createCount++;
        break;
      case "destroy":
        if (this.store.destroy(cmd.entity)) {
          this.spatial.remove(cmd.entity);
          this.actionEpoch.delete(cmd.entity);
          this.actionName.delete(cmd.entity);
          this.destroyedThisTick.push(cmd.entity);
          this.metrics.destroyCount++;
        }
        break;
      case "setTransform":
        this.store.setTransform(cmd.entity, cmd.position, cmd.rotation, cmd.scale);
        break;
      case "setVelocity":
        this.store.setVelocity(cmd.entity, cmd.linear);
        break;
      case "setBounds":
        this.store.setBounds(cmd.entity, cmd.radius);
        break;
      case "setOwnership":
        this.store.setOwnership(cmd.entity, cmd.owner);
        break;
      case "setReplication":
        this.store.setReplication(cmd.entity, cmd.flags, cmd.category);
        break;
      case "setLifecycle":
        this.store.setLifecycle(cmd.entity, cmd.render);
        break;
      case "applyInput":
        this.store.applyMove(cmd.entity, cmd.moveX, cmd.moveZ, cmd.yaw, this.movement);
        this.store.setInputSeq(cmd.entity, cmd.seq);
        break;
      case "clearInput":
        this.store.setVelocity(cmd.entity, { x: 0, y: 0, z: 0 });
        break;
      case "event":
        break;
    }
  }

  query(filter: QueryFilter = {}): ImmutableEntityView[] {
    this.metrics.queryCount++;
    const all = this.store.projectAll();
    return all.filter((e) => {
      if (filter.owner !== undefined && e.owner !== filter.owner) return false;
      if (filter.lifecycle && e.lifecycle !== filter.lifecycle) return false;
      if (filter.category !== undefined && e.category !== filter.category) return false;
      if (filter.sinceVersion !== undefined && e.replicationVersion <= filter.sinceVersion) return false;
      return true;
    });
  }

  queryRadius(x: number, z: number, radius: number): ImmutableEntityView[] {
    this.metrics.queryCount++;
    return this.spatial
      .queryRadius(x, z, radius)
      .map((id) => this.store.view(id))
      .filter((v): v is ImmutableEntityView => v !== undefined);
  }

  snapshot(): WorldSnapshot {
    const entities = freezeDeep(this.store.projectAll().map((e) => this.#withAction(e)));
    return freezeDeep({
      tick: this.tick,
      worldVersion: this.worldVersion,
      entities,
      created: [...this.createdThisTick].sort(compareId),
      destroyed: [...this.destroyedThisTick].sort(compareId),
      bundleId: this.bundleId,
      authoritativeHash: this.assetsCompatHash,
    });
  }

  canonical(): CanonicalWorldState {
    return freezeDeep(this.canonicalPlain());
  }

  /** Plain JSON value safe for conveyor-graph-simulator canonical-v1 hashing. */
  canonicalPlain(): CanonicalWorldState {
    const out: CanonicalWorldState = {
      tick: this.tick,
      worldVersion: this.worldVersion,
      entities: this.store.projectAll().map((e) => plainView(this.#withAction(e))),
    };
    if (this.bundleId !== undefined) out.bundleId = this.bundleId;
    if (this.assetsCompatHash !== undefined) out.authoritativeHash = this.assetsCompatHash;
    return out;
  }

  canonicalJson(): string {
    return JSON.stringify(this.canonicalPlain(), (_k, v) => (typeof v === "bigint" ? `${v.toString()}n` : v));
  }

  #withAction(e: ImmutableEntityView): ImmutableEntityView {
    const epoch = this.actionEpoch.get(e.id);
    if (!epoch) return e;
    return { ...e, actionEpoch: epoch, action: this.actionName.get(e.id) };
  }
}

function plainView(e: ImmutableEntityView): ImmutableEntityView {
  const out: ImmutableEntityView = {
    id: e.id,
    spawnTick: e.spawnTick,
    lifecycle: e.lifecycle,
    owner: e.owner,
    position: { ...e.position },
    rotation: { ...e.rotation },
    scale: { ...e.scale },
    velocity: { ...e.velocity },
    radius: e.radius,
    transformVersion: e.transformVersion,
    velocityVersion: e.velocityVersion,
    boundsVersion: e.boundsVersion,
    ownershipVersion: e.ownershipVersion,
    replicationVersion: e.replicationVersion,
    lifecycleVersion: e.lifecycleVersion,
    inputSeq: e.inputSeq,
    flags: e.flags,
    category: e.category,
  };
  if (e.render) {
    const render: NonNullable<ImmutableEntityView["render"]> = {
      type: e.render.type,
      shape: e.render.shape,
    };
    if (e.render.material !== undefined) render.material = e.render.material;
    if (e.render.color !== undefined) render.color = e.render.color;
    if (e.render.dynamic !== undefined) render.dynamic = e.render.dynamic;
    if (e.render.visibility !== undefined) render.visibility = e.render.visibility;
    if (e.render.assetKey !== undefined) render.assetKey = e.render.assetKey;
    out.render = render;
  }
  if (e.actionEpoch !== undefined) out.actionEpoch = e.actionEpoch;
  if (e.action !== undefined) out.action = e.action;
  return out;
}
