import {
  compareId,
  type EntityId,
  type OwnerId,
  type Tick,
  type Version,
  NO_OWNER,
  integratePlanarMove,
} from "conveyor-engine-core";
import type {
  EntityRecord,
  ImmutableEntityView,
  Quat,
  RenderDescriptor,
  Vec3,
} from "./types.js";
import { IDENTITY_QUAT, UNIT_SCALE, ZERO_VEC } from "./types.js";

const GROW = 64;

export class CommitWindowError extends Error {
  constructor(message = "world mutation outside commit window") {
    super(message);
    this.name = "CommitWindowError";
  }
}


export class PackedWorldStore {
  private cap = 0;
  private count = 0;
  private readonly index = new Map<EntityId, number>();
  private ids: EntityId[] = [];
  private px: Float64Array = new Float64Array(0);
  private py: Float64Array = new Float64Array(0);
  private pz: Float64Array = new Float64Array(0);
  private qx: Float64Array = new Float64Array(0);
  private qy: Float64Array = new Float64Array(0);
  private qz: Float64Array = new Float64Array(0);
  private qw: Float64Array = new Float64Array(0);
  private sx: Float64Array = new Float64Array(0);
  private sy: Float64Array = new Float64Array(0);
  private sz: Float64Array = new Float64Array(0);
  private vx: Float64Array = new Float64Array(0);
  private vy: Float64Array = new Float64Array(0);
  private vz: Float64Array = new Float64Array(0);
  private radius: Float64Array = new Float64Array(0);
  private flags: Int32Array = new Int32Array(0);
  private category: Int32Array = new Int32Array(0);
  private tVer: Int32Array = new Int32Array(0);
  private vVer: Int32Array = new Int32Array(0);
  private bVer: Int32Array = new Int32Array(0);
  private oVer: Int32Array = new Int32Array(0);
  private rVer: Int32Array = new Int32Array(0);
  private lVer: Int32Array = new Int32Array(0);
  private owner: Int32Array = new Int32Array(0);
  private inputSeq: Int32Array = new Int32Array(0);
  private spawnTick: bigint[] = [];
  #commitOpen = false;
  private alive: Uint8Array = new Uint8Array(0);
  private render = new Map<EntityId, RenderDescriptor>();
  private nextId: EntityId = 1;
  private generation: Version = 1;

  get entityCount(): number {
    return this.count;
  }

  get worldGeneration(): Version {
    return this.generation;
  }

  get commitOpen(): boolean {
    return this.#commitOpen;
  }

  beginCommit(): void {
    if (this.#commitOpen) throw new CommitWindowError("commit already open");
    this.#commitOpen = true;
  }

  endCommit(): void {
    if (!this.#commitOpen) throw new CommitWindowError("commit is not open");
    this.#commitOpen = false;
  }

  private assertCommit(): void {
    if (!this.#commitOpen) throw new CommitWindowError();
  }


  peekNextId(): EntityId {
    return this.nextId;
  }

  allocateId(): EntityId {
    return this.nextId++;
  }

  has(id: EntityId): boolean {
    const i = this.index.get(id);
    return i !== undefined && this.alive[i] === 1;
  }

  slot(id: EntityId): number | undefined {
    const i = this.index.get(id);
    if (i === undefined || this.alive[i] !== 1) return undefined;
    return i;
  }

  private grow(): void {
    const n = this.cap + GROW;
    const copy = <T extends Float64Array | Int32Array | Uint8Array>(src: T, Ctor: new (n: number) => T): T => {
      const next = new Ctor(n);
      next.set(src as unknown as ArrayLike<number>);
      return next;
    };
    this.ids.length = n;
    this.px = copy(this.px, Float64Array);
    this.py = copy(this.py, Float64Array);
    this.pz = copy(this.pz, Float64Array);
    this.qx = copy(this.qx, Float64Array);
    this.qy = copy(this.qy, Float64Array);
    this.qz = copy(this.qz, Float64Array);
    this.qw = copy(this.qw, Float64Array);
    this.sx = copy(this.sx, Float64Array);
    this.sy = copy(this.sy, Float64Array);
    this.sz = copy(this.sz, Float64Array);
    this.vx = copy(this.vx, Float64Array);
    this.vy = copy(this.vy, Float64Array);
    this.vz = copy(this.vz, Float64Array);
    this.radius = copy(this.radius, Float64Array);
    this.flags = copy(this.flags, Int32Array);
    this.category = copy(this.category, Int32Array);
    this.tVer = copy(this.tVer, Int32Array);
    this.vVer = copy(this.vVer, Int32Array);
    this.bVer = copy(this.bVer, Int32Array);
    this.oVer = copy(this.oVer, Int32Array);
    this.rVer = copy(this.rVer, Int32Array);
    this.lVer = copy(this.lVer, Int32Array);
    this.owner = copy(this.owner, Int32Array);
    this.inputSeq = copy(this.inputSeq, Int32Array);
    this.spawnTick.length = n;
    this.alive = copy(this.alive, Uint8Array);
    this.cap = n;
  }

  create(id: EntityId, tick: Tick, render?: RenderDescriptor, owner: OwnerId = NO_OWNER): void {
    this.assertCommit();
    if (this.index.has(id) && this.alive[this.index.get(id)!] === 1) {
      throw new Error(`entity ${id} already exists`);
    }
    if (this.count >= this.cap) this.grow();
    const i = this.count++;
    this.ids[i] = id;
    this.index.set(id, i);
    this.px[i] = 0;
    this.py[i] = 0;
    this.pz[i] = 0;
    this.qx[i] = 0;
    this.qy[i] = 0;
    this.qz[i] = 0;
    this.qw[i] = 1;
    this.sx[i] = 1;
    this.sy[i] = 1;
    this.sz[i] = 1;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.vz[i] = 0;
    this.radius[i] = 0.5;
    this.flags[i] = 0;
    this.category[i] = 0;
    this.tVer[i] = 1;
    this.vVer[i] = 1;
    this.bVer[i] = 1;
    this.oVer[i] = 1;
    this.rVer[i] = 1;
    this.lVer[i] = 1;
    this.owner[i] = owner;
    this.inputSeq[i] = 0;
    this.spawnTick[i] = tick;
    this.alive[i] = 1;
    if (render) this.render.set(id, { ...render });
    if (id >= this.nextId) this.nextId = id + 1;
    this.generation++;
  }

  destroy(id: EntityId): boolean {
    this.assertCommit();
    const i = this.slot(id);
    if (i === undefined) return false;
    const last = this.count - 1;
    this.alive[i] = 0;
    this.lVer[i]++;
    this.render.delete(id);
    if (i !== last) {
      this.swap(i, last);
    }
    this.count--;
    this.index.delete(id);
    this.generation++;
    return true;
  }

  private swap(a: number, b: number): void {
    const swapN = (arr: Float64Array | Int32Array | Uint8Array) => {
      const t = arr[a];
      arr[a] = arr[b];
      arr[b] = t;
    };
    const idA = this.ids[a];
    const idB = this.ids[b];
    this.ids[a] = idB;
    this.ids[b] = idA;
    this.index.set(idB, a);
    this.index.set(idA, b);
    swapN(this.px); swapN(this.py); swapN(this.pz);
    swapN(this.qx); swapN(this.qy); swapN(this.qz); swapN(this.qw);
    swapN(this.sx); swapN(this.sy); swapN(this.sz);
    swapN(this.vx); swapN(this.vy); swapN(this.vz);
    swapN(this.radius);
    swapN(this.flags); swapN(this.category);
    swapN(this.tVer); swapN(this.vVer); swapN(this.bVer);
    swapN(this.oVer); swapN(this.rVer); swapN(this.lVer);
    swapN(this.owner); swapN(this.inputSeq); swapN(this.alive);
    const st = this.spawnTick[a];
    this.spawnTick[a] = this.spawnTick[b]!;
    this.spawnTick[b] = st!;
  }

  setTransform(id: EntityId, p: Vec3, r: Quat, s: Vec3): boolean {
    this.assertCommit();
    const i = this.slot(id);
    if (i === undefined) return false;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.qx[i] = r.x; this.qy[i] = r.y; this.qz[i] = r.z; this.qw[i] = r.w;
    this.sx[i] = s.x; this.sy[i] = s.y; this.sz[i] = s.z;
    this.tVer[i]++;
    this.rVer[i]++;
    this.generation++;
    return true;
  }

  setVelocity(id: EntityId, v: Vec3): boolean {
    this.assertCommit();
    const i = this.slot(id);
    if (i === undefined) return false;
    this.vx[i] = v.x; this.vy[i] = v.y; this.vz[i] = v.z;
    this.vVer[i]++;
    this.rVer[i]++;
    this.generation++;
    return true;
  }

  setBounds(id: EntityId, radius: number): boolean {
    this.assertCommit();
    const i = this.slot(id);
    if (i === undefined) return false;
    this.radius[i] = radius;
    this.bVer[i]++;
    this.rVer[i]++;
    this.generation++;
    return true;
  }

  setOwnership(id: EntityId, owner: OwnerId): boolean {
    this.assertCommit();
    const i = this.slot(id);
    if (i === undefined) return false;
    this.owner[i] = owner;
    this.oVer[i]++;
    this.rVer[i]++;
    this.generation++;
    return true;
  }

  setReplication(id: EntityId, flags: number, category: number): boolean {
    this.assertCommit();
    const i = this.slot(id);
    if (i === undefined) return false;
    this.flags[i] = flags;
    this.category[i] = category;
    this.rVer[i]++;
    this.generation++;
    return true;
  }

  setLifecycle(id: EntityId, render?: RenderDescriptor): boolean {
    this.assertCommit();
    const i = this.slot(id);
    if (i === undefined) return false;
    if (render) this.render.set(id, { ...render });
    this.lVer[i]++;
    this.rVer[i]++;
    this.generation++;
    return true;
  }

  setInputSeq(id: EntityId, seq: number): boolean {
    this.assertCommit();
    const i = this.slot(id);
    if (i === undefined) return false;
    this.inputSeq[i] = seq;
    return true;
  }

  integrate(id: EntityId, dt: number): boolean {
    this.assertCommit();
    const i = this.slot(id);
    if (i === undefined) return false;
    this.px[i] += this.vx[i] * dt;
    this.py[i] += this.vy[i] * dt;
    this.pz[i] += this.vz[i] * dt;
    this.tVer[i]++;
    this.rVer[i]++;
    this.generation++;
    return true;
  }

  applyMove(id: EntityId, moveX: number, moveZ: number, yaw: number, cfg: { maxSpeed: number; accel: number; damping: number; dt: number }): boolean {
    this.assertCommit();
    const i = this.slot(id);
    if (i === undefined) return false;
    const n = integratePlanarMove(
      { px: this.px[i]!, pz: this.pz[i]!, vx: this.vx[i]!, vz: this.vz[i]!, qy: this.qy[i]!, qw: this.qw[i]! },
      moveX, moveZ, yaw, cfg,
    );
    this.px[i] = n.px;
    this.pz[i] = n.pz;
    this.vx[i] = n.vx;
    this.vz[i] = n.vz;
    this.qy[i] = n.qy;
    this.qw[i] = n.qw;
    this.qx[i] = 0;
    this.qz[i] = 0;
    this.tVer[i]++;
    this.vVer[i]++;
    this.rVer[i]++;
    this.generation++;
    return true;
  }

  view(id: EntityId): ImmutableEntityView | undefined {
    const i = this.slot(id);
    if (i === undefined) return undefined;
    return this.viewAt(i);
  }

  viewAt(i: number): ImmutableEntityView {
    const id = this.ids[i]!;
    return {
      id,
      spawnTick: this.spawnTick[i]!,
      lifecycle: "alive",
      owner: this.owner[i]! as OwnerId,
      position: { x: this.px[i]!, y: this.py[i]!, z: this.pz[i]! },
      rotation: { x: this.qx[i]!, y: this.qy[i]!, z: this.qz[i]!, w: this.qw[i]! },
      scale: { x: this.sx[i]!, y: this.sy[i]!, z: this.sz[i]! },
      velocity: { x: this.vx[i]!, y: this.vy[i]!, z: this.vz[i]! },
      radius: this.radius[i]!,
      transformVersion: this.tVer[i]!,
      velocityVersion: this.vVer[i]!,
      boundsVersion: this.bVer[i]!,
      ownershipVersion: this.oVer[i]!,
      replicationVersion: this.rVer[i]!,
      lifecycleVersion: this.lVer[i]!,
      inputSeq: this.inputSeq[i]!,
      flags: this.flags[i]!,
      category: this.category[i]!,
      render: this.render.get(id),
    };
  }

  record(id: EntityId): EntityRecord | undefined {
    const v = this.view(id);
    if (!v) return undefined;
    return {
      id: v.id,
      alive: true,
      spawnTick: v.spawnTick,
      lifecycle: v.lifecycle,
      owner: v.owner,
      transformVersion: v.transformVersion,
      velocityVersion: v.velocityVersion,
      boundsVersion: v.boundsVersion,
      ownershipVersion: v.ownershipVersion,
      replicationVersion: v.replicationVersion,
      lifecycleVersion: v.lifecycleVersion,
      inputSeq: v.inputSeq,
      flags: v.flags,
      category: v.category,
      render: v.render,
    };
  }

  idsSorted(): EntityId[] {
    const out: EntityId[] = [];
    for (let i = 0; i < this.count; i++) {
      if (this.alive[i] === 1) out.push(this.ids[i]!);
    }
    out.sort(compareId);
    return out;
  }

  forEachAlive(fn: (id: EntityId, slot: number) => void): void {
    const ids = this.idsSorted();
    for (const id of ids) {
      const slot = this.slot(id);
      if (slot !== undefined) fn(id, slot);
    }
  }

  projectAll(): ImmutableEntityView[] {
    return this.idsSorted().map((id) => this.view(id)!);
  }

  positionOf(id: EntityId): Vec3 | undefined {
    const i = this.slot(id);
    if (i === undefined) return undefined;
    return { x: this.px[i]!, y: this.py[i]!, z: this.pz[i]! };
  }

  ownerOf(id: EntityId): OwnerId | undefined {
    const i = this.slot(id);
    if (i === undefined) return undefined;
    return this.owner[i]! as OwnerId;
  }

  emptyViewDefaults(): { rot: Quat; scale: Vec3; vel: Vec3 } {
    return { rot: IDENTITY_QUAT, scale: UNIT_SCALE, vel: ZERO_VEC };
  }
}
