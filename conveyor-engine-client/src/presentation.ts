import type { RenderKey } from "./types.js";

export type PresentationRequest = {
  assetKey: string;
  descriptorId?: string;
};

export type PresentationBinding = {
  assetKey: string;
  state: "placeholder" | "ready" | "degraded" | "failed";
  shape: string;
  color?: number;
};

/**
 * Client-local presentation resolution. Ready events must not write
 * authoritative world or replication state.
 */
export class PresentationCatalog {
  private readonly bindings = new Map<string, PresentationBinding>();
  readonly readyKeys = new Set<string>();

  placeholder(key: RenderKey | undefined): PresentationBinding {
    const assetKey = key?.assetKey ?? key?.type ?? "unknown";
    const existing = this.bindings.get(assetKey);
    if (existing) return existing;
    const binding: PresentationBinding = {
      assetKey,
      state: key ? "placeholder" : "placeholder",
      shape: key?.shape ?? "box",
      color: key?.color,
    };
    this.bindings.set(assetKey, binding);
    return binding;
  }

  markReady(assetKey: string): PresentationBinding {
    const binding = this.bindings.get(assetKey) ?? {
      assetKey,
      state: "ready" as const,
      shape: "box",
    };
    binding.state = "ready";
    this.bindings.set(assetKey, binding);
    this.readyKeys.add(assetKey);
    return binding;
  }

  markDegraded(assetKey: string, shape = "box"): PresentationBinding {
    const binding = { assetKey, state: "degraded" as const, shape };
    this.bindings.set(assetKey, binding);
    return binding;
  }

  get(assetKey: string): PresentationBinding | undefined {
    return this.bindings.get(assetKey);
  }

  resolveRender(key: RenderKey | undefined): PresentationBinding {
    if (!key) return this.placeholder(undefined);
    const assetKey = key.assetKey ?? key.type;
    return this.bindings.get(assetKey) ?? this.placeholder(key);
  }
}
