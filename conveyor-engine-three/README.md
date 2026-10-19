# conveyor-engine-three

> **Source:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)

A thin presentation layer that projects `conveyor-engine-client` render snapshots into a scene. It keeps one renderer-agnostic **proxy object** per entity. It also includes a template cache with leases, a client-local presentation runtime for world and entity visuals with fallbacks, a headless animation director, render-profile mapping, and an **optional** dynamic loader for the real `three` package.

The package **does not statically import `three`**. Everything runs headless in CI against a `SceneAdapter`. A real Three.js integration plugs in through that adapter, a `TemplateParser`, and an `AnimationDriver`, using `tryLoadThree()` if you want the optional peer. The package never imports the world or replication packages and never writes authoritative state.

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

- **`ThreeProjector`** syncs a `RenderSnapshot` into `ProxyObject`s through a `SceneAdapter`. It creates, updates, and disposes bindings by entity id and tracks metrics.
- **`memoryScene()`** is an in-memory `SceneAdapter` for tests and headless runs.
- **`RendererCache`** keys templates by `assetId@contentHash`. It coalesces concurrent loads, counts leases, and disposes an entry when its last lease is released. It also has a built-in diagnostic entry.
- **`PresentationRuntime`** attaches a world visual (falling back to a degraded visual, then a diagnostic one) and binds entity visuals that fall back to `primitive/box`. It reports a status: `idle`, `loading`, `ready`, `degraded`, `failed`, or `disabled`.
- **`AnimationDirector`** keeps one mock mixer per entity, sharing cached templates. It handles locomotion transitions, one-shot actions keyed by `actionEpoch` with a hold period, rejection of stale epochs, playback rate from speed, and an optional pluggable `AnimationDriver`.
- **`PrimitiveVisualFactory`** maps a `RenderKey` to a primitive `VisualResource` and implements the `VisualResourceFactory` contract.
- **`applyRenderProfile`** maps render profile and lighting fields onto plain renderer and lighting target objects, without needing a real `WebGLRenderer`.
- **`tryLoadThree()` / `parseGltf()`** dynamically import `three`, `GLTFLoader`, and `SkeletonUtils` when they are installed, and return `undefined` cleanly when they are not.
- **`createStaticWorldVisual()`** is a hook surface for attaching a static-world scene, a fallback, and debug AABB and spawn overlays.

---

## Installation

| Field | Value |
| --- | --- |
| `name` | `conveyor-engine-three` |
| `version` | `0.0.1` |
| `type` | `module` (ESM only) |
| `exports["."]` | `./dist/index.js` (+ `.d.ts`) |
| `files` | `dist`, `src` |
| `license` | `ISC` |

```json
"dependencies": { "conveyor-engine-three": "file:../conveyor-engine-three" }
```

To use the real Three.js loaders, also install the optional peer:

```bash
npm install three
```

Build first, because `exports` points at `dist/`.

---

## Dependencies

| Kind | Package | Spec |
| --- | --- | --- |
| dependency | `conveyor-engine-client` | `file:../conveyor-engine-client` |
| dependency | `conveyor-engine-core` | `file:../conveyor-engine-core` |
| peerDependency (**optional**) | `three` | `>=0.160.0` (`peerDependenciesMeta.three.optional = true`) |
| devDependency | `typescript`, `@types/node` | `^5.8.2`, `^22.10.0` |

`src/` only uses `import type` from `conveyor-engine-client` and `conveyor-engine-core` (`RenderSnapshot`, `RenderKey`, `AnimationDirective`, `EntityId`). The `three` peer is only reached through a runtime dynamic `import()` in `optional-three.ts`.

---

## Build, typecheck, and test

```bash
npm install
npm run build
npm run typecheck
npm test   # node --experimental-strip-types --test test/*.test.ts
```

| Test | Covers |
| --- | --- |
| `three.test.ts` | Projector creates and updates bindings from a snapshot, and disposes them on despawn |
| `presentation.test.ts` | Cache coalescing and hits, a hash change creating a new entry, shared leases across bindings, world attach / fallback (`degraded`) / switch / unload |
| `animation.test.ts` | Shared cache with independent mixers, one-shot action trigger, stale epoch ignored, release and unload |
| `optional-three.test.ts` | `tryLoadThree()` returns the API when `three` is installed, or `undefined` when it isn't |

---

## Core concepts

### Proxy objects and `SceneAdapter`

```ts
type ProxyObject = {
  id: string;
  position; quaternion; scale; visible: boolean;
  userData: Record<string, unknown>;
};
type SceneAdapter = { add(obj: ProxyObject): void; remove(obj: ProxyObject): void };
```

The projector and runtimes only ever create and mutate `ProxyObject`s. A real renderer implements `SceneAdapter`, for example by creating a `THREE.Mesh` for each proxy and copying transforms across each frame.

### Projection rules (`ThreeProjector.apply`)

For each `RenderEntity` in the snapshot:

1. **First time an id is seen**: create a binding and add a proxy to the scene.
   - The proxy id is `proxy-<entity>`.
   - `shape` comes from `render.shape`, defaulting to `"box"`.
   - `descriptor` comes from `render.type`, defaulting to the shape.
   - An entity with no `render` also increments `metrics.placeholders`.
2. **Every time**: copy position, rotation into the quaternion, and scale. Set `visible = e.visible && e.lifecycle === "alive"`.

Bindings whose ids are missing from the snapshot are removed from the scene and marked `disposed`. Metrics are then recomputed. `drawCalls` is set to the number of visible bindings.

### Cache, leases, and disposal

`RendererCache.load(assetId, contentHash, bytes)` returns a `CacheEntry`:

- a **hit** if the key is already `ready`;
- a **coalesced** result if a parse for that key is in flight;
- otherwise a **miss**, which parses through the `TemplateParser`.

A failed parse returns an entry with `state: "failed"` and leaves nothing in the cache. `acquireLease` and `releaseLease` count users, and releasing the last lease disposes the entry. Entity ids are never part of a cache key.

### Presentation fallbacks

- **`attachWorld({ assetId, contentHash, fallbackAssetId? })`**:
  1. Try the primary asset. Success gives status `ready`.
  2. If that fails, try `fallbackAssetId`. Success gives status `degraded`.
  3. If that fails too, attach a `world-diagnostic` proxy. Status is `failed`.
- **`bindEntity({ entity, assetId?, contentHash?, fallbackAssetId? })`**:
  1. Try the requested asset. The defaults are `primitive/box` and hash `primitive:<assetId>`.
  2. If that fails, try `fallbackAssetId`, defaulting to `primitive/box`.
  3. If that fails too, use the cache's diagnostic entry.

Bytes always come from a `BytesSource`. If the source reports a content hash, it overrides the hash in the request.

### Animation direction

`AnimationDirector.apply(entity, directive)` takes the client's `AnimationDirective`:

- **Locomotion**: changes the current clip only when `action === "none"` and no action hold is active.
- **Playback rate**: `1` when `speed <= 0.2`, otherwise `clamp(speed / 2, 0.5, 1.5)`.
- **New action**: an `action-primary` with a higher `actionEpoch` plays the action clip and holds it for 12 `apply` calls.
- **Stale action**: a lower epoch increments `staleIgnored`.
- **Clip names**: semantic clips map to clip names through `profile`. The default is `{ idle: "Idle", walk: "Walk", run: "Run", "action-primary": "Attack" }`.
- **Driver**: an optional `AnimationDriver` receives `attach`, `play`, `update` (via `tick(dt)`), and `detach`.

---

## Module reference

`src/index.ts` re-exports `types`, `projector`, `visual`, `static-world`, `cache`, `presentation`, `animation`, `optional-three`, and `profiles`.

### `types.ts`

- `PrimitiveShape`: `"box" | "sphere" | "capsule" | "plane" | "line" | "point"`.
- `ProxyObject`.
- `RenderBinding`: `{ entity, descriptor, object, shape, lastFrame, disposed }`.
- `ThreeMetrics`: `frameTimeMs`, `drawCalls`, `visibleBindings`, `primitiveCount`, `creates`, `destroys`, `placeholders`, `overlays`.
- `SceneAdapter`.

### `projector.ts`

- `new ThreeProjector(scene = memoryScene())`, with `apply(snap)`, `binding(id)`, `disposeAll()`, and `metrics`.
- `memoryScene(): SceneAdapter & { objects: ProxyObject[] }`.

### `cache.ts`

- `rendererCacheKey(assetId, contentHash)` returns `"<assetId>@<contentHash>"`.
- Types: `TemplateKind` (`"glb-template" | "primitive" | "diagnostic"`), `ParsedTemplate`, `TemplateParser`, `BytesSource`, `CacheEntryState`, `CacheEntry`, `RendererCacheMetrics`.
- `new RendererCache(parser)`, with methods `get`, `diagnostic`, `keys` (sorted), `load`, `acquireLease`, `releaseLease`, `disposeEntry`, `disposeAll`.
- `MockTemplateParser` is a headless parser. It has `failIds` and `parseCount`, and returns kind `glb-template` for non-empty bytes, otherwise `primitive`.

### `presentation.ts`

- Types: `PresentationStatus`, `VisualWorldRequest`, `EntityVisualRequest`.
- `new PresentationRuntime(scene, cache, source)`:
  - methods: `attachWorld`, `detachWorld`, `switchWorld`, `bindEntity`, `releaseEntity`, `binding`, `bindingCount`, `unload`;
  - fields: `status`, `visualAssetId`, `visualHash`, `fallbackAssetId`, `attachedWorld`.
- `MemoryBytesSource`: `put(assetId, bytes, contentHash)` is chainable. Asset ids in its `missing` set report as unavailable.

### `animation.ts`

- Types: `SemanticClip`, `MockMixer`, `AnimationBinding`, `AnimationDriver`, `AnimationMetrics`.
- `new AnimationDirector(cache, profile?, driver?)`, with methods `bind(entity, entry)`, `apply(entity, directive)`, `binding`, `release`, `unload`, `cacheKeyFor`, `tick(dt)`.

### `visual.ts`

- `VisualResource`: `{ kind: "primitive" | "glb-template", shape, descriptorId, assetKey?, placeholder }`.
- `VisualResourceFactory`: `{ capabilities: { supportsStaticMeshes, supportsSkins, supportsAnimations, supportsDraco, supportsKtx2 }, resolve(key), release(resource) }`.
- `PrimitiveVisualFactory` supports static meshes only. `placeholder` is `true` when the key has no `assetKey`. Also has `liveCount()`.

### `profiles.ts`

- Types: `RendererTarget`, `SceneLightingTarget`, `AppliedVisual`.
- `applyRenderProfile(profile, lighting, devicePixelRatio = 1)`:
  - Copies the profile's tone mapping, exposure, shadows, clear colour, and output colour space.
  - Caps `pixelRatio` at `profile.pixelRatioCap`.
  - Combines the profile's key and fill intensities with the lighting descriptor's colours and angles.
  - The profile and lighting shapes are structural copies of the `conveyor-engine-assets` fields, so this package doesn't import assets at runtime.

### `optional-three.ts`

- `OptionalThree`: `{ GLTFLoader, SkeletonUtils, AnimationMixer }`, the minimal shapes the package uses.
- `tryLoadThree(): Promise<OptionalThree | undefined>` imports `three`, then `three/addons/...`, falling back to `three/examples/jsm/...` for `GLTFLoader.js` and `SkeletonUtils.js`.
- `parseGltf(api, bytes): Promise<unknown>` copies the bytes into an `ArrayBuffer` and calls `GLTFLoader.parse`.

### `static-world.ts`

- `StaticWorldVisualHooks`: `attachScene?`, `detachScene?`, `attachFallback?`, `debugAabb?`, `debugSpawn?`.
- `createStaticWorldVisual(adapter, hooks?)` returns `{ adapter, attach(sceneId), detach(), fallback(reason), debugAabb(...), debugSpawn(...), attachedScene }`.

---

## Usage examples

### Project client frames into a scene

```ts
import { EngineClient } from "conveyor-engine-client";
import { ThreeProjector, memoryScene } from "conveyor-engine-three";

const client = new EngineClient(1);
const scene = memoryScene();                 // or your own SceneAdapter backed by THREE.Scene
const projector = new ThreeProjector(scene);

function frame() {
  projector.apply(client.renderSnapshot());
  // scene.objects now mirrors the visible entities
}
```

### A custom `SceneAdapter`

```ts
import type { SceneAdapter, ProxyObject } from "conveyor-engine-three";

const adapter: SceneAdapter = {
  add(obj: ProxyObject) { /* create a renderer object for obj.id, keep a map */ },
  remove(obj: ProxyObject) { /* dispose the renderer object for obj.id */ },
};
// Each frame, copy obj.position / quaternion / scale / visible to your renderer objects.
```

### Presentation runtime with fallbacks

```ts
import { MemoryBytesSource, MockTemplateParser, PresentationRuntime, RendererCache, memoryScene } from "conveyor-engine-three";

const source = new MemoryBytesSource()
  .put("world.visual", worldBytes, "sha256:v1")
  .put("primitive/box", boxBytes, "sha256:box");
const pres = new PresentationRuntime(memoryScene(), new RendererCache(new MockTemplateParser()), source);

await pres.attachWorld({ assetId: "world.visual", contentHash: "sha256:v1", fallbackAssetId: "primitive/box" });
await pres.bindEntity({ entity: 10, assetId: "pawn", contentHash: "sha256:p" }); // falls back to primitive/box if missing
pres.status; // "ready" | "degraded" | "failed" | ...
```

### Optional real Three.js

```ts
import { tryLoadThree, parseGltf } from "conveyor-engine-three";

const three = await tryLoadThree();
if (three) {
  const gltf = await parseGltf(three, glbBytes);
}
```

---

## Configuration

| Item | Default |
| --- | --- |
| `ThreeProjector` scene | `memoryScene()` |
| `AnimationDirector` clip profile | `{ idle: "Idle", walk: "Walk", run: "Run", "action-primary": "Attack" }` |
| Action hold | 12 `apply` calls (constant) |
| Playback-rate clamp | `[0.5, 1.5]`, `speed / 2`, or `1` when `speed <= 0.2` |
| Entity fallback asset | `primitive/box` |
| `applyRenderProfile` device pixel ratio | `1` |

---

## Relationship to other packages

```
conveyor-engine-core ─┐
conveyor-engine-client ┴─► conveyor-engine-three  (three: optional peer, dynamic import only)
```

- **Consumes** `RenderSnapshot` and `AnimationDirective` from `conveyor-engine-client`, as types only.
- **Does not import** `conveyor-engine-world`, `conveyor-engine-replication`, or `conveyor-engine-assets`. `profiles.ts` copies the assets render-profile shape structurally on purpose.
- **Used by** `conveyor-engine-example`, which lists it as a dependency.

---

## Project layout

```
conveyor-engine-three/
├── package.json, package-lock.json, tsconfig.json, README.md
├── src/
│   ├── index.ts           # barrel
│   ├── types.ts           # ProxyObject, SceneAdapter, metrics
│   ├── projector.ts       # ThreeProjector, memoryScene
│   ├── cache.ts           # RendererCache, MockTemplateParser
│   ├── presentation.ts    # PresentationRuntime, MemoryBytesSource
│   ├── animation.ts       # AnimationDirector
│   ├── visual.ts          # VisualResourceFactory, PrimitiveVisualFactory
│   ├── profiles.ts        # applyRenderProfile
│   ├── optional-three.ts  # tryLoadThree, parseGltf
│   └── static-world.ts    # createStaticWorldVisual
└── test/
    ├── three.test.ts
    ├── presentation.test.ts
    ├── animation.test.ts
    └── optional-three.test.ts
```

---

## License

ISC. Copyright (c) 2026 autonomous1. See `LICENSE` at the root of the [repository](https://github.com/autonomous1/conveyor-engine-packages).

**Repository:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)
