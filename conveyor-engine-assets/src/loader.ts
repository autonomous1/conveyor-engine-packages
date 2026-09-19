import { AcquisitionError, type AcquisitionProvider } from "./acquisition.js";
import { hashBytes } from "./hash.js";
import type {
  AssetEntry,
  AssetId,
  AssetLifecycleState,
  AssetMetrics,
  AssetRuntimeEvent,
  AssetSnapshot,
  ContentHash,
  EngineManifest,
  FailureCode,
  LoadedPayload,
  OwnershipScope,
  RequestId,
  RuntimeRole,
} from "./types.js";

let requestSeq = 0;
function nextRequestId(): RequestId {
  requestSeq += 1;
  return `req-${requestSeq}`;
}

const JSON_KINDS = new Set([
  "simulation-configuration",
  "rules-patch",
  "spawn-trigger-metadata",
  "material-descriptor",
  "render-descriptor",
  "world-manifest",
  "navigation-spatial",
  "static-collision-scene",
]);

export type AssetHandle = {
  readonly requestId: RequestId;
  readonly assetId: AssetId;
  readonly version: string;
  readonly contentHash: ContentHash;
  readonly state: AssetLifecycleState;
  readonly payload?: LoadedPayload;
  readonly entry: AssetEntry;
  readonly degraded: boolean;
  readonly failureCode?: FailureCode;
  readonly failureMessage?: string;
  readonly fallbackAssetId?: AssetId;
  readonly scope?: OwnershipScope;
  snapshot(): AssetSnapshot;
  release(): void;
};

export type RequestOptions = {
  signal?: AbortSignal;
  role?: RuntimeRole;
  allowFallback?: boolean;
  scope?: OwnershipScope;
  runtimeUrl?: string;
  headers?: Record<string, string>;
};

type CacheEntry = {
  entry: AssetEntry;
  payload: LoadedPayload;
  refs: number;
  pinned: boolean;
};

type Inflight = {
  promise: Promise<CacheEntry>;
};

export type AssetRuntimeOptions = {
  manifest: EngineManifest;
  provider: AcquisitionProvider;
  maxBytes?: number;
};

export class AssetLoadError extends Error {
  readonly code: FailureCode;
  readonly snapshot: AssetSnapshot;
  constructor(code: FailureCode, message: string, snapshot: AssetSnapshot) {
    super(message);
    this.name = "AssetLoadError";
    this.code = code;
    this.snapshot = snapshot;
  }
}

export class AssetRuntime {
  readonly manifest: EngineManifest;
  private readonly provider: AcquisitionProvider;
  private readonly byId = new Map<AssetId, AssetEntry>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Inflight>();
  private readonly maxBytes: number;
  readonly metrics: AssetMetrics = {
    requestCount: 0,
    coalescedRequestCount: 0,
    cacheHitCount: 0,
    cacheMissCount: 0,
    bytesAcquired: 0,
    readyCount: 0,
    degradedCount: 0,
    failureCount: 0,
    cancellationCount: 0,
    retryCount: 0,
    hashMismatchCount: 0,
    ownershipCount: 0,
    releaseCount: 0,
    disposalCount: 0,
    pinCount: 0,
    pinnedCount: 0,
    admissionStagedCount: 0,
    admissionAcceptedCount: 0,
    admissionRejectedCount: 0,
  };
  private readonly listeners = new Set<(event: AssetRuntimeEvent) => void>();
  private readonly liveHandles = new Set<AssetHandle>();
  private readonly pinnedIds = new Set<AssetId>();

  constructor(opts: AssetRuntimeOptions) {
    this.manifest = opts.manifest;
    this.provider = opts.provider;
    this.maxBytes = opts.maxBytes ?? 32 * 1024 * 1024;
    for (const entry of opts.manifest.assets) this.byId.set(entry.id, entry);
  }

  getEntry(id: AssetId): AssetEntry | undefined {
    return this.byId.get(id);
  }

  cacheSize(): number {
    return this.cache.size;
  }

  on(listener: (event: AssetRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AssetRuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  pin(id: AssetId): void {
    const already = this.pinnedIds.has(id);
    this.pinnedIds.add(id);
    for (const entry of this.cache.values()) {
      if (entry.entry.id === id) entry.pinned = true;
    }
    this.metrics.pinnedCount = this.pinnedIds.size;
    if (!already) {
      this.metrics.pinCount += 1;
      this.emit({ type: "pinned", assetId: id });
    }
  }

  unpin(id: AssetId): void {
    this.pinnedIds.delete(id);
    this.metrics.pinnedCount = this.pinnedIds.size;
    for (const [key, entry] of this.cache) {
      if (entry.entry.id === id) {
        entry.pinned = false;
        if (entry.refs <= 0) {
          this.cache.delete(key);
          this.metrics.disposalCount += 1;
          this.emit({ type: "disposed", assetId: id, version: entry.entry.version, contentHash: entry.entry.contentHash });
        }
      }
    }
    this.emit({ type: "unpinned", assetId: id });
  }

  async preload(ids: AssetId[], opts: RequestOptions = {}): Promise<{ handles: AssetHandle[]; release: () => void }> {
    const handles: AssetHandle[] = [];
    for (const id of ids) {
      const handle = await this.request(id, opts);
      this.pin(id);
      handles.push(handle);
    }
    return {
      handles,
      release: () => {
        for (const h of handles) h.release();
        for (const id of ids) this.unpin(id);
      },
    };
  }

  notifyRegionLoaded(regionId: string): void {
    this.emit({ type: "region-loaded", regionId });
  }

  notifyRegionUnloaded(regionId: string): void {
    this.emit({ type: "region-unloaded", regionId });
    this.releaseWhere((h) => h.scope?.regionId === regionId);
  }

  notifyClientDisconnected(clientId: number): void {
    this.emit({ type: "client-disconnected", clientId });
    this.releaseWhere((h) => h.scope?.clientId === clientId);
  }

  replaceResource(id: AssetId, nextHash?: ContentHash): void {
    let previousHash: ContentHash | undefined;
    for (const [key, entry] of this.cache) {
      if (entry.entry.id === id) {
        previousHash = entry.entry.contentHash;
        this.cache.delete(key);
        this.metrics.disposalCount += 1;
      }
    }
    this.emit({ type: "resource-replaced", assetId: id, previousHash, nextHash });
  }

  liveHandleCount(): number {
    return this.liveHandles.size;
  }

  private releaseWhere(pred: (handle: AssetHandle) => boolean): void {
    for (const handle of [...this.liveHandles]) {
      if (pred(handle)) handle.release();
    }
  }

  async request(id: AssetId, opts: RequestOptions = {}): Promise<AssetHandle> {
    this.metrics.requestCount += 1;
    const requestId = nextRequestId();
    const entry = this.byId.get(id);
    if (!entry) {
      this.metrics.failureCount += 1;
      const err = this.fail(requestId, id, "not-found", `unknown asset ${id}`, opts);
      this.emit({ type: "failed", snapshot: err.snapshot });
      throw err;
    }
    if (opts.signal?.aborted) {
      this.metrics.cancellationCount += 1;
      const err = this.fail(requestId, id, "cancelled", "aborted before start", opts, entry);
      this.emit({ type: "cancelled", snapshot: err.snapshot });
      throw err;
    }

    try {
      const cached = await this.acquireCached(entry, opts);
      this.metrics.readyCount += 1;
      const handle = this.makeHandle(requestId, cached.entry, cached.payload, "ready", opts, coalesceKey(cached.entry));
      this.emit({ type: "ready", snapshot: handle.snapshot() });
      return handle;
    } catch (err) {
      if (opts.signal?.aborted || isCancel(err)) {
        this.metrics.cancellationCount += 1;
        const fail = this.fail(requestId, id, "cancelled", messageOf(err), opts, entry);
        this.emit({ type: "cancelled", snapshot: fail.snapshot });
        throw fail;
      }
      const code = codeOf(err);
      if (code === "hash-mismatch") this.metrics.hashMismatchCount += 1;
      const allowFallback = opts.allowFallback !== false;
      if (allowFallback && entry.runtimePolicy?.fallbackAssetId && !isAuthoritative(entry) && code !== "cancelled") {
        try {
          const fbEntry = this.byId.get(entry.runtimePolicy.fallbackAssetId);
          const fb = await this.request(entry.runtimePolicy.fallbackAssetId, {
            ...opts,
            allowFallback: false,
            role: fbEntry?.runtimeRole ?? opts.role,
          });
          this.metrics.degradedCount += 1;
          const handle = this.makeHandle(requestId, entry, fb.payload!, "degraded", opts, coalesceKey(fb.entry), {
            degraded: true,
            fallbackAssetId: fb.assetId,
            failureCode: code,
            failureMessage: messageOf(err),
            releaseOverride: () => fb.release(),
          });
          this.emit({ type: "degraded", snapshot: handle.snapshot() });
          return handle;
        } catch {
          /* original failure */
        }
      }
      this.metrics.failureCount += 1;
      const fail = this.fail(requestId, id, code, messageOf(err), opts, entry);
      this.emit({ type: "failed", snapshot: fail.snapshot });
      throw fail;
    }
  }

  private async acquireCached(entry: AssetEntry, opts: RequestOptions): Promise<CacheEntry> {
    const key = coalesceKey(entry);
    const hit = this.cache.get(key);
    if (hit && entry.runtimePolicy?.cache !== "none") {
      this.metrics.cacheHitCount += 1;
      hit.refs += 1;
      return hit;
    }

    const existing = this.inflight.get(key);
    if (existing) {
      this.metrics.coalescedRequestCount += 1;
      const loaded = await existing.promise;
      if (opts.signal?.aborted) throw aborted();
      loaded.refs += 1;
      return loaded;
    }

    this.metrics.cacheMissCount += 1;
    const promise = this.loadBytes(entry, opts);
    this.inflight.set(key, { promise });
    try {
      const loaded = await promise;
      if (opts.signal?.aborted) {
        loaded.refs -= 1;
        if (loaded.refs <= 0) this.cache.delete(key);
        throw aborted();
      }
      return loaded;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async loadBytes(entry: AssetEntry, opts: RequestOptions): Promise<CacheEntry> {
    await this.ensureDependencies(entry, opts);
    if (opts.signal?.aborted) throw aborted();

    const source = await this.provider.acquire({
      uri: entry.runtimeUri,
      runtimeUrl: opts.runtimeUrl,
      headers: opts.headers,
      signal: opts.signal,
      timeoutMs: entry.runtimePolicy?.timeoutMs,
    });
    if (opts.signal?.aborted) throw aborted();

    if (source.bytes.byteLength > this.maxBytes) {
      throw Object.assign(new Error("size limit"), { code: "size-limit" as FailureCode });
    }
    this.metrics.bytesAcquired += source.bytes.byteLength;

    const actual = hashBytes(source.bytes);
    if (actual !== entry.contentHash) {
      throw Object.assign(new Error(`hash mismatch: expected ${entry.contentHash} got ${actual}`), {
        code: "hash-mismatch" as FailureCode,
      });
    }

    const payload = decodePayload(entry, source.bytes, source.contentType);
    const cached: CacheEntry = {
      entry,
      payload,
      refs: 1,
      pinned: this.pinnedIds.has(entry.id) || entry.runtimePolicy?.pin === true,
    };
    if (entry.runtimePolicy?.cache !== "none") this.cache.set(coalesceKey(entry), cached);
    return cached;
  }

  private async ensureDependencies(entry: AssetEntry, opts: RequestOptions): Promise<void> {
    for (const dep of entry.dependencies ?? []) {
      const child = this.byId.get(dep.id);
      if (!child) {
        throw Object.assign(new Error(`missing dependency ${dep.id}`), { code: "dependency" as FailureCode });
      }
      if (dep.version && child.version !== dep.version) {
        throw Object.assign(new Error(`dependency version mismatch ${dep.id}`), { code: "dependency" as FailureCode });
      }
      const handle = await this.request(dep.id, { ...opts, allowFallback: false });
      handle.release();
    }
  }

  private drop(key: string): void {
    const cached = this.cache.get(key);
    if (!cached) return;
    cached.refs -= 1;
    const pinned = cached.pinned || cached.entry.runtimePolicy?.pin || this.pinnedIds.has(cached.entry.id);
    if (cached.refs <= 0 && !pinned) {
      this.cache.delete(key);
      this.metrics.disposalCount += 1;
      this.emit({
        type: "disposed",
        assetId: cached.entry.id,
        version: cached.entry.version,
        contentHash: cached.entry.contentHash,
      });
    }
  }

  private makeHandle(
    requestId: RequestId,
    entry: AssetEntry,
    payload: LoadedPayload,
    state: AssetLifecycleState,
    opts: RequestOptions,
    cacheKey: string,
    extra: {
      degraded?: boolean;
      fallbackAssetId?: AssetId;
      failureCode?: FailureCode;
      failureMessage?: string;
      releaseOverride?: () => void;
    } = {},
  ): AssetHandle {
    let released = false;
    const degraded = extra.degraded ?? state === "degraded";
    const runtime = this;
    const handle: AssetHandle = {
      requestId,
      assetId: entry.id,
      version: entry.version,
      contentHash: entry.contentHash,
      state,
      payload,
      entry,
      degraded,
      failureCode: extra.failureCode,
      failureMessage: extra.failureMessage,
      fallbackAssetId: extra.fallbackAssetId,
      scope: opts.scope,
      snapshot: () => ({
        requestId,
        assetId: entry.id,
        version: entry.version,
        contentHash: entry.contentHash,
        state,
        role: opts.role ?? entry.runtimeRole,
        failureCode: extra.failureCode,
        failureMessage: extra.failureMessage,
        retryCount: 0,
        degraded,
        fallbackAssetId: extra.fallbackAssetId,
      }),
      release: () => {
        if (released) return;
        released = true;
        runtime.liveHandles.delete(handle);
        runtime.metrics.releaseCount += 1;
        runtime.metrics.ownershipCount = Math.max(0, runtime.metrics.ownershipCount - 1);
        runtime.emit({ type: "released", snapshot: handle.snapshot() });
        if (extra.releaseOverride) extra.releaseOverride();
        else runtime.drop(cacheKey);
      },
    };
    this.liveHandles.add(handle);
    this.metrics.ownershipCount += 1;
    return handle;
  }

  private fail(
    requestId: RequestId,
    assetId: AssetId,
    code: FailureCode,
    message: string,
    opts: RequestOptions,
    entry?: AssetEntry,
  ): AssetLoadError {
    return new AssetLoadError(code, message, {
      requestId,
      assetId,
      version: entry?.version,
      contentHash: entry?.contentHash,
      state: code === "cancelled" ? "cancelled" : "failed",
      role: opts.role ?? entry?.runtimeRole,
      failureCode: code,
      failureMessage: message,
      retryCount: 0,
      degraded: false,
    });
  }
}

function coalesceKey(entry: AssetEntry): string {
  return `${entry.id}@${entry.version}#${entry.contentHash}`;
}

function decodePayload(entry: AssetEntry, bytes: Uint8Array, contentType?: string): LoadedPayload {
  const asJson = contentType?.includes("json") || JSON_KINDS.has(entry.kind) || entry.runtimeUri.endsWith(".json");
  if (asJson) {
    try {
      return { kind: "json", value: JSON.parse(new TextDecoder().decode(bytes)) };
    } catch (err) {
      throw Object.assign(new Error(`decode failed: ${(err as Error).message}`), { code: "decode" as FailureCode });
    }
  }
  return { kind: "bytes", bytes };
}

function isAuthoritative(entry: AssetEntry): boolean {
  return (
    entry.authority === "authoritative" ||
    entry.authority === "authoritative-static" ||
    entry.authority === "authoritative-admitted"
  );
}

function isCancel(err: unknown): boolean {
  return err instanceof AcquisitionError && err.code === "cancelled";
}

function aborted(): AcquisitionError {
  return new AcquisitionError("cancelled", "aborted");
}

const FAILURE_CODES = new Set<FailureCode>([
  "not-found",
  "invalid-manifest",
  "missing-hash",
  "hash-mismatch",
  "dependency",
  "timeout",
  "cancelled",
  "decode",
  "policy",
  "unsupported",
  "provider",
  "stale",
  "size-limit",
]);

function codeOf(err: unknown): FailureCode {
  const raw = err instanceof AcquisitionError ? err.code : (err as { code?: string }).code;
  if (raw && FAILURE_CODES.has(raw as FailureCode)) return raw as FailureCode;
  return "provider";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
