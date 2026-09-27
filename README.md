# Conveyor Engine Packages

Narrow engine-layer packages that connect an authoritative fixed-step world to
network replication, client prediction, and a Three.js projection.

| Package | Role |
| --- | --- |
| `conveyor-engine-core` | Shared identifiers, message categories, errors |
| `conveyor-engine-world` | Authoritative packed world, commands, snapshots, spatial |
| `conveyor-engine-replication` | Per-client relevance, full/delta snapshots, input ack |
| `conveyor-engine-client` | Input history, prediction, interpolation, render snapshots |
| `conveyor-engine-three` | Primitive Three.js bindings (no world/replication imports) |
| `conveyor-engine-transport-ws` | JSON WebSocket / in-process socket adapter |
| `conveyor-engine-example` | Headless two-client reference slice |
| `conveyor-engine-assets` | In-memory primitive/material catalog (not authoritative) |

Dependency direction:

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

`conveyor-engine-three` depends only on client render-state interfaces.
`conveyor-engine-client` does not depend on Three.js.
`conveyor-engine-replication` does not depend on browser APIs.
`conveyor-engine-world` does not depend on transport, DOM, or renderer state.

World and replication peer on `conveyor-graph` and `conveyor-graph-simulator`.
`SimulatedWorld` / `SimulatedReplication` bind packed state into
`ReferenceRuntime` admit → sim (`ctx.propose` path `["world"]`) → publish.
Canonical world records omit `undefined` so `sha256CanonicalV1` and
`run(..., "replayVerify")` work. See `test/simulator-reference.test.ts`.

See `IMPLEMENTATION.md` for identifier and storage choices.

## Build and test

Each package emits ESM + `.d.ts` to `dist/`. Tests import `../dist/index.js`.

Order (file: deps):

`conveyor-graph` and `conveyor-graph-simulator` must be built first so engine packages resolve `dist` types, not source files outside `rootDir`.

```
cd ../conveyor-graph && npm run build
cd ../conveyor-graph-simulator && npm install && npm run build
cd ../conveyor-engine-packages/conveyor-engine-core && npm install && npm run build && npm test
cd ../conveyor-engine-world && npm install && npm run build && npm test
cd ../conveyor-engine-replication && npm install && npm run build && npm test
cd ../conveyor-engine-client && npm install && npm run build && npm test
cd ../conveyor-engine-three && npm install && npm run build && npm test
cd ../conveyor-engine-transport-ws && npm install && npm run build && npm test
cd ../conveyor-engine-example && npm install && npm run build && npm test
```

`npm run build` at the repo root runs that sequence. `exports` point at `dist`, not `src`.
