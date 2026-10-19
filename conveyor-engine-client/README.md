# conveyor-engine-client

> **Source:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)

The client-side runtime for Conveyor Engine. It handles input history, client-side prediction with server reconciliation, interpolation and extrapolation of remote entities, presentation smoothing, animation directives, and frozen per-frame **render snapshots** that a renderer can consume.

Its only runtime dependency is `conveyor-engine-core`. It has **no Three.js, DOM, or transport dependency**, so you can run it headless in Node or inside any renderer.

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Dependencies](#dependencies)
- [Build, typecheck, and test](#build-typecheck-and-test)
- [Core concepts](#core-concepts)
- [Module reference](#module-reference)
- [Usage examples](#usage-examples)
- [Configuration](#configuration)
- [Relationship to other packages](#relationship-to-other-packages)
- [Project layout](#project-layout)
- [License](#license)

---

## Features

- **`EngineClient`**: one object per connected client. It holds authoritative state, input history, prediction, and metrics.
- **Prediction**: the owned entity is predicted locally with `integratePlanarMove` from `conveyor-engine-core`, the same integrator `conveyor-engine-world` uses on the server.
- **Reconciliation**: on each snapshot, acknowledged inputs are dropped and the unacked ones are replayed on top of the authoritative state.
- **Correction policy**: a large divergence (≥ `hardDistance`) snaps the presented state. Smaller ones are blended in over frames using `present.blend`.
- **Stale snapshot rejection**: a delta whose `seq` is not newer than the last one is counted and ignored.
- **Interpolation buffer**: per-entity samples are rendered `delayMs` in the past, with linear position/scale interpolation and quaternion slerp. A short, capped velocity extrapolation (`extraMs`) covers gaps.
- **Render snapshots**: frozen, id-sorted lists of entities with a position, rotation, scale, visibility, a `predicted` flag, and an animation directive.
- **Animation**: idle/walk/run from speed, plus one-shot actions driven by a monotonic `actionEpoch`.
- **Presentation catalog**: client-local asset binding states (`placeholder` / `ready` / `degraded` / `failed`) that never touch authoritative state.

---

## Installation

| Field | Value |
| --- | --- |
| `name` | `conveyor-engine-client` |
| `version` | `0.0.1` |
| `type` | `module` (ESM only) |
| `exports["."]` | `./dist/index.js` (+ `.d.ts`) |
| `files` | `dist`, `src` |
| `license` | `ISC` |

In the monorepo:

```json
"dependencies": { "conveyor-engine-client": "file:../conveyor-engine-client" }
```

Build with `npm run build` before importing, because `exports` points at `dist/`.

---

## Dependencies

| Kind | Package | Spec |
| --- | --- | --- |
| dependency | `conveyor-engine-core` | `file:../conveyor-engine-core` |
| devDependency | `typescript` | `^5.8.2` |
| devDependency | `@types/node` | `^22.10.0` |

---

## Build, typecheck, and test

```bash
npm install
npm run build      # rm -rf dist && tsc -p tsconfig.json
npm run typecheck
npm test           # node --experimental-strip-types --test test/*.test.ts
```

`test/client.test.ts` covers:

- prediction → ack → replay
- remote interpolation and frozen render snapshots
- rejecting stale or reordered snapshots
- single-sample extrapolation followed by hold
- soft-blend versus hard-snap correction

---

## Core concepts

### Data flow

```
collectInput() ──► InputCommand (send to server)        applySnapshot(IncomingSnapshot) ◄── server
      │                                                         │
      └─► predicted state (owned entity) ◄── reconcile(): replay unacked inputs over authoritative
                                                                │
                              InterpolationBuffer ◄── samples for every spawned/updated entity
                                                                │
                                            renderSnapshot(now) ──► RenderSnapshot (frozen)
```

### Input sequencing and acknowledgement

`collectInput({ moveX, moveZ, yaw, buttons })` gives each command the next `seq`, starting at `1`, and stores it in history. History is capped at `policy.maxHistory`. The command is applied to the predicted state right away.

When a snapshot arrives, `lastProcessedInput` moves `lastAck` forward and history keeps only commands with `seq > lastAck`.

### Snapshot handling

`applySnapshot(snap, receivedAt = Date.now())`:

1. Rejects a **delta** with `seq <= lastSnapSeq` and increments `metrics.staleSnapshots`. A `full` snapshot is always accepted.
2. On `full`, clears authoritative state and the interpolation buffers.
3. Applies `spawns` and `updates` by converting each `ViewWire` to a `ReplicatedEntity` and pushing an interpolation sample. Applies `despawns` by removing the entity and its buffer.
4. Updates acknowledgement, then reconciles the owned entity.

### Reconciliation and correction

The client replays the unacked history from the authoritative state of the owned entity, then measures the distance from the previous prediction.

- `metrics.correctionDistance` records that distance.
- `metrics.correctionCount` increments when the distance is greater than 0.
- `metrics.hardCorrections` increments when the distance is at least `policy.hardDistance`. In that case the presented state snaps to the new prediction.
- Otherwise `renderSnapshot()` moves the presented position toward the prediction by `present.blend` each frame.

`CorrectionPolicy.softDistance` is part of the policy type and its defaults, but `runtime.ts` does not read it. Only `hardDistance` and `maxHistory` change behaviour.

### Interpolation

`InterpolationBuffer` keeps up to `maxSamples` (16) samples per entity, sorted by tick. Sampling targets `now - delayMs` using the samples' `receivedAt` times.

- **Between two samples**: lerp position and scale, slerp rotation. Slerp takes the shortest path and falls back to normalised lerp when the dot product is above 0.9995.
- **Past the newest sample**: extrapolate along velocity for up to `extraMs`, then hold. Each extrapolation increments `extrapolations`.

### Owned entity versus remote entities

With `predictOwned: true` (the default), the owned entity is drawn from the presented/predicted state and gets `predicted: true`. With `predictOwned: false` (spectator or server-driven pawns), it is interpolated like any remote entity.

### Animation directives

`renderSnapshot()` gives every entity an `animation` field:

- `locomotion`: from `locomotionFromSpeed(planar speed)`, with thresholds idle ≤ 0.2 and run ≥ 4.
- `action`: `"action-primary"` only on the frame where a **new**, higher `actionEpoch` is first seen. This uses `shouldApplyActionEpoch`, so one-shot actions are not replayed.

---

## Module reference

`src/index.ts` re-exports `types`, `predict`, `interp`, `runtime`, `presentation`, and `animation`.

### `types.ts`

Re-exports the `ClientId`, `EntityId`, `InputSeq`, `SnapshotSeq`, and `Tick` types from core.

| Export | Description |
| --- | --- |
| `Vec3`, `Quat` | Vector / quaternion |
| `RenderKey` | `{ type, shape, color?, material?, assetKey? }` |
| `ReplicatedEntity` | Client copy of an authoritative entity (`version` = `replicationVersion`, `lifecycle: "alive" \| "despawned"`) |
| `InputCommand` | `{ seq, moveX, moveZ, yaw, buttons }` |
| `PredictedState` | `{ position, rotation, velocity }` |
| `Sample` | Interpolation sample: `{ tick, receivedAt, seq, position, rotation, scale, velocity }` |
| `AnimationDirective` | `{ locomotion, speed, action, actionEpoch }` |
| `RenderEntity` | `{ id, render?, position, rotation, scale, visible, lifecycle, predicted, color?, animation? }` |
| `RenderSnapshot` | `{ frame, serverTick, snapshotSeq, entities }` |
| `ClientMetrics` | `inputSendRate`, `lastAckInput`, `unacked`, `snapshotReceive`, `snapshotAge`, `interpDepth`, `extrapolations`, `correctionDistance`, `correctionCount`, `hardCorrections`, `resyncCount`, `staleSnapshots` |
| `CorrectionPolicy` / `DEFAULT_CORRECTION` | `{ softDistance: 0.25, hardDistance: 4, maxHistory: 64 }` |
| `PresentPolicy` / `DEFAULT_PRESENT` | `{ blend: 0.35 }` |
| `MovementParams` / `DEFAULT_CLIENT_MOVE` | `{ maxSpeed: 8, accel: 40, damping: 8, dt: 1/20 }` (matches the world's `DEFAULT_MOVEMENT`) |
| `ClientSession` | `{ clientId, connected }` |

### `runtime.ts`: `EngineClient`, `IncomingSnapshot`, `ViewWire`

```ts
type IncomingSnapshot = {
  kind: "full" | "delta";
  seq: number;
  tick: Tick;
  lastProcessedInput: InputSeq;
  spawns:   Array<{ entity: EntityId; view: ViewWire }>;
  updates:  Array<{ entity: EntityId; view: ViewWire }>;
  despawns: Array<{ entity: EntityId }>;
};

type ViewWire = {
  id; owner; position; rotation; scale; velocity; radius;
  replicationVersion; inputSeq;
  render?: { type; shape; color?; material?; assetKey? };
  actionEpoch?; action?;
};
```

```ts
new EngineClient(clientId: ClientId, opts?: {
  policy?: CorrectionPolicy;
  present?: PresentPolicy;
  move?: MovementParams;
  delayMs?: number;     // interpolation delay, default 100
  extraMs?: number;     // max extrapolation, default 80
  predictOwned?: boolean; // default true
})
```

| Member | Description |
| --- | --- |
| `connect(owned?, clientId?)` | Mark connected, set the owned entity, and reset seqs, history, prediction, and interpolation |
| `collectInput(partial) → InputCommand` | Assign `seq`, store in history, predict |
| `applySnapshot(snap, receivedAt?)` | Apply a full or delta snapshot (see above) |
| `renderSnapshot(now?) → RenderSnapshot` | Build a frozen frame |
| `authoritative(id)` | Last authoritative `ReplicatedEntity` |
| `acceptWorld(bundleId?, authoritativeHash?)` | Record the accepted world bundle identity |
| `setVisualStatus(state, { assetId?, fallbackAssetId? })` | Track visual loading state: `idle`, `loading`, `ready`, `degraded`, or `failed` |
| Fields | `clientId`, `ownedEntity`, `connected`, `acceptedBundleId`, `acceptedAuthoritativeHash`, `visualStatus`, `visualAssetId`, `visualFallbackAssetId`, `interp`, `predictOwned`, `policy`, `present`, `move`, `metrics` |

### `predict.ts`

- `applyMove(state, input, cfg = DEFAULT_CLIENT_MOVE): PredictedState` runs one integrator step. Rotation is yaw-only, and `y` position and `y` velocity are kept.
- `replay(base, inputs, cfg?)` applies `applyMove` to each input in order.
- `dist(a, b)` is the 3D Euclidean distance.

### `interp.ts`: `InterpolationBuffer`

`new InterpolationBuffer(delayMs = 100, maxSamples = 16, extraMs = 80)`.

Methods: `push(id, sample)`, `remove(id)`, `clear()`, `depth(id)`, `sample(id, now)`. The `extrapolations` counter is public.

### `presentation.ts`: `PresentationCatalog`

Client-local only. Per the source comment, ready events must not write authoritative world or replication state.

- `PresentationRequest`: `{ assetKey, descriptorId? }`.
- `PresentationBinding`: `{ assetKey, state, shape, color? }`.
- Methods:
  - `placeholder(key)`: keyed by `assetKey ?? type ?? "unknown"`.
  - `markReady(assetKey)`
  - `markDegraded(assetKey, shape = "box")`
  - `get(assetKey)`
  - `resolveRender(key)`
- `readyKeys: Set<string>` holds the keys marked ready.

### `animation.ts`

- `LocomotionState`: `"idle" | "walk" | "run"`.
- `locomotionFromSpeed(speed, idle = 0.2, run = 4)`.
- `shouldApplyActionEpoch(incoming, lastApplied)`: true when `incoming > lastApplied`.

---

## Usage examples

### Basic predict / reconcile / render loop

```ts
import { EngineClient, type IncomingSnapshot } from "conveyor-engine-client";

const client = new EngineClient(1);
client.connect(/* owned entity id from the server */ 10);

// Every input tick:
const cmd = client.collectInput({ moveX: 1, moveZ: 0, yaw: 0, buttons: 0 });
transport.send(cmd); // your transport

// When a snapshot arrives:
function onSnapshot(snap: IncomingSnapshot) {
  client.applySnapshot(snap, Date.now());
}

// Every render frame:
const frame = client.renderSnapshot(Date.now());
for (const e of frame.entities) {
  // e.position / e.rotation / e.scale / e.visible / e.predicted / e.animation
}
```

### Spectator (no prediction)

```ts
const spectator = new EngineClient(2, { predictOwned: false, delayMs: 150 });
```

### Tuning correction

```ts
const client = new EngineClient(1, {
  policy: { softDistance: 0.25, hardDistance: 2, maxHistory: 128 },
  present: { blend: 0.5 },
});
client.metrics.hardCorrections; // count of snaps
```

---

## Configuration

| Option | Default | Effect |
| --- | --- | --- |
| `policy.hardDistance` | `4` | Correction distance at or above which the presented state snaps |
| `policy.maxHistory` | `64` | Input history cap |
| `policy.softDistance` | `0.25` | Declared, but not read by the runtime |
| `present.blend` | `0.35` | Per-frame blend factor from presented toward predicted |
| `move` | `DEFAULT_CLIENT_MOVE` | Must match the server's movement config for prediction to agree |
| `delayMs` | `100` | Interpolation delay |
| `extraMs` | `80` | Max extrapolation window |
| `predictOwned` | `true` | Predict the owned entity, or interpolate it like a remote |

The interpolation buffer created by `EngineClient` uses a fixed `maxSamples` of 16.

---

## Relationship to other packages

- **Depends on `conveyor-engine-core`**: `integratePlanarMove` and `compareTick` at runtime, plus id and tick types.
- **Consumed by `conveyor-engine-three`**: it depends on this package and projects `RenderSnapshot` / `RenderEntity` into Three.js objects.
- **Fed by `conveyor-engine-replication`**: the `IncomingSnapshot` / `ViewWire` shape is what the client expects from replication, carried by `conveyor-engine-transport-ws` in live sessions.
- **Wired together in `conveyor-engine-example`**, which uses `acceptWorld` and `setVisualStatus`.

---

## Project layout

```
conveyor-engine-client/
├── package.json, package-lock.json, tsconfig.json, README.md
├── src/
│   ├── index.ts         # barrel
│   ├── types.ts         # shared client types and default policies
│   ├── runtime.ts       # EngineClient, IncomingSnapshot, ViewWire
│   ├── predict.ts       # applyMove, replay, dist
│   ├── interp.ts        # InterpolationBuffer
│   ├── presentation.ts  # PresentationCatalog
│   └── animation.ts     # locomotionFromSpeed, shouldApplyActionEpoch
└── test/
    └── client.test.ts
```

---

## License

ISC. Copyright (c) 2026 autonomous1. See `LICENSE` at the root of the [repository](https://github.com/autonomous1/conveyor-engine-packages).

**Repository:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)
