import type { EntityId } from "conveyor-engine-core";
import { compareId } from "conveyor-engine-core";

export type SpatialCell = { cx: number; cz: number };

export class UniformGrid {
  readonly cellSize: number;
  private readonly cells = new Map<string, Set<EntityId>>();
  private readonly bounds = new Map<EntityId, { x: number; z: number; radius: number; key: string }>();

  constructor(cellSize = 16) {
    this.cellSize = cellSize;
  }

  private key(cx: number, cz: number): string {
    return `${cx}:${cz}`;
  }

  private cellOf(x: number, z: number): SpatialCell {
    return { cx: Math.floor(x / this.cellSize), cz: Math.floor(z / this.cellSize) };
  }

  register(id: EntityId, x: number, z: number, radius: number): void {
    this.remove(id);
    const { cx, cz } = this.cellOf(x, z);
    const key = this.key(cx, cz);
    let set = this.cells.get(key);
    if (!set) {
      set = new Set();
      this.cells.set(key, set);
    }
    set.add(id);
    this.bounds.set(id, { x, z, radius, key });
  }

  update(id: EntityId, x: number, z: number, radius: number): void {
    const prev = this.bounds.get(id);
    const { cx, cz } = this.cellOf(x, z);
    const key = this.key(cx, cz);
    if (prev && prev.key === key) {
      prev.x = x;
      prev.z = z;
      prev.radius = radius;
      return;
    }
    this.register(id, x, z, radius);
  }

  remove(id: EntityId): void {
    const prev = this.bounds.get(id);
    if (!prev) return;
    const set = this.cells.get(prev.key);
    if (set) {
      set.delete(id);
      if (set.size === 0) this.cells.delete(prev.key);
    }
    this.bounds.delete(id);
  }

  queryRadius(x: number, z: number, radius: number): EntityId[] {
    const minC = this.cellOf(x - radius, z - radius);
    const maxC = this.cellOf(x + radius, z + radius);
    const out: EntityId[] = [];
    const seen = new Set<EntityId>();
    for (let cz = minC.cz; cz <= maxC.cz; cz++) {
      for (let cx = minC.cx; cx <= maxC.cx; cx++) {
        const set = this.cells.get(this.key(cx, cz));
        if (!set) continue;
        for (const id of set) {
          if (seen.has(id)) continue;
          const b = this.bounds.get(id);
          if (!b) continue;
          const dx = b.x - x;
          const dz = b.z - z;
          const reach = radius + b.radius;
          if (dx * dx + dz * dz <= reach * reach) {
            seen.add(id);
            out.push(id);
          }
        }
      }
    }
    out.sort(compareId);
    return out;
  }

  queryBounds(id: EntityId): { x: number; z: number; radius: number } | undefined {
    const b = this.bounds.get(id);
    return b ? { x: b.x, z: b.z, radius: b.radius } : undefined;
  }

  occupancy(): number {
    return this.bounds.size;
  }

  debugCells(): Array<{ key: string; ids: EntityId[] }> {
    return [...this.cells.entries()]
      .map(([key, set]) => ({ key, ids: [...set].sort(compareId) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
}
