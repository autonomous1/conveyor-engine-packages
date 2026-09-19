import assert from "node:assert/strict";
import { test } from "node:test";
import { ThreeProjector, memoryScene } from "../dist/index.js";

test("bindings follow render snapshots and dispose on despawn", () => {
  const scene = memoryScene();
  const p = new ThreeProjector(scene);
  p.apply({
    frame: 1,
    serverTick: 1,
    snapshotSeq: 1,
    entities: [
      {
        id: 10,
        render: { type: "p", shape: "capsule" },
        position: { x: 1, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        scale: { x: 1, y: 1, z: 1 },
        visible: true,
        lifecycle: "alive",
        predicted: true,
      },
    ],
  });
  assert.equal(scene.objects.length, 1);
  assert.equal(p.binding(10)!.object.position.x, 1);
  p.apply({
    frame: 2,
    serverTick: 2,
    snapshotSeq: 2,
    entities: [],
  });
  assert.equal(scene.objects.length, 0);
  assert.equal(p.binding(10), undefined);
});
