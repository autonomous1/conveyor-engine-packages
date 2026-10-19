# conveyor-engine-replication

> **Source:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)

Server-side replication for Conveyor Engine. Every tick it takes an authoritative `WorldSnapshot` from `conveyor-engine-world` and produces one **snapshot envelope per client**: full or delta, with spawns, updates, and despawns chosen by interest radius and priority, plus the input acknowledgement. It also contains the **input ingress gateway**, which validates, rate-limits, sequences, and checks ownership of client input. A headless `ClientMirror` rebuilds a client's view from envelopes, and there are bindings for the `conveyor-graph-simulator` reference runtime, including a simulated lossy network path.

The package does not use browser APIs.

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

- **`Replicator`**: per-client state covering known entity versions, interest radius and focus, pending despawns, full/delta sequencing, ack tracking, and resync requests.
- **Relevance**: an entity is relevant to a client if it is within the client's interest radius (via `world.queryRadius`), is "always relevant" (`category === 1` or `flags & 1`), or is the client's owned entity.
- **Priority**: owned first, then always-relevant, then the rest; ties go by distance from focus, then by id. Each envelope is capped at `budget.maxEntities` records.
- **Despawns** carry a reason: `"destroyed"` or `"relevance-leave"`.
- **Input validation**: `validateInput` rejects oversized payloads, bad client ids, claimed authority (`position` / `velocity`), bad, duplicate, old, or too-far-future sequences, and non-finite values. It clamps move axes to `[-maxAbsMove, maxAbsMove]`.
- **`InputGateway`**: session table, per-tick rate limit, ownership enforcement, input timeouts (with a drain list for `clearInput`), and metrics.
- **`ClientMirror`**: headless reconstruction of the world from envelopes. It drops stale envelopes and versions, ignores updates for entities it hasn't seen spawn, and ignores despawns that predate the spawn.
- **Simulator bindings**: `SimulatedReplication` (publish phase) and `SimulatedNetPath` (admit → sim → network send/deliver through `NetworkScheduler`).

---

## Installation

| Field | Value |
| --- | --- |
| `name` | `conveyor-engine-replication` |
| `version` | `0.0.1` |
| `type` | `module` (ESM only) |
| `exports["."]` | `./dist/index.js` (+ `.d.ts`) |
| `exports["./simulator"]` | `./dist/simulator.js` (+ `.d.ts`) |
| `files` | `dist`, `src` |
| `license` | `ISC` |

```json
"dependencies": { "conveyor-engine-replication": "file:../conveyor-engine-replication" }
```

Build before importing, because `exports` points at `dist/`.

---

## Dependencies

| Kind | Package | Spec |
| --- | --- | --- |
| dependency | `conveyor-engine-core` | `file:../conveyor-engine-core` |
| dependency | `conveyor-engine-world` | `file:../conveyor-engine-world` |
| peerDependency | `conveyor-graph` | `>=0.1.0` |
| peerDependency | `conveyor-graph-simulator` | `>=0.0.1` |
| devDependency | `conveyor-graph`, `conveyor-graph-simulator` | `file:../../conveyor-graph`, `file:../../conveyor-graph-simulator` |
| devDependency | `typescript`, `@types/node` | `^5.8.2`, `^22.10.0` |

At runtime the package uses:

- from `conveyor-engine-core`: `PROTOCOL_VERSION`, `compareId`, `ErrorCategory`, and the validators;
- from `conveyor-engine-world`: `SimulatedWorld`, used by `SimulatedNetPath`.

Its imports from `conveyor-graph` and `conveyor-graph-simulator/reference` are type-only in `src/`, but the network tests import `defineScenario` and `run` from the simulator at runtime.

---

## Build, typecheck, and test

```bash
npm install
npm run build
npm run typecheck
npm test   # node --experimental-strip-types --test test/*.test.ts
```

Build `conveyor-graph`, `conveyor-graph-simulator`, `conveyor-engine-core`, `conveyor-engine-assets`, and `conveyor-engine-world` first.

| Test file | What it covers |
| --- | --- |
| `replication.test.ts` | Full then delta, relevance include/exclude, basic `validateInput` |
| `e4-replication.test.ts` | Distinct per-client relevance, spawn then despawn when relevance changes, mirror reconstruction |
| `e5-ingress.test.ts` | Owned-only movement, `not-owner`, duplicates, future/NaN/Infinity/oversized/rate-limit rejection, disconnect |
| `n1-network.test.ts` | Two-client `SimulatedNetPath` scenarios over `conveyor-graph-simulator` (lossless / lossy / partition), with deterministic hashes across runs |

---

## Core concepts

### Per-tick server loop

```
raw client input ──► InputGateway.admit(raw, tick) ──► enqueueMovement(world, input)
                                         │
                       drainTimeouts() ──┴─► world.clearInput(entity)
world.commit(tick) ──► WorldSnapshot ──► Replicator.publish(world, snap) ──► Map<clientId, SnapshotEnvelope>
```

### Envelopes

```ts
type SnapshotEnvelope = {
  kind: "full" | "delta";
  seq: SnapshotSeq;          // per-client, starts at 1
  tick: Tick;
  baseline: SnapshotSeq;     // 0 for full, else client's lastAckSeq
  lastProcessedInput: InputSeq;
  worldVersion: string;
  protocol: number;          // PROTOCOL_VERSION from core
  assetsCompatHash?: string; // only when set on the Replicator
  spawns:   SpawnRecord[];   // { entity, tick, view }
  updates:  UpdateRecord[];  // { entity, tick, version, view }
  despawns: DespawnRecord[]; // { entity, tick, reason }
};
```

A client's first envelope, and every envelope after `requestResync(clientId)`, is `full`: every relevant entity goes out as a spawn. After that, envelopes are `delta`:

- an entity not yet known to the client is a **spawn**;
- an entity whose `replicationVersion` has increased is an **update**;
- skipping more than one version increments `metrics.coalesced`.

Known entities that are no longer relevant, have been destroyed, or no longer exist are sent as **despawns** before any spawns or updates.

### Budget

When the number of spawn and update records reaches `budget.maxEntities`, the rest are deferred to a later tick (`metrics.deferred++`).

`ReplicationBudget` also declares `maxBytes` and `maxPendingLifecycle`, but `replicator.ts` does not enforce them. `outboundBytes` on the client state is a rough estimate: 80 bytes per spawn or update plus 16 per despawn.

### Input admission order

`InputGateway.admit(raw, tick)` runs these checks in order. The first failure decides the result:

1. `beginTick(tick)`: reset per-tick counters and flag timeouts.
2. Unknown session → `session / unknown-session`.
3. Disconnected → `session / disconnected`.
4. `admittedThisTick >= maxPerTick` → `input-rate / rate-limit`.
5. `validateInput(raw, session.lastSeq, policy)`:
   - payload larger than `maxBytes` (JSON length) → `input-schema / oversized`
   - invalid client id → `session / bad-client`
   - `position` or `velocity` present → `input-schema / claimed-authority`
   - `seq` not a safe integer ≥ 1 → `input-sequence / bad-seq`
   - `seq <= lastSeq` → `input-sequence / duplicate-or-old` (also counted in `metrics.duplicates`)
   - `seq > lastSeq + maxFuture` → `input-sequence / future`
   - illegal `moveX` / `moveZ` / `yaw` / `buttons` → `input-schema / bad-*`
6. `entity` given and not the owned entity → `ownership / not-owner`.
7. No owned entity → `ownership / no-owned-entity`.

On success the gateway updates `lastSeq` and `lastTick`, increments the per-tick count, and clears the timeout flags.

A session that is connected, has sent at least one input, and has been silent for more than `timeoutTicks` ticks is marked `timedOut`. `drainTimeouts()` returns each newly timed-out owned entity once, so the caller can `world.clearInput()` it.

---

## Module reference

`src/index.ts` re-exports `types`, `input`, `ingress`, `mirror`, `replicator`, `simulator`, and `net-path`. `conveyor-engine-replication/simulator` exposes `SimulatedReplication` on its own.

### `types.ts`

- `ReplicationBudget` / `DEFAULT_BUDGET`: `{ maxBytes: 32000, maxEntities: 64, maxPendingLifecycle: 128 }`.
- `ClientReplicationState`: `clientId`, `connected`, `lastSentSeq`, `lastAckSeq`, `lastProcessedInput`, `known: Map<EntityId, version>`, `interestRadius`, `ownedEntity?`, `focusX`/`focusZ`, `pendingDespawn`, `needsFull`, `lastFullTick`, `outboundBytes`, `queueDepth`, `resyncCount`.
- `SpawnRecord`, `UpdateRecord`, `DespawnRecord`, `SnapshotEnvelope` (above).
- `ReplicationMetrics`: client, snapshot, full, delta, spawn, update, and despawn counts, plus `coalesced`, `deferred`, and `resyncCount`.
- `ValidatedInput`: `{ clientId, seq, moveX, moveZ, yaw, buttons, entity? }`.

### `replicator.ts`: `Replicator`

```ts
new Replicator(budget: ReplicationBudget = DEFAULT_BUDGET)
```

| Method | Description |
| --- | --- |
| `connect(clientId, ownedEntity?, radius = 48)` | Register a client. It needs a full snapshot first. |
| `disconnect(clientId)` | Remove the client |
| `get(clientId)` | Client replication state |
| `ack(clientId, seq)` | Raise `lastAckSeq`, used as the delta `baseline` |
| `setProcessedInput(clientId, seq)` | Raise `lastProcessedInput`, echoed in envelopes |
| `requestResync(clientId)` | Force the next envelope to be `full` |
| `setAssetCompatibilityHash(hash)` | Shared `assetsCompatHash` included in every envelope |
| `publish(world, snap) → Map<ClientId, SnapshotEnvelope>` | Build envelopes for all connected clients |

The interest focus follows the owned entity's position when there is one. Otherwise it stays at `(0, 0)`.

### `input.ts`

- `InputPolicy` / `DEFAULT_INPUT_POLICY`: `{ maxAbsMove: 1, maxFuture: 8, maxBytes: 512, maxPerTick: 8 }`.
- `RawInput`: unvalidated fields `clientId`, `seq`, `moveX?`, `moveZ?`, `yaw?`, `buttons?`, `position?`, `velocity?`, `entity?`.
- `InputAdmitResult`: `{ ok: true; input } | { ok: false; category; reason }`.
- `validateInput(raw, lastProcessed, policy?)`. Missing axes default to `0`, and `buttons` is truncated to an integer.

### `ingress.ts`: `InputGateway`

```ts
new InputGateway(opts?: { policy?: Partial<InputPolicy>; timeoutTicks?: bigint /* default 32n */ })
```

- Methods: `connect(clientId, ownedEntity?)`, `disconnect`, `get`, `setOwned`, `beginTick`, `drainTimeouts`, `admit(raw, tick)`, `enqueueMovement(world, input) → boolean`.
- `enqueueMovement` enqueues `applyInput` for the session's owned entity.
- Exported types: `SessionRecord`, `IngressMetrics` (`accepted`, `rejected`, `duplicates`, `unauthorized`, `timedOut`, `disconnected`).

### `mirror.ts`: `ClientMirror`

Fields: `entities: Map<EntityId, MirrorEntity>`, `lastSeq`, `applied`, `ignored`. Methods: `apply(env)`, `ids()` (sorted), `view(id)`. `MirrorEntity` is `ImmutableEntityView & { present: boolean }`.

### `simulator.ts`: `SimulatedReplication`

`new SimulatedReplication(world, snapshotOf: () => WorldSnapshot | undefined, replicator?)`.

`buildPublish(graph, ctx)` defines a `"frame"` vertex that calls `replicator.publish` and stores the result in `lastEnvelopes`. Per the source header, the publish phase must not propose StateStore changes.

### `net-path.ts`: `SimulatedNetPath`, `NetBatch`, `NetDeliver`

A combined admit, sim, and network harness: `new SimulatedNetPath({ clients = [1, 2], radius = 32 })`.

- `setupNetwork(net, profile?)` adds a `world` peer and `client:<id>` peers on channel `snap`, and connects gateway, replicator, and mirror sessions.
- `partition(net, clientId, fromTick, toTick)`.
- `buildAdmit` validates `NetBatch.inputs` through the gateway.
- `buildSim` handles three things:
  - **creates**: owned pawns are marked always-relevant (`flags 1, category 1`); unowned ones are placed at `x = 400`.
  - **timeouts**: timed-out entities have their input cleared.
  - **inputs**: movement is applied, the world is committed, the canonical world is proposed on `["world"]`, and envelopes are sent through `ctx.network.send`. The envelope body is kept in `outbox` under its payload hash.
- On `net-deliver` events, the envelope is applied to the target client's `ClientMirror`.
- Counters: `deliveries`, `duplicateIgnored`, `sends`, `rejects`.

---

## Usage examples

### Publish envelopes from a world

```ts
import { AuthoritativeWorld } from "conveyor-engine-world";
import { Replicator } from "conveyor-engine-replication";

const world = new AuthoritativeWorld();
const pawn = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
const snap = world.commit(1n);

const rep = new Replicator();
rep.connect(1, pawn, /* interest radius */ 16);

const env = rep.publish(world, snap).get(1)!;
env.kind;   // "full"
env.spawns; // includes the owned pawn
```

### Admit input and apply it

```ts
import { InputGateway } from "conveyor-engine-replication";

const gw = new InputGateway();
gw.connect(1, pawn);

const r = gw.admit({ clientId: 1, seq: 1, moveX: 1, moveZ: 0 }, 2n);
if (r.ok) {
  gw.enqueueMovement(world, r.input);
  rep.setProcessedInput(1, r.input.seq);
}
for (const e of gw.drainTimeouts()) world.clearInput(e);
world.commit(2n);
```

### Mirror a client headlessly

```ts
import { ClientMirror } from "conveyor-engine-replication";

const mirror = new ClientMirror();
mirror.apply(env);
mirror.ids(); // entity ids the client currently knows about
```

---

## Configuration

| Setting | Default | Where |
| --- | --- | --- |
| `budget.maxEntities` | `64` | `new Replicator(budget)`, enforced |
| `budget.maxBytes` / `maxPendingLifecycle` | `32000` / `128` | Declared, not enforced |
| Interest radius | `48` (`connect`), `32` (`SimulatedNetPath`) | per client |
| `policy.maxAbsMove` | `1` | `InputGateway` / `validateInput` |
| `policy.maxFuture` | `8` | |
| `policy.maxBytes` | `512` | |
| `policy.maxPerTick` | `8` | `InputGateway` only |
| `timeoutTicks` | `32n` | `InputGateway` |

Entities with `category === 1` or `flags & 1` (set via the world's `setReplication` command) are always relevant.

---

## Relationship to other packages

```
conveyor-engine-core ─┬─► conveyor-engine-world ─► conveyor-engine-replication ─► conveyor-engine-transport-ws
                      └──────────────────────────────────────▲
conveyor-graph / conveyor-graph-simulator (peers; simulator bindings)
```

- **Consumes** `WorldSnapshot`, `ImmutableEntityView`, and `AuthoritativeWorld` from `conveyor-engine-world`.
- **Is a dependency of** `conveyor-engine-transport-ws` and `conveyor-engine-example`.
- **Feeds the client**: the envelope's `spawns`, `updates`, and `despawns` carry the fields `conveyor-engine-client` reads as `ViewWire` (`id`, `owner`, `position`, `rotation`, `scale`, `velocity`, `radius`, `replicationVersion`, `inputSeq`, `render`, `actionEpoch` / `action`).

---

## Project layout

```
conveyor-engine-replication/
├── package.json, package-lock.json, tsconfig.json, README.md
├── src/
│   ├── index.ts        # barrel
│   ├── types.ts        # budget, client state, envelope, metrics
│   ├── replicator.ts   # Replicator
│   ├── input.ts        # validateInput, InputPolicy
│   ├── ingress.ts      # InputGateway
│   ├── mirror.ts       # ClientMirror
│   ├── simulator.ts    # SimulatedReplication (./simulator subpath)
│   └── net-path.ts     # SimulatedNetPath
└── test/
    ├── replication.test.ts
    ├── e4-replication.test.ts
    ├── e5-ingress.test.ts
    └── n1-network.test.ts
```

---

## License

ISC. Copyright (c) 2026 autonomous1. See `LICENSE` at the root of the [repository](https://github.com/autonomous1/conveyor-engine-packages).

**Repository:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)
