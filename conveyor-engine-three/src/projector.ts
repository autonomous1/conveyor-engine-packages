import type { EntityId } from "conveyor-engine-core";
import type { RenderSnapshot } from "conveyor-engine-client";
import type { PrimitiveShape, ProxyObject, RenderBinding, SceneAdapter, ThreeMetrics } from "./types.js";

function makeProxy(entity: EntityId, shape: PrimitiveShape): ProxyObject {
  return {
    id: `proxy-${entity}`,
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    userData: { entityId: entity, shape },
  };
}

export class ThreeProjector {
  private readonly bindings = new Map<EntityId, RenderBinding>();
  private frame = 0;
  readonly metrics: ThreeMetrics = {
    frameTimeMs: 0,
    drawCalls: 0,
    visibleBindings: 0,
    primitiveCount: 0,
    creates: 0,
    destroys: 0,
    placeholders: 0,
    overlays: 0,
  };

  private readonly scene: SceneAdapter;
  constructor(scene: SceneAdapter = memoryScene()) {
    this.scene = scene;
  }

  apply(snap: RenderSnapshot): void {
    const t0 = Date.now();
    this.frame = snap.frame;
    const seen = new Set<EntityId>();
    for (const e of snap.entities) {
      seen.add(e.id);
      let b = this.bindings.get(e.id);
      const shape = (e.render?.shape as PrimitiveShape) ?? "box";
      if (!b) {
        const object = makeProxy(e.id, shape);
        this.scene.add(object);
        b = {
          entity: e.id,
          descriptor: e.render?.type ?? shape,
          object,
          shape,
          lastFrame: snap.frame,
          disposed: false,
        };
        this.bindings.set(e.id, b);
        this.metrics.creates++;
        if (!e.render) this.metrics.placeholders++;
      }
      b.lastFrame = snap.frame;
      b.object.position.x = e.position.x;
      b.object.position.y = e.position.y;
      b.object.position.z = e.position.z;
      b.object.quaternion.x = e.rotation.x;
      b.object.quaternion.y = e.rotation.y;
      b.object.quaternion.z = e.rotation.z;
      b.object.quaternion.w = e.rotation.w;
      b.object.scale.x = e.scale.x;
      b.object.scale.y = e.scale.y;
      b.object.scale.z = e.scale.z;
      b.object.visible = e.visible && e.lifecycle === "alive";
    }
    for (const [id, b] of [...this.bindings.entries()]) {
      if (!seen.has(id)) {
        this.scene.remove(b.object);
        b.disposed = true;
        this.bindings.delete(id);
        this.metrics.destroys++;
      }
    }
    this.metrics.visibleBindings = [...this.bindings.values()].filter((b) => b.object.visible).length;
    this.metrics.primitiveCount = this.bindings.size;
    this.metrics.drawCalls = this.metrics.visibleBindings;
    this.metrics.frameTimeMs = Date.now() - t0;
  }

  binding(id: EntityId): RenderBinding | undefined {
    return this.bindings.get(id);
  }

  disposeAll(): void {
    for (const b of this.bindings.values()) {
      this.scene.remove(b.object);
      b.disposed = true;
      this.metrics.destroys++;
    }
    this.bindings.clear();
  }
}

export function memoryScene(): SceneAdapter & { objects: ProxyObject[] } {
  const objects: ProxyObject[] = [];
  return {
    objects,
    add(obj) {
      objects.push(obj);
    },
    remove(obj) {
      const i = objects.indexOf(obj);
      if (i >= 0) objects.splice(i, 1);
    },
  };
}
