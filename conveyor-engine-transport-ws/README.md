# conveyor-engine-transport-ws

> **Source:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)

A JSON-over-WebSocket transport for Conveyor Engine, with an in-process loopback for tests. It does four things:

- carries the session handshake (protocol, world, and bundle compatibility), client input, snapshot envelopes, acks, and resync requests;
- runs admitted input through `conveyor-engine-replication`'s `InputGateway`;
- reports processed input sequences to its `Replicator`;
- handles framing limits, malformed frames, per-tick rate limits, and token-based reconnects.

The transport works against a small `TransportSocket` interface. `memoryPair()` gives you a synchronous in-memory socket pair, and `live.ts` wraps the [`ws`](https://www.npmjs.com/package/ws) library to provide a real server and client on `127.0.0.1`.

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Dependencies](#dependencies)
- [Build, typecheck, and test](#build-typecheck-and-test)
- [Core concepts](#core-concepts)
- [Wire protocol](#wire-protocol)
- [Module reference](#module-reference)
- [Usage examples](#usage-examples)
- [Configuration](#configuration)
- [Relationship to other packages](#relationship-to-other-packages)
- [Project layout](#project-layout)
- [License](#license)

---

## Features

- **`EngineWsServer`**:
  - performs the handshake using core's `handshakeCompatible` and `handshakeBundleCompatible`;
  - assigns client ids and session ids and issues reconnect tokens;
  - admits input through an `InputGateway` and records processed input on a `Replicator`;
  - handles acks and resync requests;
  - sends snapshot envelopes;
  - enforces a frame size cap, rejects malformed frames, and rate-limits frames per tick.
- **`EngineWsClient`**:
  - sends `hello`, then `input`, `ack`, and `resync`;
  - optionally checks that the server's welcome matches an expected bundle;
  - exposes callbacks for welcome, snapshot, reject, error, and close.
- **Codec**: JSON frames, with `bigint` values encoded as `{ "$i": "<decimal>" }` (canonical-v1 style) and decoded back to `bigint`.
- **Sockets**: `memoryPair()` for deterministic synchronous tests, and `socketFromWs()` to adapt a `ws` `WebSocket`.
- **Live helpers**: `listenHttp(engine, port)` and `connectUrl(url, opts)`.

---

## Installation

| Field | Value |
| --- | --- |
| `name` | `conveyor-engine-transport-ws` |
| `version` | `0.0.1` |
| `type` | `module` (ESM only) |
| `exports["."]` | `./dist/index.js` (+ `.d.ts`) |
| `files` | `dist`, `src` |
| `license` | `ISC` |

```json
"dependencies": { "conveyor-engine-transport-ws": "file:../conveyor-engine-transport-ws" }
```

Build first, because `exports` points at `dist/`.

---

## Dependencies

| Kind | Package | Spec |
| --- | --- | --- |
| dependency | `conveyor-engine-core` | `file:../conveyor-engine-core` |
| dependency | `conveyor-engine-replication` | `file:../conveyor-engine-replication` |
| dependency | `ws` | `^8.18.0` |
| devDependency | `conveyor-engine-world` | `file:../conveyor-engine-world` (tests only) |
| devDependency | `@types/ws`, `@types/node`, `typescript` | `^8.5.14`, `^22.10.0`, `^5.8.2` |

`src/ws-shim.d.ts` declares a minimal ambient `"ws"` module. It covers `WebSocket` (with `OPEN`, `CONNECTING`, `send`, `close`, `on`, `once`) and `WebSocketServer({ server })`, which is the subset `live.ts` uses.

---

## Build, typecheck, and test

```bash
npm install
npm run build
npm run typecheck
npm test   # node --experimental-strip-types --test test/*.test.ts
```

**`transport.test.ts`** uses in-memory sockets to cover:

- handshake accept and reject;
- input reaching `onAdmit`;
- delivering full and delta envelopes into a `ClientMirror`;
- disconnecting, then reconnecting with a token, which forces a resync;
- a welcome that carries the owned entity;
- acks advancing the replicator baseline;
- malformed and oversized frames;
- the per-tick frame cap.

**`live.test.ts`** opens a real `ws` server on an ephemeral port. It covers welcome, rejecting a mismatched world, and cleanup on close.

---

## Core concepts

### Session lifecycle

```
client                         server
  │ hello{protocol,world,      │
  │       token?,bundleId?,    │──► handshakeCompatible → reject{code:"PROTOCOL_MISMATCH"} + close
  │       authoritativeHash?}  │──► handshakeBundleCompatible → reject{code: bundle.code} + close
  │                            │    assign / reuse clientId (token), new sessionId, token "tok-<clientId>-<session>"
  │                            │    owned = onHello?(session, hello)
  │                            │    gateway.connect(clientId, owned); replicator.connect(clientId, owned)
  │                            │    reconnect ⇒ replicator.requestResync(clientId)
  │◄── welcome{clientId,sessionId,reconnectToken,ownedEntityId?,bundleId?,authoritativeHash?}
  │ input / ack / resync ─────►│  (rate-limited per tick)
  │◄── snapshot{envelope} ─────│  server.sendSnapshot(clientId, env)
  │◄── error{category,reason}  │
```

- A frame other than `hello` that arrives before the handshake gets `error{session, "no-handshake"}`.
- When a client reconnects with a known token, the session moves to the new socket and the previous socket is closed.
- When a socket closes, its session is dropped: the gateway and replicator both disconnect the client, and `metrics.disconnected` is incremented.

### What the server does and does not do

- **Does:** for each admitted `input`, call `replicator.setProcessedInput(clientId, seq)` and then `onAdmit(input, tick)`.
- **Does not:** touch the world. Your `onAdmit` (or your tick loop) has to apply movement, for example with `server.gateway.enqueueMovement(world, input)`.
- **Does not:** publish snapshots on its own. You call `server.replicator.publish(world, snap)` and then `server.sendSnapshot(clientId, env)` for each client.

### Tick and rate limiting

Call `server.setTick(tick)` once per server tick. It resets each session's frame counter and calls `gateway.beginTick(tick)`.

Each session may send `maxFramesPerTick` frames per tick, counted after the handshake. Frames beyond that get `error{input-rate, "rate-limit"}`. The `InputGateway`'s own `maxPerTick` and validation rules still apply on top of this.

### Framing

- A frame longer than `maxFrameBytes` is rejected with `error{resource, "oversized"}`. The limit is checked against the JS string `length`.
- JSON that fails to parse is rejected with `error{protocol, "malformed"}`.
- A frame without a string `type` gets `"malformed"`. A frame with the wrong `v` gets `"bad-protocol"`.

None of these close the connection.

---

## Wire protocol

Every message has `v: TRANSPORT_PROTOCOL`, which equals core's `PROTOCOL_VERSION`, currently `1`.

| `type` | Direction | Fields |
| --- | --- | --- |
| `hello` | C → S | `protocol`, `world`, `token?`, `bundleId?`, `authoritativeHash?`, `presentationHash?` |
| `welcome` | S → C | `clientId`, `sessionId`, `protocol`, `world`, `reconnectToken`, `ownedEntityId?`, `bundleId?`, `authoritativeHash?` |
| `reject` | S → C | `reason`, `code?` (e.g. `PROTOCOL_MISMATCH`, `WORLD_BUNDLE_MISMATCH`, `AUTHORITATIVE_CONTENT_MISMATCH`) |
| `input` | C → S | `seq`, `moveX`, `moveZ`, `yaw`, `buttons`, `entity?` |
| `snapshot` | S → C | `envelope: SnapshotEnvelope` (from `conveyor-engine-replication`) |
| `ack` | C → S | `snapshotSeq` |
| `resync` | C → S | (none) |
| `error` | S → C | `category`, `reason` |

`bigint` fields such as `envelope.tick` go over the wire as `{ "$i": "123" }`.

---

## Module reference

`src/index.ts` re-exports `codec`, `protocol`, `socket`, `server`, `client`, and `live`.

### `codec.ts`

- `encodeFrame(value: unknown): string` is `JSON.stringify` with bigints written as `{ $i }`.
- `decodeFrame(text: string): unknown` is `JSON.parse` that turns a single-key `{ $i: string }` object back into a `BigInt`.

### `protocol.ts`

- `TRANSPORT_PROTOCOL`.
- Message types: `HelloMsg`, `WelcomeMsg`, `RejectMsg`, `InputMsg`, `SnapshotMsg`, `AckMsg`, `ResyncMsg`, `ErrorMsg`, and the union `WireMsg`.
- `isObject(v)`.
- `parseWire(value)` returns a `WireMsg`, or `{ error: "malformed" | "bad-protocol" }`. It checks the envelope only, not the per-message schema. Input is validated later by the gateway.
- `inputFromMsg(msg, clientId) → ValidatedInput`.

### `socket.ts`

```ts
interface TransportSocket {
  send(text: string): void;
  close(): void;
  onMessage(handler: (text: string) => void): void;
  onClose(handler: () => void): void;
}
function memoryPair(): { server: TransportSocket; client: TransportSocket };
```

`memoryPair()` delivers messages synchronously. Closing either end closes both ends and fires both ends' close handlers.

### `server.ts`: `EngineWsServer`

```ts
new EngineWsServer(opts?: {
  compatibility?: Compatibility;     // default localCompatibility() → { protocol: 1, world: "world-v1" }
  bundle?: BundleIdentity;           // { bundleId?, authoritativeHash? }, default {}
  gateway?: InputGateway;            // default new InputGateway()
  replicator?: Replicator;           // default new Replicator()
  maxFrameBytes?: number;            // default 8192
  maxFramesPerTick?: number;         // default 16
  nextClientId?: ClientId;           // default 1
  onAdmit?: (input: ValidatedInput, tick: Tick) => void;
  onHello?: (session: ServerSession, hello: HelloMsg) => EntityId | undefined; // return owned entity
})
```

| Member | Description |
| --- | --- |
| `attach(socket)` | Start serving a socket |
| `setTick(tick)` | Advance the server tick (frame counters and gateway) |
| `sendSnapshot(clientId, envelope) → boolean` | Send a `snapshot` frame. Returns `false` if there is no such session. |
| `disconnect(clientId)` | Close the socket and drop the session |
| `session(clientId)` | `ServerSession`: `{ clientId, sessionId, token, socket, framesThisTick, tick }` |
| `connected` | Sorted client ids with a live session |
| `compatibility`, `bundle`, `gateway`, `replicator`, `maxFrameBytes`, `maxFramesPerTick` | Read-only config |
| `metrics` | `accepted`, `rejected`, `disconnected`, `malformed`, `oversized`, `rateLimited`, `inputs`, `snapshots` |

Per a source comment, `onHello` runs **before** `gateway.connect` replaces the session record. That lets a reconnect reuse the previous owned entity.

### `client.ts`: `EngineWsClient`

```ts
new EngineWsClient(socket: TransportSocket, opts?: {
  compatibility?: Compatibility;  // default localCompatibility()
  bundleId?: string;              // sent in hello
  authoritativeHash?: string;     // sent in hello
  expectedBundle?: { bundleId?: string; authoritativeHash?: string }; // verified against welcome
  token?: string;                 // reconnect token
  onWelcome?, onSnapshot?, onReject?, onError?, onClose?
})
```

- **Methods:** `hello()`, `sendInput({ seq, moveX, moveZ, yaw?, buttons?, entity? })`, `ack(snapshotSeq)`, `requestResync()`, `close()`.
- **State:** `clientId`, `sessionId`, `reconnectToken`, `ownedEntityId`, `connected`, `metrics` (`sent`, `received`, `snapshots`, `errors`).
- **Default token:** `hello()` sends `opts.token`, or the `reconnectToken` from the last welcome if no token was given.
- **Expected bundle:** if `expectedBundle` is set and the welcome's `bundleId` or `authoritativeHash` differs, the client calls `onReject` itself with `WORLD_BUNDLE_MISMATCH` or `AUTHORITATIVE_CONTENT_MISMATCH` and closes.

### `live.ts`

- `socketFromWs(ws: WebSocket): TransportSocket` decodes `Buffer` messages as UTF-8. It only sends when the socket is `OPEN`.
- `listenHttp(engine, port = 0): Promise<LiveServer>` starts an `http` server plus a `WebSocketServer` on **127.0.0.1** and attaches every connection to `engine`.
  - `LiveServer` is `{ port, url: "ws://127.0.0.1:<port>", close(): Promise<void> }`.
- `connectUrl(url, opts?): Promise<EngineWsClient>` opens a `ws` connection, sends `hello()` once it opens, and resolves with the client.

---

## Usage examples

### In-process loopback, as in the tests

```ts
import { AuthoritativeWorld } from "conveyor-engine-world";
import { EngineWsServer, EngineWsClient, memoryPair } from "conveyor-engine-transport-ws";

const world = new AuthoritativeWorld();
const pawn = world.createEntity(0n, { type: "p", shape: "capsule" }, 1);
world.commit(0n);

const server = new EngineWsServer({
  onHello: () => pawn,                                         // owned entity for this session
  onAdmit: (input) => server.gateway.enqueueMovement(world, input),
});

const { server: sSock, client: cSock } = memoryPair();
server.attach(sSock);

const client = new EngineWsClient(cSock, {
  onSnapshot: (env) => client.ack(env.seq),
});
client.hello();

server.setTick(1n);
client.sendInput({ seq: 1, moveX: 1, moveZ: 0 });

const snap = world.commit(1n);
for (const [id, env] of server.replicator.publish(world, snap)) server.sendSnapshot(id, env);
```

### Live WebSocket on localhost

```ts
import { EngineWsServer, listenHttp, connectUrl } from "conveyor-engine-transport-ws";

const engine = new EngineWsServer({ onHello: () => 10 });
const live = await listenHttp(engine, 0);        // ephemeral port

const client = await connectUrl(live.url, {
  onWelcome: (w) => console.log("client", w.clientId, "owns", w.ownedEntityId),
});

// ...
client.close();
await live.close();
```

### Reconnect with a token

```ts
const token = client.reconnectToken!;
client.close();
const again = new EngineWsClient(newSocket, { token });
again.hello(); // same clientId; server forces a full snapshot (resync)
```

---

## Configuration

| Option | Default |
| --- | --- |
| `compatibility` | `localCompatibility()`, i.e. `{ protocol: 1, world: "world-v1" }` |
| `bundle` | `{}`, so the bundle check always passes |
| `maxFrameBytes` | `8192` (JS string length) |
| `maxFramesPerTick` | `16` |
| `nextClientId` | `1` |
| Live bind address | `127.0.0.1` (hard-coded in `listenHttp`) |

Input limits (`maxAbsMove`, `maxFuture`, `maxBytes`, `maxPerTick`, timeout) live on the `InputGateway`. Pass your own instance as `gateway` to change them.

---

## Relationship to other packages

```
conveyor-engine-core ─┬──────────────────────────────► conveyor-engine-transport-ws ◄── ws
conveyor-engine-replication (InputGateway, Replicator, SnapshotEnvelope) ─┘
conveyor-engine-world (devDependency: tests)
```

- **Uses from core:** `handshakeCompatible`, `handshakeBundleCompatible`, `localCompatibility`, and `PROTOCOL_VERSION`.
- **Uses from replication:** `InputGateway`, `Replicator`, and the `SnapshotEnvelope` / `ValidatedInput` types. `conveyor-engine-replication` is a runtime **dependency**, not an optional one.
- **Does not import `conveyor-engine-client`.** A browser or Node client feeds the received `envelope` into `EngineClient.applySnapshot`. `conveyor-engine-example` wires this up in `ExampleApp.connectClient` (over `memoryPair()`). Its live arena mode (`npm run live:arena`) serves the same protocol over a real socket via `listenHttp`.

---

## Project layout

```
conveyor-engine-transport-ws/
├── package.json, package-lock.json, tsconfig.json, README.md
├── src/
│   ├── index.ts      # barrel
│   ├── codec.ts      # encodeFrame / decodeFrame
│   ├── protocol.ts   # wire message types, parseWire
│   ├── socket.ts     # TransportSocket, memoryPair
│   ├── server.ts     # EngineWsServer
│   ├── client.ts     # EngineWsClient
│   ├── live.ts       # ws adapters: socketFromWs, listenHttp, connectUrl
│   └── ws-shim.d.ts  # minimal ambient "ws" types
└── test/
    ├── transport.test.ts
    └── live.test.ts
```

---

## License

ISC. Copyright (c) 2026 autonomous1. See `LICENSE` at the root of the [repository](https://github.com/autonomous1/conveyor-engine-packages).

**Repository:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)
