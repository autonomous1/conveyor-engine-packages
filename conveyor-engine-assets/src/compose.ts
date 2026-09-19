import { collectAuthoritativeCompatibility } from "./schema.js";
import type { AssetRuntime, AssetHandle, RequestOptions } from "./loader.js";
import type { AssetAdmissionQueue } from "./admission.js";
import { collisionFromPayload } from "./collision.js";
import { sniffGlb, type GlbValidationReport } from "./glb.js";
import type {
  AssetEntry,
  AssetId,
  AssetMetrics,
  AssetSnapshot,
  AuthorityClass,
  LoadedPayload,
  RequestId,
} from "./types.js";

export type AssetWork = {
  assetId: AssetId;
  options?: RequestOptions;
  entry?: AssetEntry;
  handle?: AssetHandle;
  payload?: LoadedPayload;
  snapshot?: AssetSnapshot;
  glb?: GlbValidationReport;
  collision?: ReturnType<typeof collisionFromPayload>;
  error?: { code: string; message: string };
};

export type AssetStage = {
  id: string;
  handler: (work: AssetWork, signal?: AbortSignal) => AssetWork | Promise<AssetWork>;
};

export type AssetPipelineSinks = {
  onPresentationReady?: (work: AssetWork) => void;
  onAuthoritativeReady?: (work: AssetWork) => void;
  onAuthoritativeStaged?: (work: AssetWork) => void;
  onProvenance?: (work: AssetWork) => void;
  onMetrics?: (metrics: AssetMetrics) => void;
  onFailure?: (work: AssetWork) => void;
};

export type AssetPipelineOptions = {
  runtime: AssetRuntime;
  admission?: AssetAdmissionQueue;
  sinks?: AssetPipelineSinks;
  sniffGlb?: boolean;
};

/** Named stages compatible with conveyor-graph-compose SimpleStage / ConveyorStage.handler. */
export function createAssetStages(opts: AssetPipelineOptions): AssetStage[] {
  const { runtime, admission, sinks } = opts;
  const shouldSniff = opts.sniffGlb !== false;

  const resolveManifest: AssetStage = {
    id: "resolve-manifest",
    handler: (work) => {
      const entry = runtime.getEntry(work.assetId);
      if (!entry) {
        return {
          ...work,
          error: { code: "not-found", message: `unknown asset ${work.assetId}` },
        };
      }
      return { ...work, entry };
    },
  };

  const resolveDeps: AssetStage = {
    id: "resolve-deps",
    handler: async (work, signal) => {
      if (work.error || !work.entry) return work;
      for (const dep of work.entry.dependencies ?? []) {
        const child = runtime.getEntry(dep.id);
        if (!child) {
          return { ...work, error: { code: "dependency", message: `missing dependency ${dep.id}` } };
        }
        if (dep.version && child.version !== dep.version) {
          return { ...work, error: { code: "dependency", message: `dependency version mismatch ${dep.id}` } };
        }
      }
      void signal;
      return work;
    },
  };

  const acquireVerifyDecodeOwn: AssetStage = {
    id: "acquire-verify-decode-own",
    handler: async (work, signal) => {
      if (work.error || !work.entry) return work;
      try {
        const handle = await runtime.request(work.assetId, {
          ...work.options,
          signal: signal ?? work.options?.signal,
        });
        const next: AssetWork = {
          ...work,
          handle,
          payload: handle.payload,
          snapshot: handle.snapshot(),
        };
        if (shouldSniff && handle.payload?.kind === "bytes" && isVisual(work.entry.authority, work.entry.kind)) {
          try {
            next.glb = sniffGlb(handle.payload.bytes);
          } catch (err) {
            next.glb = {
              ok: false,
              support: "unsupported",
              jsonByteLength: 0,
              binByteLength: 0,
              sceneCount: 0,
              nodeCount: 0,
              meshCount: 0,
              primitiveCount: 0,
              materialCount: 0,
              textureCount: 0,
              imageCount: 0,
              bufferCount: 0,
              bufferViewCount: 0,
              accessorCount: 0,
              skinCount: 0,
              animationCount: 0,
              animationNames: [],
              jointCount: 0,
              extensionsUsed: [],
              extensionsRequired: [],
              unsupportedRequired: [],
              scenes: [],
              nodes: [],
              finiteTransforms: true,
              errors: [(err as Error).message],
              warnings: [],
            };
          }
        }
        if (handle.payload && work.entry.kind === "static-collision-scene") {
          try {
            next.collision = collisionFromPayload(handle.payload);
          } catch (err) {
            return { ...next, error: { code: "decode", message: (err as Error).message } };
          }
        }
        return next;
      } catch (err) {
        return {
          ...work,
          error: { code: codeOf(err), message: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  };

  const sink: AssetStage = {
    id: "sink",
    handler: async (work) => {
      sinks?.onMetrics?.(runtime.metrics);
      if (work.error) {
        sinks?.onFailure?.(work);
        return work;
      }
      if (work.entry?.provenance) sinks?.onProvenance?.(work);
      if (work.entry && isPresentation(work.entry.authority)) {
        sinks?.onPresentationReady?.(work);
      }
      if (work.entry && isStaticAuth(work.entry.authority)) {
        sinks?.onAuthoritativeReady?.(work);
      }
      if (admission && work.entry && work.entry.authority === "authoritative-admitted") {
        await admission.stage(work.assetId, work.options);
        sinks?.onAuthoritativeStaged?.(work);
      }
      return work;
    },
  };

  return [resolveManifest, resolveDeps, acquireVerifyDecodeOwn, sink];
}

export async function runAssetPipeline(
  stages: AssetStage[],
  work: AssetWork,
  signal?: AbortSignal,
): Promise<AssetWork> {
  let current = work;
  for (const stage of stages) {
    if (signal?.aborted) {
      return { ...current, error: { code: "cancelled", message: "pipeline aborted" } };
    }
    try {
      current = await stage.handler(current, signal);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "provider";
      return { ...current, error: { code, message: err instanceof Error ? err.message : String(err) } };
    }
  }
  return current;
}

export function loadThroughPipeline(opts: AssetPipelineOptions, assetId: AssetId, options?: RequestOptions) {
  return runAssetPipeline(createAssetStages(opts), { assetId, options }, options?.signal);
}

/** Stage list for `buildConveyorPipeline({ stages })` without importing compose. */
export function assetComposeStageSpecs(opts: AssetPipelineOptions): Array<{ id: string; handler: AssetStage["handler"] }> {
  return createAssetStages(opts).map((s) => ({ id: s.id, handler: s.handler }));
}

export function staticCompatibilityOf(runtime: AssetRuntime) {
  return collectAuthoritativeCompatibility(runtime.manifest);
}

function isPresentation(authority: AuthorityClass): boolean {
  return authority === "presentation" || authority === "presentation-required";
}

function isStaticAuth(authority: AuthorityClass): boolean {
  return authority === "authoritative" || authority === "authoritative-static";
}

function isVisual(authority: AuthorityClass, kind: string): boolean {
  return (
    isPresentation(authority) &&
    (kind === "static-visual-scene" || kind === "renderable-model" || kind === "skinned-character-model")
  );
}

function codeOf(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return (err as { code: string }).code;
  }
  return "provider";
}

export type { RequestId };
