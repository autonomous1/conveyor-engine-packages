# conveyor-engine-world

> **Source:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)

The authoritative, fixed-step world store for Conveyor Engine. It owns entity state in packed typed arrays, applies queued commands in a deterministic order once per tick, resolves static AABB collision and world bounds, keeps a uniform spatial grid, and produces frozen snapshots and canonical JSON for hashing and replay.

The package does not depend on transport, DOM, or renderer state. It builds on `conveyor-engine-core` (ids, ticks, the shared movement integrator) and `conveyor-engine-assets` (collision artifacts, static-world definitions, compatibility hashing). An optional binding to the `conveyor-graph-simulator` reference runtime is also included.

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

- **Packed storage**: `PackedWorldStore` keeps position, rotation, scale, velocity, radius, flags, category, owner, input sequence, and per-component versions in `Float64Array` / `Int32Array` columns. Destroys use swap-remove.
- **Commit window**: store mutation is only allowed between `beginCommit()` and `endCommit()`. Anything outside the window throws `CommitWindowError`.
- **Deterministic command ordering**: commands are sorted by kind priority, then enqueue order, then entity id, before they are applied.
- **Per-component versions**: transform, velocity, bounds, ownership, replication, and lifecycle versions are bumped only when a component changes. A no-op tick leaves them alone.
- **Shared movement**: `applyInput` runs `integratePlanarMove` from `conveyor-engine-core`, the same function the client predictor uses.
- **Static collision**: AABB obstacles are resolved by pushing the entity out along the smallest-overlap axis. Optional world bounds clamp positions, and optional circle-circle actor separation keeps pawns apart.
- **Spatial grid**: `UniformGrid` handles radius queries and returns results in sorted id order.
- **Snapshots and canonical state**: `snapshot()` is deeply frozen. `canonicalPlain()` and `canonicalJson()` omit `undefined` fields so hashing is stable.
- **Static worlds from assets**: `applyStaticWorldDefinition` and `loadAuthoritativeStaticWorld` set up bounds, obstacles, spawn points, and the bundle identity.
- **Animation intent**: helpers derive idle/walk/run from velocity, and the world can track per-entity action epochs.
- **Simulator binding**: `SimulatedWorld` defines `in` (admit) and `step` (sim) vertices on a `conveyor-graph` graph and proposes the canonical world on path `["world"]`.

---

## Installation

| Field | Value |
| --- | --- |
| `name` | `conveyor-engine-world` |
| `version` | `0.0.1` |
| `type` | `module` (ESM only) |
| `exports["."]` | `./dist/index.js` (+ `.d.ts`) |
| `exports["./simulator"]` | `./dist/simulator.js` (+ `.d.ts`) |
| `files` | `dist`, `src` |
| `license` | `ISC` |

Inside the monorepo, depend on it by path:

```json
"dependencies": { "conveyor-engine-world": "file:../conveyor-engine-world" }
```

`exports` points at `dist/`, so run `npm run build` before importing.

---

## Dependencies

From `package.json`:

| Kind | Package | Spec |
| --- | --- | --- |
| dependency | `conveyor-engine-core` | `file:../conveyor-engine-core` |
| dependency | `conveyor-engine-assets` | `file:../conveyor-engine-assets` |
| peerDependency | `conveyor-graph` | `>=0.1.0` |
| peerDependency | `conveyor-graph-simulator` | `>=0.0.1` |
| devDependency | `conveyor-graph` | `file:../../conveyor-graph` |
| devDependency | `conveyor-graph-simulator` | `file:../../conveyor-graph-simulator` |
| devDependency | `typescript` / `@types/node` | `^5.8.2` / `^22.10.0` |

`conveyor-graph` and `conveyor-graph-simulator` are siblings of this repository (`../../`). Build them first, as the repository README describes. `src/simulator.ts` only uses `import type` from them.

---

## Build, typecheck, and test

```bash
npm install
npm run build      # rm -rf dist && tsc -p tsconfig.json
npm run typecheck  # tsc --noEmit
npm test           # node --experimental-strip-types --test test/*.test.ts
```

Tests import `../dist/index.js`, so build first. They cover:

- `world.test.ts`: stable ids, frozen snapshots, owner queries, canonical JSON stability, deterministic `applyInput`, `CommitWindowError`, no-op ticks that don't bump versions, 1k-entity performance, AABB sliding, `clearInput`, and spatial removal on despawn.
- `static-world.test.ts`: building a world from a collision payload via `resolveStaticWorld` from `conveyor-engine-assets`, plus bounds clamping and canonical bundle identity.
- `animation.test.ts`: locomotion thresholds, and action epochs being omitted from canonical state until used.

---

## Core concepts

### Enqueue, then commit

Nothing changes when you call `enqueue()`. Commands accumulate until `commit(tick)`, which does the following:

1. Sets the current tick and resets the per-tick `created` / `destroyed` lists.
2. Sorts pending commands by **kind priority**, then **enqueue index**, then **entity id**:

   | Rank | Kind |
   | --- | --- |
   | 0 | `create` |
   | 1 | `setLifecycle` |
   | 2 | `setOwnership` |
   | 3 | `setBounds` |
   | 4 | `setReplication` |
   | 5 | `setVelocity` |
   | 6 | `applyInput` |
   | 7 | `clearInput` |
   | 8 | `setTransform` |
   | 9 | `event` |
   | 10 | `destroy` |

3. Opens the store's commit window, applies every command, resolves obstacles and bounds, runs actor separation if enabled, then closes the window.
4. Updates the spatial grid for every live entity, updates metrics, and returns `snapshot()`.

`createEntity()` allocates an id **immediately** (`store.allocateId()`) and enqueues a `create`. The entity only exists after the next commit.

### Versions

Every entity carries `transformVersion`, `velocityVersion`, `boundsVersion`, `ownershipVersion`, `replicationVersion`, and `lifecycleVersion`, all starting at `1`. Each setter bumps its own version **and** `replicationVersion`. `setInputSeq` bumps nothing. The store also keeps a global `worldGeneration` counter.

### Collision and bounds

- **Obstacles** (`StaticObstacle`, an X/Z AABB) are kept sorted by `id`. An entity overlapping an obstacle that has been expanded by its radius is pushed out along the axis with the smallest penetration, and its velocity on that axis is clamped so it can't keep moving into the box.
- **World bounds**, if set, clamp X/Z to `[min + r, max - r]` and zero the clamped velocity component.
- **Actor separation** (`world.actorSeparation`, off by default) pushes overlapping circles apart symmetrically, visiting pairs in sorted id order. `applyStaticWorldDefinition` turns it on.

### Determinism

- Iteration always goes over `idsSorted()`.
- Queries and grid results are sorted with `compareId`.
- Spawn selection depends on `clientId`, not on the wall clock.
- `canonicalPlain()` builds plain objects with no `undefined` keys, so `sha256CanonicalV1` and replay verification in `conveyor-graph-simulator` give stable results.
- `canonicalJson()` serialises `bigint` ticks as `"<n>n"`.

---

## Module reference

`src/index.ts` re-exports `types`, `store`, `spatial`, `world`, `assets`, `simulator`, `static-world`, and `animation`. The simulator binding is also available on its own at `conveyor-engine-world/simulator`.

### `types.ts`

| Export | Kind | Notes |
| --- | --- | --- |
| `Vec3`, `Quat` | type | `{x,y,z}`, `{x,y,z,w}` |
| `IDENTITY_QUAT`, `UNIT_SCALE`, `ZERO_VEC` | const | Defaults |
| `LifecycleState` | type | `"alive" \| "destroying" \| "destroyed"` |
| `RenderDescriptor` | type | `{ type; shape: "box"\|"sphere"\|"capsule"\|"plane"\|"line"\|"point"; material?; color?; dynamic?; visibility?; assetKey? }` |
| `WorldCommand` | type | Union of `create`, `destroy`, `setTransform`, `setVelocity`, `setBounds`, `setOwnership`, `setReplication`, `setLifecycle`, `applyInput`, `clearInput`, `event` |
| `StaticObstacle` | type | `{ id, minX, maxX, minZ, maxZ }` |
| `WorldBounds` | type | `{ minX, maxX, minY, maxY, minZ, maxZ }` |
| `WorldSpawnPoint` | type | `{ id: string, x, y, z, yaw }` |
| `MovementConfig` / `DEFAULT_MOVEMENT` | type / const | `{ maxSpeed: 8, accel: 40, damping: 8, dt: 1/20, gravity: 0 }` |
| `WorldMetrics` | type | Counters: entity, create, destroy, command, query, spatial-update, occupancy, commit duration |
| `EntityRecord` | type | Metadata-only view of an entity |
| `ImmutableEntityView` | type | Full projected entity, with optional `actionEpoch` / `action` |
| `WorldSnapshot` | type | `{ tick, worldVersion, entities, created, destroyed, bundleId?, authoritativeHash? }` |
| `CanonicalWorldState` | type | Snapshot without `created`/`destroyed` |
| `QueryFilter` | type | `{ owner?, lifecycle?, category?, sinceVersion?, required? }` |

`QueryFilter.required` is part of the type, but `AuthoritativeWorld.query()` currently ignores it.

### `world.ts`: `AuthoritativeWorld`

```ts
new AuthoritativeWorld(opts?: {
  worldVersion?: string;            // default "world-v1"
  cellSize?: number;                // spatial grid cell size, default 16
  movement?: Partial<MovementConfig>;
})
```

**Read-only members:** `store: PackedWorldStore`, `spatial: UniformGrid`, `worldVersion`, `movement`, `metrics`, `currentTick` (getter).

**Mutable fields:** `assetsCompatHash?`, `bundleId?`, `actorSeparation` (default `false`).

| Method | Description |
| --- | --- |
| `enqueue(cmd: WorldCommand)` | Queue a command for the next commit |
| `createEntity(tick = currentTick, render?, owner?) → EntityId` | Allocate an id and enqueue `create` |
| `clearInput(entity)` | Enqueue `clearInput`, which zeroes velocity |
| `commit(tick: Tick) → WorldSnapshot` | Apply queued commands (see above) |
| `exists(id)` | Whether the entity is alive in the store |
| `query(filter?) → ImmutableEntityView[]` | Filter by owner, lifecycle, category, `replicationVersion > sinceVersion` |
| `queryRadius(x, z, radius) → ImmutableEntityView[]` | Spatial-grid radius query |
| `snapshot()` / `canonical()` | Deeply frozen snapshot / canonical state |
| `canonicalPlain()` / `canonicalJson()` | Plain canonical value / JSON with bigint as `"<n>n"` |
| `addObstacle(o)` / `listObstacles()` | Static AABBs, normalised so min ≤ max, sorted by id |
| `setWorldBounds(b)` / `getWorldBounds()` | Optional clamp volume |
| `setBundleIdentity(bundleId, hash)` | Sets `bundleId` and `assetsCompatHash` |
| `setAssetCompatibilityHash(hash)` | Sets `assetsCompatHash` only |
| `addSpawnPoint(s)` / `listSpawnPoints()` | Spawn points, sorted by `id` |
| `selectSpawn(clientId)` | `spawnPoints[(clientId - 1) mod n]`, or an `"origin"` spawn at 0,0,0 if there are none |
| `nextSpawnRoundRobin()` | Cycles through spawn points |
| `triggerAction(entity, action = "action-primary") → number` | Increments and returns the entity's action epoch |
| `animationOf(entity)` | `{ actionEpoch, action? }` |

### `store.ts`: `PackedWorldStore`, `CommitWindowError`

New entities start at the origin with identity rotation, unit scale, zero velocity, `radius = 0.5`, all versions `1`, `owner = NO_OWNER` unless given, and `alive = 1`.

Every mutator below calls `assertCommit()` and returns `false` if the id is not alive:

- `create(id, tick, render?, owner?)` (throws if the id is already alive)
- `destroy(id)`
- `setTransform(id, p, r, s)`
- `setVelocity(id, v)`
- `setBounds(id, radius)`
- `setOwnership(id, owner)`
- `setReplication(id, flags, category)`
- `setLifecycle(id, render?)`
- `setInputSeq(id, seq)`
- `integrate(id, dt)` (position += velocity × dt)
- `applyMove(id, moveX, moveZ, yaw, cfg)` (uses `integratePlanarMove`, yaw-only rotation)

Read methods:

- `has`, `slot`, `view`, `viewAt`, `record`
- `idsSorted`, `forEachAlive`, `projectAll`
- `positionOf`, `ownerOf`
- `peekNextId`, `allocateId`
- `entityCount`, `worldGeneration`, `commitOpen`
- `emptyViewDefaults`

### `spatial.ts`: `UniformGrid`

`new UniformGrid(cellSize = 16)`. Entities are bucketed by `floor(x / cellSize):floor(z / cellSize)`.

Methods: `register`, `update` (only re-buckets when the cell changes), `remove`, `queryRadius(x, z, r)` (circle-circle test, sorted ids), `queryBounds(id)`, `occupancy()`, `debugCells()`.

### `assets.ts`

- `applyCollisionArtifact(world, artifact: CollisionArtifact): number` converts the artifact with `collisionToObstacles` from `conveyor-engine-assets`, adds each obstacle, and returns the count.
- `bindAuthoritativeCompatibility(world, compat): string` computes `hashCompatibility(compat)`, stores it on the world, and returns it.

### `static-world.ts`

- `applyStaticWorldDefinition(world, def: StaticWorldDefinition): string` hashes the definition (`hashStaticWorld`), sets the bundle identity, turns on `actorSeparation`, and applies bounds, AABBs, and spawn points. Returns the hash.
- `loadAuthoritativeStaticWorld(world, { manifest, collision, profile? })` calls `resolveStaticWorld` from `conveyor-engine-assets` and then applies the result. Returns `{ definition, hash }`. `profile` is `"minimal"` or `"example-arena"`.

### `animation.ts`

- `LocomotionState`: `"idle" | "walk" | "run"`.
- `AnimationIntent`: `{ locomotion, speed, action: "none" | "action-primary", actionEpoch, profileId? }`.
- `DEFAULT_LOCOMOTION`: `{ idle: 0.2, run: 4 }`.
- `planarSpeed(vx, vz)`: `Math.hypot(vx, vz)`.
- `deriveLocomotion(speed, thresholds?)`: `idle` if `speed <= idle`, `run` if `speed >= run`, otherwise `walk`.
- `intentFromVelocity(vx, vz, actionEpoch = 0, action = "none", profileId?)`: `action` is forced to `"none"` unless `actionEpoch > 0`.

### `simulator.ts`: `SimulatedWorld`

Binds the world to the `conveyor-graph-simulator` reference runtime (`RuntimeContext` from `conveyor-graph-simulator/reference`).

- `EngineAdmitPayload`: `{ type?, clientId?, seq?, moveX?, moveZ?, yaw?, buttons?, entity?, create?: { render?, owner? }, destroy?, validated? }`.
- `new SimulatedWorld(world = new AuthoritativeWorld())`. Fields: `world`, `lastSnapshot`, `owned: Map<clientId, EntityId>`.
- `buildAdmit(graph, ctx)` defines vertex `"in"`. Any payload that contains `position` is rejected with `ctx.fail(new Error("claimed-authority"))` and skipped, because clients may not claim authoritative state.
- `buildSim(graph, ctx)` defines vertex `"step"`. On each step it:
  1. Handles `create` and records the owner.
  2. Handles `destroy`.
  3. Maps input from `clientId` to the entity that client owns. If an `entity` field is given and doesn't match, the input is ignored as an ownership miss.
  4. Commits at `ctx.dueTick()`.
  5. Calls `ctx.propose({ vertexId: "step", path: ["world"], value: world.canonicalPlain() })`.
- `attachSimulatedWorld(world?)` is a factory shortcut.

---

## Usage examples

### Create, move, and snapshot

```ts
import { AuthoritativeWorld } from "conveyor-engine-world";

const ident = { x: 0, y: 0, z: 0, w: 1 };
const unit = { x: 1, y: 1, z: 1 };

const world = new AuthoritativeWorld({ worldVersion: "world-v1" });

const pawn = world.createEntity(0n, { type: "pawn", shape: "capsule" }, /* owner */ 1);
world.commit(0n); // pawn now exists

world.enqueue({ kind: "applyInput", entity: pawn, seq: 1, moveX: 1, moveZ: 0, yaw: 0 });
const snap = world.commit(1n);

snap.tick;            // 1n
Object.isFrozen(snap); // true
world.query({ owner: 1 }).map((e) => e.id); // [pawn]
```

### Obstacles, bounds, and radius queries

```ts
world.addObstacle({ id: 1, minX: 1, maxX: 3, minZ: -1, maxZ: 1 });
world.setWorldBounds({ minX: -10, maxX: 10, minY: 0, maxY: 4, minZ: -10, maxZ: 10 });

world.enqueue({ kind: "setTransform", entity: pawn, position: { x: 1, y: 0, z: 0 }, rotation: ident, scale: unit });
world.commit(2n); // pawn is pushed out of the box along the smallest-overlap axis

world.queryRadius(0, 0, 8); // ImmutableEntityView[] in id order
```

### Static world from assets

```ts
import { parseManifest } from "conveyor-engine-assets";
import { AuthoritativeWorld, loadAuthoritativeStaticWorld } from "conveyor-engine-world";

const world = new AuthoritativeWorld();
const { definition, hash } = loadAuthoritativeStaticWorld(world, {
  manifest: parseManifest(manifestJson),
  collision: collisionJson,      // CollisionArtifact-shaped payload
  profile: "example-arena",
});
world.selectSpawn(1); // deterministic spawn for client 1
```

### Canonical hashing

```ts
const json = world.canonicalJson(); // stable for identical state; ticks encoded as "<n>n"
```

---

## Configuration

| Option | Where | Default |
| --- | --- | --- |
| `worldVersion` | `AuthoritativeWorld` constructor | `"world-v1"` |
| `cellSize` | constructor | `16` |
| `movement` | constructor (merged over `DEFAULT_MOVEMENT`) | `maxSpeed 8, accel 40, damping 8, dt 1/20, gravity 0` |
| `actorSeparation` | world field | `false` (set to `true` by `applyStaticWorldDefinition`) |
| Locomotion thresholds | `deriveLocomotion` argument | `{ idle: 0.2, run: 4 }` |

`MovementConfig.gravity` is part of the type, but the world's movement path (`applyMove` → `integratePlanarMove`) only reads `maxSpeed`, `accel`, `damping`, and `dt`.

`tsconfig.json` is the same as the other engine packages: `ES2022`, `Node16` module resolution, `strict`, declarations, `src` → `dist`.

---

## Relationship to other packages

```
conveyor-engine-core ──┐
conveyor-engine-assets ┴─► conveyor-engine-world ──► conveyor-engine-replication
                                         ▲
                 conveyor-graph(-simulator) (peer, simulator binding)
```

- **Uses `conveyor-engine-core`** for `EntityId`, `Tick`, `OwnerId`, `NO_OWNER`, `compareId`, and `integratePlanarMove`.
- **Uses `conveyor-engine-assets`** for `collisionToObstacles`, `hashCompatibility`, `hashStaticWorld`, `resolveStaticWorld`, and the related types.
- **Used by `conveyor-engine-replication`**, which lists it as a dependency.
- **Used by `conveyor-engine-transport-ws`** as a dev dependency.
- **Used by `conveyor-engine-example`**.

---

## Project layout

```
conveyor-engine-world/
├── package.json, package-lock.json, tsconfig.json, README.md
├── src/
│   ├── index.ts          # barrel
│   ├── types.ts          # vectors, commands, views, snapshots, config
│   ├── store.ts          # PackedWorldStore, CommitWindowError
│   ├── world.ts          # AuthoritativeWorld
│   ├── spatial.ts        # UniformGrid
│   ├── assets.ts         # collision artifact / compatibility binding
│   ├── static-world.ts   # static world definition loading
│   ├── animation.ts      # locomotion + animation intent
│   └── simulator.ts      # SimulatedWorld (conveyor-graph-simulator binding)
└── test/
    ├── world.test.ts
    ├── static-world.test.ts
    └── animation.test.ts
```

---

## License

ISC. Copyright (c) 2026 autonomous1. See `LICENSE` at the root of the [repository](https://github.com/autonomous1/conveyor-engine-packages).

**Repository:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)
