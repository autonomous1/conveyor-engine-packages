import { AcquisitionError, type AcquisitionContext, type AcquisitionProvider, type ByteSource } from "./acquisition.js";

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  url: string;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export type HttpProviderOptions = {
  allowHosts?: string[];
  fetch?: FetchLike;
  maxBytes?: number;
  defaultTimeoutMs?: number;
};

export class HttpAcquisitionProvider implements AcquisitionProvider {
  readonly id = "http";
  private readonly allowHosts: Set<string> | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly maxBytes: number;
  private readonly defaultTimeoutMs: number;

  constructor(opts: HttpProviderOptions = {}) {
    this.allowHosts = opts.allowHosts ? new Set(opts.allowHosts.map((h) => h.toLowerCase())) : undefined;
    this.fetchImpl = opts.fetch ?? defaultFetch;
    this.maxBytes = opts.maxBytes ?? 32 * 1024 * 1024;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
  }

  accepts(uri: string): boolean {
    return /^https?:\/\//i.test(uri);
  }

  async acquire(ctx: AcquisitionContext): Promise<ByteSource> {
    const locator = ctx.runtimeUrl ?? ctx.uri;
    if (!this.accepts(locator)) {
      throw new AcquisitionError("provider", `http provider cannot acquire ${locator}`);
    }
    let parsed: URL;
    try {
      parsed = new URL(locator);
    } catch {
      throw new AcquisitionError("provider", `invalid url ${locator}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new AcquisitionError("provider", "only http/https are allowed");
    }
    if (this.allowHosts && !this.allowHosts.has(parsed.hostname.toLowerCase())) {
      throw new AcquisitionError("policy", `host ${parsed.hostname} is not allowlisted`);
    }

    const timeoutMs = ctx.timeoutMs ?? this.defaultTimeoutMs;
    const signal = mergeAbort(ctx.signal, timeoutMs);
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(parsed.toString(), {
        method: "GET",
        headers: ctx.headers,
        signal,
      });
    } catch (err) {
      if (ctx.signal?.aborted) {
        throw new AcquisitionError("cancelled", `http acquire cancelled for ${ctx.uri}`);
      }
      if ((err as Error).name === "AbortError") {
        throw new AcquisitionError("timeout", `http acquire timed out for ${ctx.uri}`);
      }
      throw new AcquisitionError("provider", `http fetch failed: ${(err as Error).message}`);
    }
    if (!response.ok) {
      const code = response.status === 404 ? "not-found" : "provider";
      throw new AcquisitionError(code, `http ${response.status} for ${ctx.uri}`);
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > this.maxBytes) {
      throw new AcquisitionError("size-limit", `http Content-Length ${declared} exceeds maxBytes (${this.maxBytes})`);
    }
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > this.maxBytes) {
      throw new AcquisitionError("size-limit", `http body exceeds maxBytes (${this.maxBytes})`);
    }
    return {
      bytes: buf,
      uri: ctx.uri,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  }
}

function defaultFetch(input: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) {
  if (typeof fetch !== "function") {
    return Promise.reject(new AcquisitionError("provider", "global fetch is not available"));
  }
  return fetch(input, init);
}

function mergeAbort(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  if (timeoutMs <= 0) return signal;
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal;
}
