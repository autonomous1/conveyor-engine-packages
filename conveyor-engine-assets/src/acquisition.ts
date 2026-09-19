export type ByteSource = {
  bytes: Uint8Array;
  contentType?: string;
  uri: string;
};

export type AcquisitionContext = {
  uri: string;
  /** Temporary locator supplied by the app layer. Never treated as asset identity. */
  runtimeUrl?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export interface AcquisitionProvider {
  readonly id: string;
  accepts?(uri: string): boolean;
  acquire(ctx: AcquisitionContext): Promise<ByteSource>;
}

export class AcquisitionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AcquisitionError";
    this.code = code;
  }
}

export function composeProviders(providers: AcquisitionProvider[]): AcquisitionProvider {
  return {
    id: providers.map((p) => p.id).join("+") || "empty",
    async acquire(ctx) {
      let last: unknown;
      for (const p of providers) {
        if (p.accepts && !p.accepts(ctx.runtimeUrl ?? ctx.uri)) continue;
        try {
          return await p.acquire(ctx);
        } catch (err) {
          last = err;
        }
      }
      if (last instanceof Error) throw last;
      throw new AcquisitionError("provider", `no provider could acquire ${ctx.uri}`);
    },
  };
}
