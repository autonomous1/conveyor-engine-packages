import { AcquisitionError, type AcquisitionContext, type AcquisitionProvider, type ByteSource } from "./acquisition.js";

export type FixtureOutcome =
  | { type: "success"; bytes: Uint8Array; contentType?: string }
  | { type: "failure"; code: string; message: string }
  | { type: "cancel" };

export type FixtureScript = {
  delayMs?: number;
  bytes?: Uint8Array | string;
  contentType?: string;
  fail?: { code: string; message: string };
  cancel?: boolean;
  /** Wait out delay without aborting, then reject with `stale` if the caller already aborted. */
  completeAfterAbort?: boolean;
};

function toBytes(value: Uint8Array | string | undefined): Uint8Array {
  if (value === undefined) return new Uint8Array();
  if (typeof value === "string") return new TextEncoder().encode(value);
  return value;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AcquisitionError("cancelled", "fixture wait aborted"));
    };
    timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export class MemoryAcquisitionProvider implements AcquisitionProvider {
  readonly id = "memory";
  private readonly scripts = new Map<string, FixtureScript>();

  register(uri: string, script: FixtureScript | Uint8Array | string): this {
    const normalized: FixtureScript = script instanceof Uint8Array || typeof script === "string"
      ? { bytes: script }
      : script;
    this.scripts.set(uri, normalized);
    return this;
  }

  has(uri: string): boolean {
    return this.scripts.has(uri);
  }

  accepts(uri: string): boolean {
    return this.scripts.has(uri) || uri.startsWith("memory:");
  }

  async acquire(ctx: AcquisitionContext): Promise<ByteSource> {
    const script = this.scripts.get(ctx.uri);
    if (!script) {
      throw new AcquisitionError("not-found", `no fixture for ${ctx.uri}`);
    }

    const delay = script.delayMs ?? 0;
    const signal = ctx.signal;

    if (script.completeAfterAbort) {
      await wait(delay);
      if (signal?.aborted) {
        throw new AcquisitionError("stale", `stale completion for ${ctx.uri}`);
      }
    } else {
      await wait(delay, signal);
    }

    if (signal?.aborted && !script.completeAfterAbort) {
      throw new AcquisitionError("cancelled", `acquire cancelled for ${ctx.uri}`);
    }
    if (script.cancel) {
      throw new AcquisitionError("cancelled", `fixture cancelled ${ctx.uri}`);
    }
    if (script.fail) {
      throw new AcquisitionError(script.fail.code, script.fail.message);
    }
    return {
      bytes: toBytes(script.bytes),
      contentType: script.contentType,
      uri: ctx.uri,
    };
  }
}

export class FixtureRegistry {
  readonly provider = new MemoryAcquisitionProvider();

  put(uri: string, script: FixtureScript | Uint8Array | string): this {
    this.provider.register(uri, script);
    return this;
  }

  success(uri: string, bytes: Uint8Array | string, extra: Omit<FixtureScript, "bytes" | "fail" | "cancel"> = {}): this {
    return this.put(uri, { ...extra, bytes });
  }

  fail(uri: string, code: string, message: string, extra: Pick<FixtureScript, "delayMs"> = {}): this {
    return this.put(uri, { ...extra, fail: { code, message } });
  }

  delay(uri: string, bytes: Uint8Array | string, delayMs: number): this {
    return this.put(uri, { bytes, delayMs });
  }
}
