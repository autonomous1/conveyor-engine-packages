import type { EntityId } from "conveyor-engine-core";
import type { ImmutableEntityView } from "conveyor-engine-world";
import type { SnapshotEnvelope } from "./types.js";

export type MirrorEntity = ImmutableEntityView & { present: boolean };

/**
 * Headless reconstruction of a client's relevant world from envelopes.
 * Spawn must precede update. Stale versions and despawns after a newer spawn are ignored.
 */
export class ClientMirror {
  readonly entities = new Map<EntityId, MirrorEntity>();
  lastSeq = 0;
  applied = 0;
  ignored = 0;

  apply(env: SnapshotEnvelope): void {
    if (this.lastSeq !== 0 && env.seq <= this.lastSeq) {
      this.ignored++;
      return;
    }
    if (env.kind === "full") this.entities.clear();
    for (const spawn of env.spawns) {
      const cur = this.entities.get(spawn.entity);
      if (cur && cur.replicationVersion > spawn.view.replicationVersion) {
        this.ignored++;
        continue;
      }
      this.entities.set(spawn.entity, { ...cloneView(spawn.view), present: true });
      this.applied++;
    }
    for (const update of env.updates) {
      const cur = this.entities.get(update.entity);
      if (!cur || !cur.present) {
        this.ignored++;
        continue;
      }
      if (update.version <= cur.replicationVersion) {
        this.ignored++;
        continue;
      }
      this.entities.set(update.entity, { ...cloneView(update.view), present: true });
      this.applied++;
    }
    for (const despawn of env.despawns) {
      const cur = this.entities.get(despawn.entity);
      if (!cur || !cur.present) {
        this.ignored++;
        continue;
      }
      if (despawn.tick < cur.spawnTick) {
        this.ignored++;
        continue;
      }
      cur.present = false;
      this.entities.delete(despawn.entity);
      this.applied++;
    }
    if (env.seq > this.lastSeq) this.lastSeq = env.seq;
  }

  ids(): EntityId[] {
    return [...this.entities.keys()].sort((a, b) => a - b);
  }

  view(id: EntityId): MirrorEntity | undefined {
    return this.entities.get(id);
  }
}

function cloneView(v: ImmutableEntityView): ImmutableEntityView {
  return {
    ...v,
    position: { ...v.position },
    rotation: { ...v.rotation },
    scale: { ...v.scale },
    velocity: { ...v.velocity },
    render: v.render ? { ...v.render } : undefined,
  };
}
