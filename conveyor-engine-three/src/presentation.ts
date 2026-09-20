import type { EntityId } from "conveyor-engine-core";
import {
  RendererCache,
  rendererCacheKey,
  type BytesSource,
  type CacheEntry,
} from "./cache.js";
import type { ProxyObject, SceneAdapter } from "./types.js";

export type PresentationStatus = "idle" | "loading" | "ready" | "degraded" | "failed" | "disabled";

export type VisualWorldRequest = {
  assetId: string;
  contentHash: string;
  fallbackAssetId?: string;
};

export type EntityVisualRequest = {
  entity: EntityId;
  assetId?: string;
  contentHash?: string;
  fallbackAssetId?: string;
};

function makeObject(id: string, kind: string): ProxyObject {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    userData: { kind },
  };
}

/**
 * Client-local presentation runtime. Must never write world/replication state.
 */
export class PresentationRuntime {
  status: PresentationStatus = "idle";
  visualAssetId?: string;
  visualHash?: string;
  fallbackAssetId?: string;
  attachedWorld?: string;

  private worldEntry?: CacheEntry;
  private worldObject?: ProxyObject;
  private readonly bindings = new Map<EntityId, { object: ProxyObject; entry: CacheEntry }>();

  constructor(
    readonly scene: SceneAdapter,
    readonly cache: RendererCache,
    readonly source: BytesSource,
  ) {}

  async attachWorld(req: VisualWorldRequest): Promise<PresentationStatus> {
    this.detachWorld();
    this.status = "loading";
    this.visualAssetId = req.assetId;
    this.visualHash = req.contentHash;
    this.fallbackAssetId = req.fallbackAssetId;
    const primary = await this.#resolve(req.assetId, req.contentHash, false);
    if (primary?.state === "ready" && primary.template) {
      this.#attachWorldEntry(primary, false);
      this.status = "ready";
      return this.status;
    }
    if (req.fallbackAssetId) {
      this.cache.metrics.fallbackAttempts++;
      const fb = await this.#resolve(req.fallbackAssetId, `fallback:${req.fallbackAssetId}`, true);
      if (fb?.state === "ready" && fb.template) {
        this.cache.metrics.fallbackSuccesses++;
        this.#attachWorldEntry(fb, true);
        this.status = "degraded";
        return this.status;
      }
      this.cache.metrics.fallbackFailures++;
    }
    this.#attachDiagnostic();
    this.status = "failed";
    return this.status;
  }

  detachWorld(): void {
    if (this.worldObject) {
      this.scene.remove(this.worldObject);
      this.worldObject = undefined;
      this.cache.metrics.worldDetaches++;
    }
    if (this.worldEntry) {
      this.cache.releaseLease(this.worldEntry);
      this.worldEntry = undefined;
    }
    this.attachedWorld = undefined;
    this.status = "idle";
  }

  async bindEntity(req: EntityVisualRequest): Promise<ProxyObject> {
    const existing = this.bindings.get(req.entity);
    if (existing) return existing.object;
    const assetId = req.assetId ?? "primitive/box";
    const hash = req.contentHash ?? `primitive:${assetId}`;
    let entry = await this.#resolve(assetId, hash, false);
    if (!entry || entry.state !== "ready") {
      const fbId = req.fallbackAssetId ?? "primitive/box";
      this.cache.metrics.fallbackAttempts++;
      entry = await this.#resolve(fbId, `fallback:${fbId}`, true);
      if (entry?.state === "ready") this.cache.metrics.fallbackSuccesses++;
      else this.cache.metrics.fallbackFailures++;
    }
    if (!entry || entry.state !== "ready") {
      entry = this.cache.diagnostic();
    }
    this.cache.acquireLease(entry);
    this.cache.metrics.bindingCreates++;
    this.cache.metrics.clones++;
    const object = makeObject(`entity-${req.entity}`, entry.template?.kind ?? "primitive");
    object.userData.entityId = req.entity;
    object.userData.cacheKey = entry.key;
    this.scene.add(object);
    this.bindings.set(req.entity, { object, entry });
    return object;
  }

  releaseEntity(entity: EntityId): void {
    const b = this.bindings.get(entity);
    if (!b) return;
    this.scene.remove(b.object);
    this.cache.releaseLease(b.entry);
    this.bindings.delete(entity);
    this.cache.metrics.bindingReleases++;
  }

  binding(entity: EntityId): ProxyObject | undefined {
    return this.bindings.get(entity)?.object;
  }

  bindingCount(): number {
    return this.bindings.size;
  }

  unload(): void {
    for (const id of [...this.bindings.keys()]) this.releaseEntity(id);
    this.detachWorld();
    this.cache.disposeAll();
    this.status = "idle";
  }

  async switchWorld(req: VisualWorldRequest): Promise<PresentationStatus> {
    this.detachWorld();
    return this.attachWorld(req);
  }

  #attachWorldEntry(entry: CacheEntry, fallback: boolean): void {
    if (this.worldEntry) this.detachWorld();
    this.cache.acquireLease(entry);
    this.worldEntry = entry;
    const object = makeObject(`world-${entry.key}`, fallback ? "fallback" : "world");
    this.worldObject = object;
    this.scene.add(object);
    this.attachedWorld = entry.key;
    this.cache.metrics.worldAttaches++;
  }

  #attachDiagnostic(): void {
    const object = makeObject("world-diagnostic", "diagnostic");
    this.worldObject = object;
    this.scene.add(object);
    this.attachedWorld = "diagnostic";
    this.cache.metrics.worldAttaches++;
  }

  async #resolve(assetId: string, contentHash: string, fallback: boolean): Promise<CacheEntry | undefined> {
    const got = await this.source.acquire(assetId);
    if (!got.ok) {
      return {
        key: rendererCacheKey(assetId, contentHash),
        assetId,
        contentHash,
        state: "failed",
        leases: 0,
        error: got.error,
        fallback,
      };
    }
    const hash = got.contentHash || contentHash;
    const entry = await this.cache.load(assetId, hash, got.bytes);
    entry.fallback = fallback;
    return entry;
  }
}

export class MemoryBytesSource implements BytesSource {
  readonly blobs = new Map<string, { bytes: Uint8Array; contentHash: string }>();
  missing = new Set<string>();

  put(assetId: string, bytes: Uint8Array, contentHash: string): this {
    this.blobs.set(assetId, { bytes, contentHash });
    return this;
  }

  async acquire(assetId: string) {
    if (this.missing.has(assetId)) return { ok: false as const, error: `missing ${assetId}` };
    const rec = this.blobs.get(assetId);
    if (!rec) return { ok: false as const, error: `unknown ${assetId}` };
    return { ok: true as const, ...rec };
  }
}
