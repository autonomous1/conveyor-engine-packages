import type { EntityId } from "conveyor-engine-core";
import type { AnimationDirective } from "conveyor-engine-client";
import { rendererCacheKey, type CacheEntry, type RendererCache } from "./cache.js";

export type SemanticClip = "idle" | "walk" | "run" | "action-primary";

export type MockMixer = {
  entity: EntityId;
  current: SemanticClip;
  playbackRate: number;
  actionEpoch: number;
  transitions: number;
  actionTriggers: number;
  staleIgnored: number;
  stopped: boolean;
  actionHold: number;
};

export type AnimationBinding = {
  entity: EntityId;
  cacheKey: string;
  mixer: MockMixer;
  lease: CacheEntry;
  driverState?: unknown;
};

export type AnimationDriver = {
  attach(binding: AnimationBinding, template: CacheEntry["template"]): void;
  play(binding: AnimationBinding, clip: SemanticClip, clipName: string): void;
  update?(binding: AnimationBinding, dt: number): void;
  detach?(binding: AnimationBinding): void;
};

export type AnimationMetrics = {
  mixers: number;
  transitions: number;
  actionTriggers: number;
  staleIgnored: number;
  clones: number;
  disposals: number;
};

/**
 * Headless animation director. Real Three mixers/SkeletonUtils stay behind A4.5.
 */
export class AnimationDirector {
  readonly metrics: AnimationMetrics = {
    mixers: 0,
    transitions: 0,
    actionTriggers: 0,
    staleIgnored: 0,
    clones: 0,
    disposals: 0,
  };
  private readonly bindings = new Map<EntityId, AnimationBinding>();
  constructor(
    readonly cache: RendererCache,
    readonly profile: Record<SemanticClip, string> = {
      idle: "Idle",
      walk: "Walk",
      run: "Run",
      "action-primary": "Attack",
    },
    readonly driver?: AnimationDriver,
  ) {}

  bind(entity: EntityId, entry: CacheEntry): AnimationBinding {
    const existing = this.bindings.get(entity);
    if (existing) return existing;
    this.cache.acquireLease(entry);
    const mixer: MockMixer = {
      entity,
      current: "idle",
      playbackRate: 1,
      actionEpoch: 0,
      transitions: 0,
      actionTriggers: 0,
      staleIgnored: 0,
      stopped: false,
      actionHold: 0,
    };
    const binding: AnimationBinding = {
      entity,
      cacheKey: entry.key,
      mixer,
      lease: entry,
    };
    this.bindings.set(entity, binding);
    this.metrics.mixers++;
    this.metrics.clones++;
    this.driver?.attach(binding, entry.template);
    return binding;
  }

  apply(entity: EntityId, directive: AnimationDirective): MockMixer | undefined {
    const b = this.bindings.get(entity);
    if (!b || b.mixer.stopped) return undefined;
    const next = directive.locomotion;
    if (b.mixer.actionHold > 0) b.mixer.actionHold -= 1;
    if (next !== b.mixer.current && directive.action === "none" && b.mixer.actionHold <= 0) {
      b.mixer.current = next;
      b.mixer.transitions++;
      this.metrics.transitions++;
      this.driver?.play(b, next, this.profile[next]);
    }
    b.mixer.playbackRate = clampRate(directive.speed);
    if (directive.action === "action-primary" && directive.actionEpoch > b.mixer.actionEpoch) {
      b.mixer.actionEpoch = directive.actionEpoch;
      b.mixer.actionTriggers++;
      this.metrics.actionTriggers++;
      b.mixer.current = "action-primary";
      b.mixer.actionHold = 12;
      this.driver?.play(b, "action-primary", this.profile["action-primary"]);
    } else if (directive.actionEpoch < b.mixer.actionEpoch) {
      b.mixer.staleIgnored++;
      this.metrics.staleIgnored++;
    }
    return b.mixer;
  }

  binding(entity: EntityId): AnimationBinding | undefined {
    return this.bindings.get(entity);
  }

  release(entity: EntityId): void {
    const b = this.bindings.get(entity);
    if (!b) return;
    b.mixer.stopped = true;
    this.driver?.detach?.(b);
    this.cache.releaseLease(b.lease);
    this.bindings.delete(entity);
    this.metrics.mixers = Math.max(0, this.metrics.mixers - 1);
    this.metrics.disposals++;
  }

  unload(): void {
    for (const id of [...this.bindings.keys()]) this.release(id);
  }

  cacheKeyFor(assetId: string, hash: string): string {
    return rendererCacheKey(assetId, hash);
  }

  tick(dt: number): void {
    if (!this.driver?.update) return;
    for (const b of this.bindings.values()) this.driver.update(b, dt);
  }
}

function clampRate(speed: number): number {
  if (speed <= 0.2) return 1;
  const raw = speed / 2;
  return Math.min(1.5, Math.max(0.5, raw));
}
