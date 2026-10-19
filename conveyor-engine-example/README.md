# conveyor-engine-example

> **Source:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)

The reference application for the Conveyor Engine stack. It wires every engine package into one runnable vertical slice:

- an authoritative world;
- input admission and per-client replication;
- the WebSocket protocol, over an in-memory pair or a real socket;
- predicted clients that project into a renderer-agnostic scene;
- static-world assets with presentation fallback.

It also includes deterministic network-fault runners built on `conveyor-graph-simulator`, a small benchmark, an arena replay recorder, a live WebSocket arena server, and a browser viewer.

This is a **private** package (`"private": true`). It is meant to be read and run inside the monorepo, not published.

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Dependencies](#dependencies)
- [Build, typecheck, and test](#build-typecheck-and-test)
- [Running](#running)
- [Core concepts](#core-concepts)
- [Module reference](#module-reference)
- [Usage examples](#usage-examples)
- [Configuration](#configuration)
- [Relationship to other packages](#relationship-to-other-packages)
- [Project layout](#project-layout)
- [License](#license)

---

## Features

- **`ExampleApp`**: in one process, an `AuthoritativeWorld`, an `InputGateway`, a `Replicator`, and an `EngineWsServer`, with any number of clients. Each client combines an `EngineWsClient` on a `memoryPair()`, an `EngineClient` predictor, and a `ThreeProjector` over a `memoryScene()`. No real socket, browser, or `three` is needed.
- **Open plane or arena**:
  - The default world is an open plane: pawns spawn at x = 0, 8, 16, and so on, and you can add crates.
  - `ExampleApp.arena()` loads the `example.arena.a2` static world: 48×48 bounds, two spawn points, and five AABB walls. The bundle id and authoritative hash are checked in the handshake.
- **Presentation fallback demo**: arena clients resolve the visual scene as `ready`, `missing`, `malformed`, or `skipped`. A miss degrades to `primitive/box` and never changes the server hash.
- **Network fault runners**: `lossless`, `lossy` (about 25% drop with latency and jitter), and `partition` (client 1 is cut off for ticks 1–4 and forced to resync at tick 5). They run deterministically through `SimulatedNetPath` from `conveyor-engine-replication`.
- **Benchmark**: `runBench` times world commit and replication publish across N entities and reports the total envelope bytes.
- **Arena replay recorder**: `recordArenaWander` drives seeded wandering pawns through a simulated 2-tick-latency link and writes JSONL snapshots to `viewer/replay/arena-wander.jsonl`.
- **Live arena**: `liveArena(port)` serves the arena over a real WebSocket via `listenHttp`, ticking at 20 Hz with seeded autonomous pawns. It writes a `live-meta-<port>.json` file for the viewer.
- **Browser viewer**: `viewer/index.html` loads `three@0.170.0` from unpkg, plus the engine packages from `/pkg/...`. It offers render-profile selection, GLB loading, arena, wall, slide, and bounds scenarios, wander, playback, a live WS client, and AABB debug and skinned-pawn toggles.

---

## Installation

| Field | Value |
| --- | --- |
| `name` | `conveyor-engine-example` |
| `version` | `0.0.1` |
| `private` | `true` |
| `type` | `module` (ESM only) |
| `exports["."]` | `./dist/index.js` (+ `.d.ts`) |
| `license` | `ISC` |

Clone the monorepo, then install and build the sibling packages so that the `file:` dependencies resolve to built `dist/` folders:

```bash
git clone https://github.com/autonomous1/conveyor-engine-packages
cd conveyor-engine-packages/conveyor-engine-example
npm install
npm run build
```

The `conveyor-graph` and `conveyor-graph-simulator` dependencies point to `../../conveyor-graph` and `../../conveyor-graph-simulator`. Those repositories must be checked out next to the `conveyor-engine-packages` folder.

---

## Dependencies

| Kind | Package | Used for |
| --- | --- | --- |
| dependency | `conveyor-engine-assets` | `file:../conveyor-engine-assets`: arena manifest, collision artifact, `encodeGlb`, `resolveStaticWorld`, `resolvePresentation`, `visualAssetFromManifest`, `FixtureRegistry` |
| dependency | `conveyor-engine-client` | `file:../conveyor-engine-client`: `EngineClient` predictor and the `IncomingSnapshot` type |
| dependency | `conveyor-engine-core` | `file:../conveyor-engine-core`: imported for types only (`ClientId`, `EntityId`, `Tick`) |
| dependency | `conveyor-engine-replication` | `file:../conveyor-engine-replication`: `InputGateway`, `Replicator`, `SnapshotEnvelope`, `SimulatedNetPath` |
| dependency | `conveyor-engine-three` | `file:../conveyor-engine-three`: `ThreeProjector`, `memoryScene`, `PresentationRuntime`, `RendererCache`, `MockTemplateParser`, `MemoryBytesSource` |
| dependency | `conveyor-engine-transport-ws` | `file:../conveyor-engine-transport-ws`: `EngineWsServer`, `EngineWsClient`, `memoryPair`, `listenHttp` |
| dependency | `conveyor-engine-world` | `file:../conveyor-engine-world`: `AuthoritativeWorld`, `applyStaticWorldDefinition` |
| dependency | `conveyor-graph` | `file:../../conveyor-graph`: no direct import in `src/`; needed by the simulator and world packages |
| dependency | `conveyor-graph-simulator` | `file:../../conveyor-graph-simulator`: `conveyor-graph-simulator/reference` (`defineScenario`, `run`, `LinkProfile`, `NetworkScheduler`, `SplitMix64`, `labelMix`) |
| devDependency | `typescript` | `^5.8.2` |
| devDependency | `@types/node` | `^22.10.0` |

Node built-ins used: `node:fs/promises`, `node:path`, and `node:url`, all in `arena-scenario.ts`.

---

## Build, typecheck, and test

```bash
npm run build       # rm -rf dist && tsc -p tsconfig.json
npm run typecheck   # tsc --noEmit
npm test            # node --experimental-strip-types --test test/*.test.ts
```

The `tsconfig.json` targets ES2022 with `module`/`moduleResolution` `Node16`, `strict`, declarations, `esModuleInterop`, `skipLibCheck`, and `types: ["node"]`, compiling `src/` to `dist/`.

Both test files import `../dist/index.js`, and they import `conveyor-engine-transport-ws` by package name. Before testing, build this package and make sure the dependencies are installed and built.

What the tests cover:

- **`test/example.test.ts`**:
  - the first snapshot is `full`, then `delta`;
  - relevance-radius spawn and despawn;
  - reconnect with a token forces a full snapshot;
  - identical runs produce identical canonical hashes;
  - metrics stay out of the canonical JSON;
  - the lossless runner is deterministic;
  - the bench report is sane.
- **`test/static-world.test.ts`**:
  - the arena fixture's content;
  - bundle identity and distinct spawns in the welcome;
  - a visual miss degrades without changing the server hash;
  - an authoritative hash mismatch is rejected with `AUTHORITATIVE_CONTENT_MISMATCH`, and a bundle id mismatch is also rejected;
  - a head-on wall stop at x = ±2.5;
  - axis slide;
  - bounds clamp;
  - spawn clearance.

---

## Running

All scripts run the compiled output, so run `npm run build` first.

| Script | Command | What it does |
| --- | --- | --- |
| `start` | `node dist/run.js` | Open plane, two clients and one crate at (3, 0), 8 ticks. Client A moves +X and client B moves −X. Prints diagnostics as JSON. |
| `start:arena` | `node dist/run.js arena` | Same, in the arena, with presentation `ready`. |
| `start:arena-wall` | `node dist/run.js arena 40` | Arena for 40 ticks. The pawns stop against the center wall (x = −2.5 / +2.5). |
| `start:arena-miss` | `node dist/run.js arena-miss` | Arena with the visual asset missing. Clients report `degraded` with the `primitive/box` fallback. |
| `run:lossless` | `node dist/run.js lossless` | Deterministic simulator runner with no faults. |
| `run:lossy` | `node dist/run.js lossy` | Runner with `dropPerU64 = 2^62` (about 25%), 1-tick latency, and 1-tick jitter. |
| `run:partition` | `node dist/run.js partition` | Runner where client 1 is partitioned for ticks 1–4 and resyncs at tick 5. |
| `bench` | `node dist/bench-cli.js [entities=200] [ticks=30]` | Prints a `BenchReport`. |
| `record:arena` | `node dist/arena-scenario.js [ticks=240]` | Writes `viewer/replay/arena-wander.jsonl`. |
| `live:arena` | `node dist/arena-scenario.js live [port=4174]` | Starts the live WS arena at `ws://127.0.0.1:<port>` and writes `viewer/replay/live-meta-<port>.json`. |
| `viewer` | `node viewer/serve.mjs` | Serves the browser viewer (see the note below). |

`run.js` reads its tick count from the second argument (default 8, minimum 1). The runner modes always use seed `11n` and 8 ticks, and print the delivery, send, and reject counts and the mirror sizes.

> **Viewer note.** `viewer/serve.mjs` and `viewer/viewer.mjs` were not available for review when this README was written, so their behavior is described only from `index.html`. The import map expects the engine packages to be served at `/pkg/three/`, `/pkg/client/`, `/pkg/core/`, and `/pkg/world/world.js`, and loads `three` and `three/addons/` from unpkg (0.170.0).

---

## Core concepts

### One tick of `ExampleApp.step(moves?)`

1. `tick += 1`, then `server.setTick(tick)`.
2. Entities whose inputs timed out (`gateway.drainTimeouts()`) get `world.clearInput(entity)`.
3. For each `(clientId, { moveX, moveZ })`, the client's predictor runs `collectInput`, and the WS client sends the input. The server admits it, and `onAdmit` calls `gateway.enqueueMovement(world, input)`.
4. `world.commit(tick)` returns a snapshot. `replicator.publish(world, snap)` produces one envelope per client, and `server.sendSnapshot(clientId, env)` sends each.
5. On the client, `onSnapshot` stores the envelope, calls `pred.applySnapshot(...)` and `three.apply(pred.renderSnapshot())`, and acks the sequence number.

Everything is synchronous over `memoryPair()`, so a single `step()` is fully deterministic.

### Connecting a client

`connectClient(scene?)` attaches a new memory pair to the server and sends `hello`.

- On `hello`, the server's `onHello` spawns a pawn. In the arena it uses `world.selectSpawn(clientId)`; on the open plane it places the pawn at x = 8·(clientId−1). The pawn is a capsule with radius 0.5.
- On `welcome`, the predictor connects to its pawn. The client's replicator interest radius is set to `radius`, and the welcome's bundle id and hash are accepted.
- In the arena, a `PresentationRuntime` attaches the visual world from an in-memory byte source. In `missing` and `malformed` modes that source marks the visual as missing.

### Arena static world

`arena-assets.ts` builds the whole arena in memory:

- **Collision artifact `ARENA_COLLISION`** (also mirrored in `viewer/arena.json`):
  - bounds of ±24 on X and Z, and −2..8 on Y;
  - spawn points `spawn-a` at (−10, 0) and `spawn-b` at (10, 0, yaw π);
  - five AABBs.
- **Manifest `arenaManifest()`** (bundle `example.arena.a2` v1, schema `static-world-v1`):
  - an `authoritative-static` collision scene;
  - a `presentation` visual scene: a tiny GLB from `encodeGlb` with fallback `primitive/box`;
  - a `diagnostic` `primitive/box`.
- **`arenaStaticWorld()`** resolves it with the `example-arena` profile and caches the result.

### Determinism

- Fault runners use `conveyor-graph-simulator`'s `deterministicFast` mode with a fixed seed.
- The recorder and live arena use `SplitMix64` streams derived with `labelMix(seed, "agent" | "stuck" | "network")`. The default seed is `20260917`.
- The tests check that identical runs produce identical `canonicalJson()` and per-tick hashes.

---

## Module reference

### `app.ts`

- `ExampleApp`:
  - **Fields:** `world`, `gateway`, `replicator`, `server`, `clients`, `tick`, `radius`, `bundleId?`, `authoritativeHash?`, and `presentationMode`.
  - **Methods:** `constructor(opts?)`, `static arena(opts?)`, `connectClient(scene?)`, `addCrate(x, z)`, `step(moves?)`, `disconnect(clientId)`, and `diagnostics()`.
- `ExampleClient`: `{ id, pawn, ws, pred, three, snapshots, presentation? }`.
- `ExampleDiagnostics`: tick, entity, client, input, and invalid-input counts, snapshot count, `hash` (`world.canonicalJson()`), bundle id, authoritative hash, spawn count, AABB count, and presentation status.

### `runners.ts`

- `RunnerName` is `"lossless" | "lossy" | "partition"`.
- `makeRunner(name, seed = 11n, ticks = 8)` returns `{ path, scenario }`. Pawns for owners 1 and 2 are created at tick 1. From tick 2 on, client 1 moves +X and client 2 moves +Z.
- `runNamed(name, seed?, ticks?)` returns a `RunnerResult`: `hashes`, `deliveries`, `sends`, `rejects`, `duplicateIgnored`, `mirrorCounts`, and `worldHash`.

### `bench.ts`, `bench-cli.ts`

- `runBench({ entities = 1000, ticks = 120 })` returns a `BenchReport`: `entities`, `ticks`, `clients`, `commitMs`, `publishMs`, `stepMs`, `envelopeBytes`, and `lastHashPrefix`.
- `commitMs` includes sending the inputs. `envelopeBytes` is the length of each envelope's JSON with bigints stringified.
- The CLI defaults are 200 entities and 30 ticks.

### `arena-assets.ts`

`ARENA_BUNDLE_ID`, `ARENA_BUNDLE_VERSION`, `ARENA_COLLISION`, `arenaVisualGlb()`, `arenaManifest()`, `arenaFixtures()` (a `FixtureRegistry` for `memory:collision`, `memory:visual`, and `memory:box`), and `arenaStaticWorld()`.

### `arena-scenario.ts` (not re-exported from `index.ts`)

- `recordArenaWander({ ticks = 240, seed = 20260917, outFile?, log? })`:
  - **Setup:** turns on actor separation, sets bounds and obstacles, spawns two "fox" pawns at the spawn points plus a "prey" pawn at (0, 8), and connects client 1 with interest radius 64.
  - **Each tick:** randomizes heading and gait (stop, walk, or run), unsticks blocked pawns, commits, and publishes through a `NetworkScheduler` with 2-tick latency.
  - **Output:** a header line followed by one JSON line per delivered snapshot.
  - **Returns:** `{ out, ticks, hash, bundleId, lines, droppedMissing }`. The `log` option is accepted but not used.
- `liveArena(port = 4174, { log? })`:
  - **Server:** builds the same world (two foxes plus one prey) and an `EngineWsServer` with the arena bundle. `onHello` gives each connecting client a pawn that is not already owned, and refuses when none is free.
  - **Socket:** `listenHttp(server, port)` binds 127.0.0.1.
  - **Tick loop:** every 50 ms it steps the autonomous pawns, commits, publishes, routes snapshots through a 2-tick-latency `NetworkScheduler`, and sends them with `server.sendSnapshot`. It logs on ticks 1–5 and every 40th tick.
  - **Inputs:** the server is created without `onAdmit`, so inputs from WS clients are not applied to the world. Pawns are driven by the server only.
  - **Returns:** the `listenHttp` handle, whose `close()` also stops the tick timer.
- When run directly: `live [port]` calls `liveArena`; otherwise the script records with the given tick count.

### `run.ts`

The CLI entry behind the `start*` and `run:*` scripts (see [Running](#running)).

### `index.ts`

Re-exports `app`, `runners`, `bench`, and `arena-assets`.

---

## Usage examples

### Two predicted clients on an open plane

```ts
import { ExampleApp } from "conveyor-engine-example";

const app = new ExampleApp({ radius: 16 });
const a = app.connectClient();
const b = app.connectClient();
app.addCrate(3, 0);

for (let i = 0; i < 10; i++) {
  app.step(new Map([[a.id, { moveX: 1, moveZ: 0 }], [b.id, { moveX: 0, moveZ: 1 }]]));
}
console.log(app.diagnostics());
console.log(a.snapshots.at(-1)?.kind, a.three.binding(a.pawn));
```

### Arena with a missing visual

```ts
const app = ExampleApp.arena({ presentation: "missing" });
const c = app.connectClient();
app.step();
console.log(c.pred.visualStatus, c.pred.visualFallbackAssetId); // "degraded", "primitive/box"
```

### Deterministic fault runner

```ts
import { runNamed } from "conveyor-engine-example";

const r = await runNamed("partition", 11n, 8);
console.log(r.deliveries, r.rejects, r.mirrorCounts, r.hashes.length);
```

### Live arena server

```ts
// arena-scenario.ts is not re-exported from the package root, so import it from dist
import { liveArena } from "./dist/arena-scenario.js";

const live = await liveArena(4174);
// connect an EngineWsClient (with bundleId "example.arena.a2" and the logged hash) to ws://127.0.0.1:4174
await live.close();
```

---

## Configuration

| Option | Where | Default | Effect |
| --- | --- | --- | --- |
| `radius` | `ExampleApp` options | `48` | Interest radius assigned to each client's replicator. |
| `worldVersion` | `ExampleApp` options | `"example-v1"` | World compatibility string, checked in the handshake. |
| `useArena` | `ExampleApp` options | `false` | Loads the arena static world (`ExampleApp.arena()` sets it). |
| `presentation` | `ExampleApp` options | `"skipped"` | One of `ready`, `missing`, `malformed`, `skipped`. `malformed` resolves as `decode-failed` but uses the same missing-bytes source as `missing`. |
| `seed`, `ticks` | `makeRunner` / `runNamed` | `11n`, `8` | Simulator seed and length. |
| `entities`, `ticks` | `runBench` | `1000`, `120` | Benchmark size. |
| `ticks`, `seed`, `outFile` | `recordArenaWander` | `240`, `20260917`, `viewer/replay/arena-wander.jsonl` | Recorder parameters. |
| `port` | `liveArena` | `4174` | Live server port (always bound to 127.0.0.1). |

Protocol version `1` is hard-coded on both server and client.

---

## Relationship to other packages

| Package | How the example uses it |
| --- | --- |
| `conveyor-engine-world` | The authoritative world: commits, static obstacles and bounds, spawn selection, actor separation, canonical JSON. |
| `conveyor-engine-replication` | `InputGateway` admission and timeouts, `Replicator` interest management and envelopes, and `SimulatedNetPath` for the fault runners. |
| `conveyor-engine-transport-ws` | `EngineWsServer` and `EngineWsClient` with handshake, compatibility and bundle checks, and reconnect tokens. Runs over `memoryPair()` in `ExampleApp` and over a real socket via `listenHttp` in `liveArena`. |
| `conveyor-engine-client` | `EngineClient` prediction, snapshot application, accepted world identity, and visual status. |
| `conveyor-engine-three` | `ThreeProjector` over `memoryScene()` (no `three` import) and `PresentationRuntime` with a mock template parser for visual-world attach and fallback. |
| `conveyor-engine-assets` | Arena manifest and collision, GLB encoding, static-world resolution, presentation resolution. |
| `conveyor-engine-core` | Shared id and tick types. |
| `conveyor-graph-simulator` | The `reference` entry: scenarios, deterministic runs, network scheduler, seeded RNG. |

---

## Project layout

```
conveyor-engine-example/
├── package.json, tsconfig.json, README.md
├── src/
│   ├── index.ts           # barrel: app, runners, bench, arena-assets
│   ├── app.ts             # ExampleApp
│   ├── arena-assets.ts    # arena manifest, collision, visual GLB, static world
│   ├── arena-scenario.ts  # recordArenaWander, liveArena (CLI: record:arena, live:arena)
│   ├── runners.ts         # lossless / lossy / partition simulator runners
│   ├── bench.ts           # runBench
│   ├── bench-cli.ts       # bench CLI
│   └── run.ts             # start / run:* CLI
├── test/
│   ├── example.test.ts
│   └── static-world.test.ts
└── viewer/
    ├── index.html         # viewer UI and import map
    ├── viewer.mjs         # viewer logic
    ├── serve.mjs          # static server (npm run viewer)
    ├── arena.json         # arena layout for the viewer
    └── replay/            # arena-wander.jsonl, live-meta*.json (generated)
```

---

## License

ISC. Copyright (c) 2026 autonomous1. See `LICENSE` at the root of the [repository](https://github.com/autonomous1/conveyor-engine-packages).

**Repository:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)
