import { compareTick, type EntityId } from "conveyor-engine-core";
import type { Quat, Sample, Vec3 } from "./types.js";

export class InterpolationBuffer {
  readonly delayMs: number;
  readonly maxSamples: number;
  readonly extraMs: number;
  private readonly buffers = new Map<EntityId, Sample[]>();
  extrapolations = 0;

  constructor(delayMs = 100, maxSamples = 16, extraMs = 80) {
    this.delayMs = delayMs;
    this.maxSamples = maxSamples;
    this.extraMs = extraMs;
  }

  push(id: EntityId, sample: Sample): void {
    let buf = this.buffers.get(id);
    if (!buf) {
      buf = [];
      this.buffers.set(id, buf);
    }
    buf.push(sample);
    buf.sort((a, b) => compareTick(a.tick, b.tick));
    if (buf.length > this.maxSamples) buf.splice(0, buf.length - this.maxSamples);
  }

  remove(id: EntityId): void {
    this.buffers.delete(id);
  }

  depth(id: EntityId): number {
    return this.buffers.get(id)?.length ?? 0;
  }

  sample(id: EntityId, now: number): { position: Vec3; rotation: Quat; scale: Vec3 } | undefined {
    const buf = this.buffers.get(id);
    if (!buf || buf.length === 0) return undefined;
    const target = now - this.delayMs;
    if (buf.length === 1) return this.holdOrExtra(buf[0]!, now);
    let i = 0;
    while (i < buf.length - 1 && buf[i + 1]!.receivedAt <= target) i++;
    const a = buf[i]!;
    const b = buf[Math.min(i + 1, buf.length - 1)]!;
    if (target < a.receivedAt) return copy(a);
    if (target >= b.receivedAt) return this.holdOrExtra(b, target);
    const t = (target - a.receivedAt) / Math.max(1, b.receivedAt - a.receivedAt);
    return {
      position: lerp(a.position, b.position, t),
      rotation: slerp(a.rotation, b.rotation, t),
      scale: lerp(a.scale, b.scale, t),
    };
  }

  private holdOrExtra(s: Sample, at: number): { position: Vec3; rotation: Quat; scale: Vec3 } {
    const age = at - s.receivedAt;
    if (age <= 0) return copy(s);
    if (age > this.extraMs) {
      return copy(s);
    }
    this.extrapolations++;
    const dt = age / 1000;
    return {
      position: {
        x: s.position.x + s.velocity.x * dt,
        y: s.position.y + s.velocity.y * dt,
        z: s.position.z + s.velocity.z * dt,
      },
      rotation: { ...s.rotation },
      scale: { ...s.scale },
    };
  }
}

function copy(s: Sample) {
  return {
    position: { ...s.position },
    rotation: { ...s.rotation },
    scale: { ...s.scale },
  };
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (dot > 0.9995) {
    return normalizeQ({
      x: a.x + (bx - a.x) * t,
      y: a.y + (by - a.y) * t,
      z: a.z + (bz - a.z) * t,
      w: a.w + (bw - a.w) * t,
    });
  }
  const th = Math.acos(Math.min(1, dot));
  const s = Math.sin(th);
  const w1 = Math.sin((1 - t) * th) / s;
  const w2 = Math.sin(t * th) / s;
  return {
    x: a.x * w1 + bx * w2,
    y: a.y * w1 + by * w2,
    z: a.z * w1 + bz * w2,
    w: a.w * w1 + bw * w2,
  };
}

function normalizeQ(q: Quat): Quat {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}
