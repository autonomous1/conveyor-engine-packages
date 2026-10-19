# conveyor-engine-core

> **Source:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)

Shared identifiers, message categories, numeric helpers, protocol/handshake contracts, and the shared planar movement integrator for the Conveyor Engine packages.

`conveyor-engine-core` is the bottom layer of the Conveyor Engine dependency graph. It has **no runtime dependencies**, and every other engine package (`conveyor-engine-world`, `-replication`, `-client`, `-transport-ws`, …) builds on the types and constants defined here. It is small by design: plain type aliases, frozen `as const` lookup tables, and pure functions, with no classes, I/O, or global state.

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Build, typecheck, and test](#build-typecheck-and-test)
- [Core concepts](#core-concepts)
- [Module reference](#module-reference)
  - [`ids.ts`: identifiers and versions](#idsts-identifiers-and-versions)
  - [`components.ts`: component kinds](#componentsts-component-kinds)
  - [`messages.ts`: message and error categories](#messagests-message-and-error-categories)
  - [`numeric.ts`: ingress numeric policy](#numericts-ingress-numeric-policy)
  - [`protocol.ts`: handshake compatibility](#protocolts-handshake-compatibility)
  - [`movement.ts`: shared planar integrator](#movementts-shared-planar-integrator)
- [Usage examples](#usage-examples)
- [Configuration](#configuration)
- [Relationship to other packages](#relationship-to-other-packages)
- [Project layout](#project-layout)
- [License](#license)

---

## Features

- **Stable identifier types**: `EntityId`, `ClientId`, `Tick` (a `bigint`), `SnapshotSeq`, `InputSeq`, and more, plus validators and assertions.
- **Deterministic comparators**: `compareId` and `compareTick` for stable sorting.
- **Component kind registry**: numeric `ComponentKind` codes with human-readable `ComponentName`s.
- **Message taxonomy**: `MessageCategory` codes for session, input, snapshot, entity lifecycle, and diagnostic traffic, plus string `ErrorCategory` values.
- **Ingress numeric policy**: rejects `NaN`, `±Infinity`, and `-0` at the boundary.
- **Handshake checks**: protocol/world compatibility and world-bundle / authoritative-hash compatibility with typed mismatch codes.
- **Shared planar movement integrator**: one implementation used by both the authoritative store and the client predictor, so prediction matches the server.
- **ESM-only output** with `.d.ts` typings.

---

## Installation

From `package.json`:

| Field | Value |
| --- | --- |
| `name` | `conveyor-engine-core` |
| `version` | `0.0.1` |
| `type` | `module` (ESM only) |
| `exports["."]` | `types: ./dist/index.d.ts`, `import: ./dist/index.js` |
| `files` | `dist`, `src` |
| `license` | `ISC` |

Inside this monorepo, sibling packages depend on core through a local file path. For example, `conveyor-engine-world/package.json` has:

```json
"dependencies": {
  "conveyor-engine-core": "file:../conveyor-engine-core"
}
```

Your own package can use the same pattern:

```bash
npm install ../conveyor-engine-core
```

Or, from a registry if a copy has been published there:

```bash
npm install conveyor-engine-core
```

> `exports` points at `dist/`, not `src/`. Build the package (see below) before any consumer imports it.

---

## Build, typecheck, and test

```bash
npm install
npm run build      # rm -rf dist && tsc -p tsconfig.json
npm run typecheck  # tsc -p tsconfig.json --noEmit
npm test           # node --experimental-strip-types --test test/*.test.ts
npm run clean      # rm -rf dist
```

- The build emits ESM JavaScript plus `.d.ts` declarations to `dist/`.
- Tests use the built-in `node:test` runner and import from `../dist/index.js`, so **run `npm run build` before `npm test`**.
- `--experimental-strip-types` requires a Node.js version that supports type stripping (Node 22.6+).
- Dev dependencies: `typescript ^5.8.2`, `@types/node ^22.10.0`.

From the repository root, `npm run build` / `npm test` run every package in dependency order, starting with `conveyor-engine-core`.

---

## Core concepts

### Identifiers are plain values, not object identity

From `src/ids.ts`:

> Entity ids are positive JavaScript-safe integers. They are independent of object identity, array index, `Object3D.uuid`, and random UUIDs.

Most ids (`EntityId`, `ClientId`, `SessionId`, `SnapshotSeq`, `InputSeq`, `ComponentId`, `Version`) are `number` aliases. Entity and client ids are valid when they are integers in `1 … Number.MAX_SAFE_INTEGER`.

### Ticks are `bigint`

`Tick` is a `bigint` to match the simulator's `dueTick` and the canonical-v1 `$i` encoding. Valid ticks are `>= 0n`. How a tick is encoded on the wire is up to the transport package, not core.

### Ownership

`OwnerId` is `ClientId | 0`. The constant `NO_OWNER` (`0`) means "server / unowned". This is why valid client ids start at `1`.

### Versioning and compatibility

- `PROTOCOL_VERSION = 1`: the wire protocol version.
- `ENGINE_PACKAGE_VERSION = "0.0.1"`: matches `package.json`.
- `WorldConfigId`: a string naming the world configuration (default `"world-v1"` in `localCompatibility`).

The two peers of a session have to agree on the protocol version and the world id. If the server and client both know a world bundle id or an authoritative content hash, those have to match too.

### Strict numeric ingress

Numbers arriving from outside, such as client input, must be finite and must not be `-0`. That keeps canonical hashing and replay deterministic.

### One movement integrator for server and client

`integratePlanarMove` is the single source of truth for planar (X/Z) motion. The authoritative world and the client-side predictor both call it, so a predicted state matches the server's for the same inputs.

---

## Module reference

Everything below is re-exported from the package entry point (`src/index.ts`):

```ts
export * from "./ids.js";
export * from "./components.js";
export * from "./messages.js";
export * from "./numeric.js";
export * from "./protocol.js";
export * from "./movement.js";
```

### `ids.ts`: identifiers and versions

**Types**

| Type | Definition | Notes |
| --- | --- | --- |
| `EntityId` | `number` | Positive safe integer |
| `ClientId` | `number` | Positive safe integer |
| `SessionId` | `number` | |
| `Tick` | `bigint` | Non-negative |
| `SnapshotSeq` | `number` | |
| `InputSeq` | `number` | |
| `ComponentId` | `number` | |
| `ResourceId` | `string` | |
| `OwnerId` | `ClientId \| 0` | `0` = no owner |
| `Version` | `number` | |
| `WorldConfigId` | `string` | |
| `ProtocolVersion` | `number` | |

**Constants**

| Constant | Value |
| --- | --- |
| `NO_OWNER: OwnerId` | `0` |
| `PROTOCOL_VERSION: ProtocolVersion` | `1` |
| `ENGINE_PACKAGE_VERSION` | `"0.0.1"` |
| `MAX_SAFE_ID` | `Number.MAX_SAFE_INTEGER` |

**Functions**

```ts
function isValidEntityId(id: unknown): id is EntityId
```
Type guard. True for an integer `number` where `0 < id <= MAX_SAFE_ID`.

```ts
function isValidClientId(id: unknown): id is ClientId
```
Same rule as `isValidEntityId`.

```ts
function isValidTick(tick: unknown): tick is Tick
```
True for a `bigint >= 0n`. A plain `number` such as `0` returns **false**.

```ts
function assertEntityId(id: EntityId): EntityId
```
Returns `id`, or throws `Error("invalid entity id: <id>")`.

```ts
function assertTick(tick: Tick): Tick
```
Returns `tick`, or throws `Error("invalid tick: <tick>")`.

```ts
function compareId(a: number, b: number): number
function compareTick(a: Tick, b: Tick): number
```
Three-way comparators that return `-1`, `0`, or `1`. They work with `Array.prototype.sort` and give a deterministic order.

### `components.ts`: component kinds

```ts
export const ComponentKind = {
  Transform: 1,
  Velocity: 2,
  Bounds: 3,
  Ownership: 4,
  Replication: 5,
  Lifecycle: 6,
  InputState: 7,
} as const;

export type ComponentKind = (typeof ComponentKind)[keyof typeof ComponentKind]; // 1 | 2 | … | 7

export const ComponentName: Record<ComponentKind, string>;
// e.g. ComponentName[ComponentKind.Transform] === "Transform"
```

`ComponentKind` is both a value (the lookup object) and a type (the union of its numeric values). `ComponentName` maps each kind back to its display name, for logs and diagnostics.

### `messages.ts`: message and error categories

```ts
export const MessageCategory = {
  SessionControl: 1,
  ClientInput: 2,
  InputAck: 3,
  FullSnapshot: 4,
  DeltaSnapshot: 5,
  EntitySpawn: 6,
  EntityUpdate: 7,
  EntityDespawn: 8,
  AuthoritativeEvent: 9,
  ResyncRequest: 10,
  ProtocolError: 11,
  Diagnostic: 12,
} as const;
export type MessageCategory = (typeof MessageCategory)[keyof typeof MessageCategory]; // 1 … 12

export const ErrorCategory = {
  Protocol: "protocol",
  Session: "session",
  InputSchema: "input-schema",
  InputRate: "input-rate",
  InputSequence: "input-sequence",
  Ownership: "ownership",
  Resource: "resource",
  Internal: "internal",
} as const;
export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];
```

`MessageCategory` classifies traffic between server and client: session control, client input and its acknowledgements, full and delta snapshots, entity spawn/update/despawn, authoritative events, resync requests, protocol errors, and diagnostics. `ErrorCategory` gives stable string tags for classifying failures.

### `numeric.ts`: ingress numeric policy

```ts
function isLegalNumber(value: unknown): value is number
```
True for a finite `number` that is not `-0`.

```ts
function assertLegalNumber(value: unknown, label = "number"): number
```
Returns `value` if it is legal. Otherwise it throws an `Error` with a specific message:

| Input | Error message |
| --- | --- |
| not a number | `"<label>: not a number"` |
| `NaN` | `"<label>: NaN"` |
| `Infinity` / `-Infinity` | `"<label>: non-finite"` |
| `-0` | `"<label>: -0"` |

```ts
function isSafeSeq(value: unknown): value is number
```
True for a safe integer `>= 1`. Use it to validate sequence numbers such as `InputSeq` and `SnapshotSeq`.

### `protocol.ts`: handshake compatibility

**Protocol/world compatibility**

```ts
type Compatibility = {
  protocol: ProtocolVersion;
  world: WorldConfigId;
};

function localCompatibility(world: WorldConfigId = "world-v1"): Compatibility
```
Builds `{ protocol: PROTOCOL_VERSION, world }` for this build.

```ts
function handshakeCompatible(
  local: Compatibility,
  remote: Compatibility,
): { ok: true } | { ok: false; reason: string }
```
Checks the protocol version first, then the world id. Example failure reasons are `"protocol 2 != 1"` and `"world other != world-v1"`.

**World-bundle compatibility**

```ts
const BundleMismatchCode = {
  PROTOCOL_MISMATCH: "PROTOCOL_MISMATCH",
  WORLD_BUNDLE_MISMATCH: "WORLD_BUNDLE_MISMATCH",
  AUTHORITATIVE_CONTENT_MISMATCH: "AUTHORITATIVE_CONTENT_MISMATCH",
  AUTHORITATIVE_CONTENT_UNAVAILABLE: "AUTHORITATIVE_CONTENT_UNAVAILABLE",
  INVALID_WORLD_BUNDLE: "INVALID_WORLD_BUNDLE",
} as const;
type BundleMismatchCode = (typeof BundleMismatchCode)[keyof typeof BundleMismatchCode];

type BundleIdentity = {
  bundleId?: string;
  authoritativeHash?: string;
};

function handshakeBundleCompatible(
  server: BundleIdentity,
  client: BundleIdentity,
): { ok: true } | { ok: false; code: BundleMismatchCode; reason: string }
```

Rules, in the order they are checked:

1. The server has neither `bundleId` nor `authoritativeHash`: **ok**.
2. The client has neither: **ok**. The check is lenient when the client declares nothing.
3. Both have a `bundleId` and the ids differ: `WORLD_BUNDLE_MISMATCH`, with reason `"bundle <client> != <server>"`.
4. Both have an `authoritativeHash` and the hashes differ: `AUTHORITATIVE_CONTENT_MISMATCH`, with reason `"authoritative compatibility hash mismatch"`.
5. Otherwise: **ok**.

`PROTOCOL_MISMATCH`, `AUTHORITATIVE_CONTENT_UNAVAILABLE`, and `INVALID_WORLD_BUNDLE` are defined in `BundleMismatchCode` for other packages to use. `handshakeBundleCompatible` itself never returns them.

### `movement.ts`: shared planar integrator

```ts
type PlanarMoveConfig = {
  maxSpeed: number; // scales intent into target velocity; also the post-damping clamp
  accel: number;    // approach rate toward target velocity (per second)
  damping: number;  // velocity damping rate (per second)
  dt: number;       // fixed step, seconds
};

type PlanarMoveState = {
  px: number; pz: number; // position on the X/Z plane
  vx: number; vz: number; // velocity
  qy: number; qw: number; // yaw-only quaternion components
};

function integratePlanarMove(
  s: PlanarMoveState,
  moveX: number,
  moveZ: number,
  yaw: number,
  cfg: PlanarMoveConfig,
): PlanarMoveState
```

One fixed step works like this:

1. **Accelerate toward the target.** `v += (move * maxSpeed - v) * min(1, accel * dt)`, applied to X and Z separately.
2. **Damp.** `v *= max(0, 1 - damping * dt)`.
3. **Clamp.** If `|v| > maxSpeed`, scale `v` down to `maxSpeed`.
4. **Integrate position.** `p += v * dt`.
5. **Orientation from yaw.** `qy = sin(yaw / 2)`, `qw = cos(yaw / 2)`. This is a rotation about the Y axis.

The function is pure: it returns a new state and does not mutate `s`. With damping applied, the steady-state speed stays below `maxSpeed`. The source comment says this is intentional and that the clamp is not a second limiter.

---

## Usage examples

All examples use only the exports listed above.

### Validating identifiers and ticks

```ts
import {
  isValidEntityId,
  isValidTick,
  assertEntityId,
  assertTick,
  compareTick,
  NO_OWNER,
  type EntityId,
  type OwnerId,
  type Tick,
} from "conveyor-engine-core";

isValidEntityId(1);   // true
isValidEntityId(0);   // false
isValidEntityId(1.5); // false

isValidTick(0n);      // true
isValidTick(0);       // false (ticks must be bigint)

const id: EntityId = assertEntityId(42);
const tick: Tick = assertTick(7n);

const owner: OwnerId = NO_OWNER; // 0 = unowned / server

const ticks: Tick[] = [5n, 1n, 3n];
ticks.sort(compareTick); // [1n, 3n, 5n]
```

### Rejecting bad numeric input at ingress

```ts
import { assertLegalNumber, isLegalNumber, isSafeSeq } from "conveyor-engine-core";

assertLegalNumber(1.5, "moveX");      // 1.5
assertLegalNumber(Number.NaN, "moveX"); // throws Error("moveX: NaN")
assertLegalNumber(-0, "moveX");       // throws Error("moveX: -0")

isLegalNumber(Infinity); // false
isSafeSeq(1);            // true
isSafeSeq(0);            // false
```

### Handshake checks

```ts
import {
  localCompatibility,
  handshakeCompatible,
  handshakeBundleCompatible,
  BundleMismatchCode,
} from "conveyor-engine-core";

const local = localCompatibility("world-v1"); // { protocol: 1, world: "world-v1" }

const r1 = handshakeCompatible(local, { protocol: 2, world: "world-v1" });
if (!r1.ok) console.warn(r1.reason); // "protocol 2 != 1"

const r2 = handshakeBundleCompatible(
  { bundleId: "bundle-a", authoritativeHash: "abc" },
  { bundleId: "bundle-b" },
);
if (!r2.ok && r2.code === BundleMismatchCode.WORLD_BUNDLE_MISMATCH) {
  console.warn(r2.reason); // "bundle bundle-b != bundle-a"
}
```

### Classifying messages and components

```ts
import { MessageCategory, ErrorCategory, ComponentKind, ComponentName } from "conveyor-engine-core";

function describe(category: MessageCategory): string {
  switch (category) {
    case MessageCategory.FullSnapshot:  return "full snapshot";
    case MessageCategory.DeltaSnapshot: return "delta snapshot";
    case MessageCategory.InputAck:      return "input ack";
    default:                            return `category ${category}`;
  }
}

ComponentName[ComponentKind.Velocity]; // "Velocity"
ErrorCategory.InputRate;               // "input-rate"
```

### Stepping planar movement

```ts
import { integratePlanarMove, type PlanarMoveConfig, type PlanarMoveState } from "conveyor-engine-core";

const cfg: PlanarMoveConfig = { maxSpeed: 5, accel: 10, damping: 2, dt: 1 / 60 };

let s: PlanarMoveState = { px: 0, pz: 0, vx: 0, vz: 0, qy: 0, qw: 1 };

// Push forward along +Z while facing yaw = 0, for one second of fixed steps.
for (let i = 0; i < 60; i++) {
  s = integratePlanarMove(s, 0, 1, 0, cfg);
}
```

The server and the client predictor both run this same function with the same `PlanarMoveConfig`, so their results match for identical inputs.

---

## Configuration

The package has no runtime configuration, environment variables, or config files. The only tunable values are:

- `PlanarMoveConfig` (`maxSpeed`, `accel`, `damping`, `dt`), passed on each call to `integratePlanarMove`.
- The `world` argument to `localCompatibility` (default `"world-v1"`).

Build settings are in `tsconfig.json`:

| Option | Value |
| --- | --- |
| `target` | `ES2022` |
| `module` / `moduleResolution` | `Node16` |
| `strict` | `true` |
| `declaration` | `true` |
| `rootDir` → `outDir` | `src` → `dist` |
| `types` | `["node"]` |

---

## Relationship to other packages

`conveyor-engine-core` sits at the root of the engine dependency graph (from the repository README):

```
conveyor-engine-core
       │
       ├── conveyor-engine-world
       │          │
       │          └── conveyor-engine-replication
       │
       ├── conveyor-engine-client
       │          │
       │          └── conveyor-engine-three
       │
       ├── conveyor-engine-transport-ws
       │     ├── replication
       │     └── client (optional live)
       │
       └── conveyor-graph-simulator (peer for replay/hash scenarios)
```

| Package | Role | What it uses from core |
| --- | --- | --- |
| `conveyor-engine-world` | Authoritative packed world, commands, snapshots, spatial | ids, ticks, component kinds, `integratePlanarMove` (authoritative side) |
| `conveyor-engine-replication` | Per-client relevance, full/delta snapshots, input ack | message categories, sequence numbers |
| `conveyor-engine-client` | Input history, prediction, interpolation, render snapshots | `integratePlanarMove` (predictor side), ids, ticks |
| `conveyor-engine-transport-ws` | JSON WebSocket / in-process socket adapter | protocol handshake, wire encoding of `Tick` (deferred to transport per `ids.ts`) |
| `conveyor-engine-three` | Primitive Three.js bindings | depends on client render-state interfaces only |
| `conveyor-engine-example` | Headless two-client reference slice | |
| `conveyor-engine-assets` | In-memory primitive/material catalog | |

The "what it uses" column comes from the package roles and the comments in core's source. For example, `movement.ts` describes itself as "used by the authoritative store and the client predictor". Check each package's source for its exact imports.

---

## Project layout

```
conveyor-engine-core/
├── package.json
├── package-lock.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts        # barrel re-export
│   ├── ids.ts          # identifier types, constants, validators, comparators
│   ├── components.ts   # ComponentKind / ComponentName
│   ├── messages.ts     # MessageCategory / ErrorCategory
│   ├── numeric.ts      # ingress numeric policy
│   ├── protocol.ts     # handshake + bundle compatibility
│   └── movement.ts     # shared planar movement integrator
└── test/
    └── ids.test.ts     # ids, ticks, numeric ingress, handshake tests
```

---

## License

ISC. Copyright (c) 2026 autonomous1. See `LICENSE` at the root of the [repository](https://github.com/autonomous1/conveyor-engine-packages).

**Repository:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)
