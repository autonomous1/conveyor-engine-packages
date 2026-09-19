export type CacheKey = string;

export function rendererCacheKey(assetId: string, contentHash: string): CacheKey {
  return `${assetId}@${contentHash}`;
}

export type TemplateKind = "glb-template" | "primitive" | "diagnostic";

export type ParsedTemplate = {
  templateId: string;
  kind: TemplateKind;
  assetId: string;
  contentHash: string;
  nodeNames?: string[];
  clipNames?: string[];
  /** Renderer-private payload (e.g. a loaded glTF scene). Never canonical. */
  runtime?: unknown;
};

export type TemplateParser = {
  parse(bytes: Uint8Array, assetId: string, contentHash: string): Promise<ParsedTemplate>;
};

export type BytesSource = {
  acquire(
    assetId: string,
  ): Promise<{ ok: true; bytes: Uint8Array; contentHash: string } | { ok: false; error: string }>;
};

export type CacheEntryState = "pending" | "ready" | "failed" | "disposed";

export type CacheEntry = {
  key: CacheKey;
  assetId: string;
  contentHash: string;
  state: CacheEntryState;
  leases: number;
  template?: ParsedTemplate;
  error?: string;
  fallback?: boolean;
};

export type RendererCacheMetrics = {
  requests: number;
  hits: number;
  misses: number;
  coalesced: number;
  successes: number;
  failures: number;
  fallbackAttempts: number;
  fallbackSuccesses: number;
  fallbackFailures: number;
  clones: number;
  worldAttaches: number;
  worldDetaches: number;
  bindingCreates: number;
  bindingReleases: number;
  disposals: number;
  activeLeases: number;
  entries: number;
};

export class RendererCache {
  readonly metrics: RendererCacheMetrics = {
    requests: 0,
    hits: 0,
    misses: 0,
    coalesced: 0,
    successes: 0,
    failures: 0,
    fallbackAttempts: 0,
    fallbackSuccesses: 0,
    fallbackFailures: 0,
    clones: 0,
    worldAttaches: 0,
    worldDetaches: 0,
    bindingCreates: 0,
    bindingReleases: 0,
    disposals: 0,
    activeLeases: 0,
    entries: 0,
  };

  private readonly entries = new Map<CacheKey, CacheEntry>();
  private readonly pending = new Map<CacheKey, Promise<CacheEntry>>();
  constructor(private readonly parser: TemplateParser) {}

  get(key: CacheKey): CacheEntry | undefined {
    return this.entries.get(key);
  }

  keys(): CacheKey[] {
    return [...this.entries.keys()].sort();
  }

  async load(assetId: string, contentHash: string, bytes: Uint8Array): Promise<CacheEntry> {
    const key = rendererCacheKey(assetId, contentHash);
    this.metrics.requests++;
    const existing = this.entries.get(key);
    if (existing && existing.state === "ready") {
      this.metrics.hits++;
      return existing;
    }
    const inflight = this.pending.get(key);
    if (inflight) {
      this.metrics.coalesced++;
      return inflight;
    }
    this.metrics.misses++;
    const work = this.#parse(key, assetId, contentHash, bytes);
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }

  acquireLease(entry: CacheEntry): void {
    if (entry.state === "disposed") throw new Error(`cache entry disposed: ${entry.key}`);
    entry.leases += 1;
    this.metrics.activeLeases += 1;
  }

  releaseLease(entry: CacheEntry): void {
    if (entry.leases <= 0) return;
    entry.leases -= 1;
    this.metrics.activeLeases = Math.max(0, this.metrics.activeLeases - 1);
    if (entry.leases === 0) this.disposeEntry(entry.key);
  }

  disposeEntry(key: CacheKey): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.state = "disposed";
    entry.template = undefined;
    this.entries.delete(key);
    this.metrics.disposals++;
    this.metrics.entries = this.entries.size;
  }

  disposeAll(): void {
    for (const key of [...this.entries.keys()]) this.disposeEntry(key);
    this.pending.clear();
    this.metrics.activeLeases = 0;
  }

  async #parse(key: CacheKey, assetId: string, contentHash: string, bytes: Uint8Array): Promise<CacheEntry> {
    const entry: CacheEntry = {
      key,
      assetId,
      contentHash,
      state: "pending",
      leases: 0,
    };
    this.entries.set(key, entry);
    this.metrics.entries = this.entries.size;
    try {
      entry.template = await this.parser.parse(bytes, assetId, contentHash);
      entry.state = "ready";
      this.metrics.successes++;
      return entry;
    } catch (err) {
      entry.state = "failed";
      entry.error = err instanceof Error ? err.message : String(err);
      this.metrics.failures++;
      return entry;
    }
  }
}

/** Headless parser: records identity only, never constructs Three objects. */
export class MockTemplateParser implements TemplateParser {
  failIds = new Set<string>();
  parseCount = 0;

  async parse(bytes: Uint8Array, assetId: string, contentHash: string): Promise<ParsedTemplate> {
    this.parseCount++;
    if (this.failIds.has(assetId)) throw new Error(`mock parse failed: ${assetId}`);
    return {
      templateId: rendererCacheKey(assetId, contentHash),
      kind: bytes.byteLength ? "glb-template" : "primitive",
      assetId,
      contentHash,
      nodeNames: ["root"],
    };
  }
}
