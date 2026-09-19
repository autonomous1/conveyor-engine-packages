import { collectAuthoritativeCompatibility } from "./schema.js";
import { AssetLoadError, type AssetHandle, type AssetRuntime, type RequestOptions } from "./loader.js";
import type {
  AdmissionRecord,
  AssetId,
  AssetRuntimeEvent,
  AuthoritativeCompatibility,
  EngineManifest,
} from "./types.js";

export class StaticAdmissionError extends Error {
  readonly missing: AssetId[];
  constructor(missing: AssetId[], message?: string) {
    super(message ?? `authoritative static assets not ready: ${missing.join(", ")}`);
    this.name = "StaticAdmissionError";
    this.missing = missing;
  }
}

export type StagedAdmission = {
  assetId: AssetId;
  handle?: AssetHandle;
  requestId: string;
  error?: AssetLoadError;
};

function isAdmittedClass(authority: string): boolean {
  return authority === "authoritative-admitted";
}

function isStaticAuth(authority: string): boolean {
  return authority === "authoritative" || authority === "authoritative-static";
}

/**
 * Off-tick staging + tick-boundary take. Does not mutate AuthoritativeWorld.
 */
export class AssetAdmissionQueue {
  private readonly staged = new Map<AssetId, StagedAdmission>();
  private readonly applied: AdmissionRecord[] = [];

  private readonly runtime: AssetRuntime;

  constructor(runtime: AssetRuntime) {
    this.runtime = runtime;
  }

  get manifest(): EngineManifest {
    return this.runtime.manifest;
  }

  /**
   * Load and pin every authoritative / authoritative-static asset. Fail closed.
   * Pins last for the session on purpose — call `runtime.unpin(id)` to evict.
   */
  async requireStaticReady(opts: RequestOptions = {}): Promise<AuthoritativeCompatibility> {
    const staticEntries = this.runtime.manifest.assets.filter((a) => isStaticAuth(a.authority));
    const missing: AssetId[] = [];
    for (const entry of staticEntries) {
      try {
        const handle = await this.runtime.request(entry.id, opts);
        this.runtime.pin(entry.id);
        handle.release();
      } catch {
        missing.push(entry.id);
      }
    }
    if (missing.length) throw new StaticAdmissionError(missing);
    return collectAuthoritativeCompatibility(this.runtime.manifest);
  }

  /** Resolve off the simulation tick. Presentation assets are rejected. */
  async stage(id: AssetId, opts: RequestOptions = {}): Promise<StagedAdmission> {
    const entry = this.runtime.getEntry(id);
    if (!entry) {
      const staged: StagedAdmission = {
        assetId: id,
        requestId: `missing-${id}`,
        error: new AssetLoadError("not-found", `unknown asset ${id}`, {
          requestId: `missing-${id}`,
          assetId: id,
          state: "failed",
          retryCount: 0,
          degraded: false,
          failureCode: "not-found",
        }),
      };
      this.staged.set(id, staged);
      this.runtime.metrics.admissionStagedCount += 1;
      this.emit({
        type: "admission-staged",
        record: {
          assetId: id,
          version: "0",
          contentHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
          authority: "authoritative-admitted",
          requestId: staged.requestId,
        },
      });
      return staged;
    }
    if (!isAdmittedClass(entry.authority)) {
      const staged: StagedAdmission = {
        assetId: id,
        requestId: `policy-${id}`,
        error: new AssetLoadError("policy", `${id} is ${entry.authority}, not authoritative-admitted`, {
          requestId: `policy-${id}`,
          assetId: id,
          version: entry.version,
          contentHash: entry.contentHash,
          state: "failed",
          retryCount: 0,
          degraded: false,
          failureCode: "policy",
        }),
      };
      this.staged.set(id, staged);
      this.runtime.metrics.admissionStagedCount += 1;
      this.emit({
        type: "admission-staged",
        record: {
          assetId: entry.id,
          version: entry.version,
          contentHash: entry.contentHash,
          authority: entry.authority,
          requestId: staged.requestId,
        },
      });
      return staged;
    }
    try {
      const handle = await this.runtime.request(id, opts);
      const staged: StagedAdmission = { assetId: id, handle, requestId: handle.requestId };
      this.staged.set(id, staged);
      this.runtime.metrics.admissionStagedCount += 1;
      this.emit({
        type: "admission-staged",
        record: {
          assetId: handle.assetId,
          version: handle.version,
          contentHash: handle.contentHash,
          authority: handle.entry.authority,
          requestId: handle.requestId,
        },
      });
      return staged;
    } catch (err) {
      const error = err instanceof AssetLoadError ? err : undefined;
      const staged: StagedAdmission = {
        assetId: id,
        requestId: error?.snapshot.requestId ?? `fail-${id}`,
        error: error ?? new AssetLoadError("provider", messageOf(err), {
          requestId: `fail-${id}`,
          assetId: id,
          state: "failed",
          retryCount: 0,
          degraded: false,
        }),
      };
      this.staged.set(id, staged);
      this.runtime.metrics.admissionStagedCount += 1;
      return staged;
    }
  }

  peek(): StagedAdmission[] {
    return [...this.staged.values()];
  }

  history(): AdmissionRecord[] {
    return [...this.applied];
  }

  /**
   * Admit or reject everything currently staged. Call only on a simulation tick boundary.
   * Records are the replay surface; the caller applies world effects separately.
   */
  takeAdmitted(tick: bigint, decide?: (staged: StagedAdmission) => AdmissionRecord["outcome"] | void): AdmissionRecord[] {
    const records: AdmissionRecord[] = [];
    const pending = [...this.staged.entries()];
    for (const [id, staged] of pending) {
      const entry = staged.handle?.entry ?? this.runtime.getEntry(id);
      const outcome = staged.error
        ? "rejected"
        : (decide?.(staged) ?? "accepted");
      const record: AdmissionRecord = {
        assetId: id,
        version: entry?.version ?? "0",
        contentHash: entry?.contentHash ?? "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        authority: entry?.authority ?? "authoritative-admitted",
        tick,
        outcome,
        requestId: staged.requestId,
        reason: staged.error?.message,
      };
      if (outcome === "accepted") this.runtime.metrics.admissionAcceptedCount += 1;
      else this.runtime.metrics.admissionRejectedCount += 1;
      if (outcome === "rejected") staged.handle?.release();
      else if (staged.handle) this.runtime.pin(id);
      records.push(record);
      this.applied.push(record);
      this.emit({ type: "admission-applied", record });
      this.staged.delete(id);
    }
    return records;
  }

  reject(id: AssetId, tick: bigint, reason?: string): AdmissionRecord | undefined {
    const staged = this.staged.get(id);
    if (!staged) return undefined;
    staged.handle?.release();
    const entry = staged.handle?.entry ?? this.runtime.getEntry(id);
    const record: AdmissionRecord = {
      assetId: id,
      version: entry?.version ?? "0",
      contentHash: entry?.contentHash ?? "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      authority: entry?.authority ?? "authoritative-admitted",
      tick,
      outcome: "rejected",
      requestId: staged.requestId,
      reason,
    };
    this.runtime.metrics.admissionRejectedCount += 1;
    this.applied.push(record);
    this.staged.delete(id);
    this.emit({ type: "admission-applied", record });
    return record;
  }

  private emit(event: AssetRuntimeEvent): void {
    this.runtime.emit(event);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
