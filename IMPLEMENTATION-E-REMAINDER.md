# Remaining E-series implementation plan

Status after E0–E1 contracts, E4/E5 headless tests, `transport-ws` loopback, and `conveyor-engine-example`.

This is not a second engine. It closes the original E2–E11 gaps in the same narrow packages.

## What is already done

| Milestone | Shipped |
| --- | --- |
| E0 | Ids, bigint `Tick`, numeric reject, handshake helpers |
| E1 | Packed store, command commit window, freeze, canonical JSON, no-op / 1k tests |
| E2 (partial) | Planar `applyInput`, uniform grid, radius query |
| E3 (partial) | Immutable snapshot DTO, versions, spawn/update/despawn on the tick |
| E4 (partial) | Two-client relevance, enter/leave, `ClientMirror`, budget, resync flag |
| E5 (partial) | `InputGateway` session/ownership/rate/size/disconnect |
| E6 (partial) | Client store, interp buffer, frozen render snapshot |
| E7 (partial) | Owned-entity predict + ack replay + correction distance |
| E8 (partial) | Mock `ThreeProjector` / `memoryScene` |
| E9 (partial) | JSON frames, memory `TransportSocket`, handshake, limits |
| E10 (partial) | Headless two-client `ExampleApp` + hash equality test |
| E11 | Not started |

## What is still open

Grouped by risk, not by original letter order.

### P0 — Deterministic networking before any browser

The plan’s gate was: virtual transport faults before live sockets. That gate is still open. `NetworkScheduler` exists on the simulator; replication and the example do not drive it.

Work package **N1** (touches `conveyor-engine-world` / `replication` / `test/`, not a new package):

1. Scenario factory: two clients, owned pawns, one crate.
2. Admit path records *validated* input only (`InputGateway.admit` inside `buildAdmit`).
3. After sim commit, build envelopes and `ctx.network.send({ from: "world", to: "client:N", payload: { seq, kind } })` with payload hash only (body stays in a side map keyed by hash, same rule as the simulator spec).
4. Next tick, drain `network.tick(due)` and apply delivered envelopes to `ClientMirror`.
5. Profiles: lossless, delay, drop, dup, reorder (delay spread), capacity reject, partition+heal.
6. Assert: world hashes identical across lossless runs; mirrors recover after drop via later delta or `needsFull`; dups do not double-apply; partition then heal triggers resync.

Exit: `test/simulator-reference.test.ts` (or `test/net-faults.test.ts`) covers the E4 “virtual network” list.

### P1 — Finish server motion / spatial (E2 leftovers)

Still missing vs E2: static obstacles, any collision response, input timeout applied to velocity, spatial occupancy after despawn tests.

Work package **W1** in `conveyor-engine-world` only:

1. `StaticObstacle` AABB list on the world (plain data).
2. After `applyMove`, clamp position out of obstacles (axis slide, deterministic order by obstacle id).
3. `InputGateway` timeout already sets `timedOut`; world should zero velocity for that owner on the next commit (explicit command `clearInput`).
4. Tests: obstacle blocks; replay hashes; despawn removes grid occupancy.

Do not extract `conveyor-engine-spatial`. Do not add rigid-body contact.

### P2 — Client presentation policy (E6/E7 leftovers)

Work package **C1** in `conveyor-engine-client`:

1. Stale-seq / gap counters already partly there; add tests for reorder of snapshots (already ignored by seq).
2. Short extrapolation: if only one sample and `now - receivedAt < extraMs`, integrate last velocity; else hold. Cap extraMs.
3. Presentation smoothing: keep `predicted` authoritative-replayed; add `presented` that lerps toward predicted when correction < hard threshold. Render snapshot uses `presented` for the owned entity.
4. Tests with fake `receivedAt` / `now` — no wall clock in assertions.

### P3 — Real WebSocket bind (E9 leftover)

`TransportSocket` is the seam. Work package **T1** in `conveyor-engine-transport-ws`:

1. Optional dependency `ws`.
2. `listenHttp(port)` → `WebSocketServer` wrapping each connection as `TransportSocket`.
3. `connectUrl(url)` client wrapper around Node `WebSocket` / browser `WebSocket`.
4. Tests: loopback on ephemeral port, hello/welcome, reject bad world, close.

Keep JSON text frames. No binary encoding in this pass.

### P4 — Example completeness (E10 leftover)

Work package **X1** in `conveyor-engine-example`:

1. Wire N1 fault profiles as named runners (`lossless`, `lossy`, `partition`) using the simulator, not the live port.
2. Optional `src/browser.ts` only after T1: one HTML page, two local clients or one client + local server. Not required to close the architecture proof.
3. Diagnostics object already exists; print per-client snapshot age / unacked in `npm start`.
4. Metrics-on vs metrics-off hash: already omitted from `canonicalPlain`; keep a test that toggling `world.metrics` values does not change `canonicalJson()`.

### P5 — Measurement (E11)

Work package **M1** after N1 + W1:

1. Script `example` or `world` bench: 1k entities, 2 clients, 120 ticks, print commit ms / publish ms / envelope bytes.
2. Checklist (no new framework): no `Date.now` / `Math.random` in world apply or replicator relevance; commit window still throws; package import graph still acyclic.
3. Decision gate written into `IMPLEMENTATION.md`: extract spatial? binary snapshots? real Three? Colyseus? — only after numbers.

## Explicitly still deferred

Unchanged from the original plan: hierarchy, ECS editor, rigid body, CCD, skeletal animation, terrain, sharding, rollback netcode, WebRTC/WebTransport, matchmaking, persistence, GLTF pipeline, runtime graph rewiring.

## Recommended sequence

```
N1  virtual-network replication+input   (closes E4/E5 gate)
W1  obstacles + input timeout           (closes E2)
C1  extrapolate + present lerp          (closes E6/E7)
T1  listenHttp / connectUrl             (closes E9 live bind)
X1  example runners + diagnostics       (closes E10 headless)
M1  measure and write the gate          (E11)
```

Do not start a real Three scene or Colyseus adapter before N1 and M1.

## Package touch list

| Package | Next edits |
| --- | --- |
| `conveyor-engine-world` | obstacles, `clearInput`, spatial tests |
| `conveyor-engine-replication` | admit-in-sim, net.send of envelope ids, fault tests |
| `conveyor-engine-client` | present state, extraMs |
| `conveyor-engine-transport-ws` | `ws` bind |
| `conveyor-engine-example` | named scenarios, richer start log |
| `conveyor-engine-three` | none until M1 |
| `conveyor-engine-core` | none unless a new error code is required |
