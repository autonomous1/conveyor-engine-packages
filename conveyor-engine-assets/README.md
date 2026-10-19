# conveyor-engine-assets

> **Source:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)

Deterministic, provenance-aware asset identity, manifests, and loading for Conveyor Engine. It covers the full path from "what is this asset, who made it, what is its content hash" to "the bytes are here, they match the hash, they are decoded, and something holds a reference to them".

The package keeps two planes apart:

- **Authoritative** assets (collision scenes, rules, spawn metadata, and similar) feed the simulation. They fail closed, never fall back, and drive compatibility hashes.
- **Presentation** assets (visual scenes, models, materials, textures, audio) only affect what is drawn. They can degrade to a fallback, and changing them never changes an authoritative hash.

It has no renderer dependency. GLB files are inspected structurally without `three`, and collision artifacts are flattened into the AABB shape that `conveyor-engine-world` uses.

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

- **Strict manifest schema**: `parseManifest` checks every entry's kind, authority, version, `sha256:` content hash, and runtime URI. It also checks dependencies, license, provenance, and runtime policy. It rejects duplicate ids, secrets or credentials anywhere in the document, signed or tokenized URLs, and absolute or workstation paths.
- **Build-profile evaluation**: `evaluateManifest` applies `development`, `demo`, `release-strict`, `server-authoritative`, and the other profile rules. Examples: missing licenses, missing provenance, or a visual world without an authoritative collision companion.
- **Portable hashing**: a pure-TypeScript SHA-256 (no `node:crypto`) and canonical JSON (sorted keys). The hasher can be swapped with `setBytesHasher`.
- **`AssetRuntime` loader**: verifies hashes, decodes JSON, coalesces identical in-flight requests, and keeps a refcounted cache. It supports pinning, preloading, scoped ownership (client, region), cancellation via `AbortSignal`, dependency loading, presentation fallback, typed failure codes, metrics, and lifecycle events.
- **Pluggable acquisition**: an in-memory provider for tests and fixtures, a filesystem provider with root confinement, an HTTP provider with a host allowlist and timeouts, and `composeProviders` to route between them.
- **Tick-boundary admission**: `AssetAdmissionQueue` loads and pins static authoritative assets before a session starts (fail closed). It stages `authoritative-admitted` assets off-tick and turns them into replayable admission records at a given tick.
- **Collision artifacts**: four representations (AABB, triangle mesh, occupancy grid, primitives). Includes validation and flattening into world-compatible XZ obstacles. Render or `three` fields are rejected on collision data.
- **Static worlds**: resolves a validated `StaticWorldDefinition` (bounds, spawn points, AABBs, and the collision and visual identity) from a manifest plus a collision artifact. Its stable hash ignores visual-only changes.
- **GLB inspection**: `sniffGlb` parses a GLB container and its glTF JSON into a report covering scenes, nodes, meshes, skins, animations, extensions, and transform sanity, checked against declared renderer capabilities. `encodeGlb` builds GLBs for fixtures.
- **Presentation descriptors**: render descriptors with primitive fallbacks, skeletal metadata, animation profiles (`HUMANOID_BASIC_V1`), render quality profiles, and lighting defaults.
- **Pipeline stages**: `createAssetStages` and `runAssetPipeline` provide a four-stage load pipeline. Its stage ids work with `conveyor-graph-compose` style stage lists.
- **Legacy primitive catalog**: `AssetManifest` maps simple keys such as `primitive/box` to render references, using placeholders for unknown keys.

---

## Installation

| Field | Value |
| --- | --- |
| `name` | `conveyor-engine-assets` |
| `version` | `0.0.1` |
| `type` | `module` (ESM only) |
| `exports["."]` | `./dist/index.js` (+ `.d.ts`) |
| `exports["./node"]` | `./dist/node.js` (+ `.d.ts`): filesystem provider |
| `exports["./http"]` | `./dist/http.js` (+ `.d.ts`): HTTP provider |
| `files` | `dist`, `src` |
| `license` | `ISC` |

Inside the monorepo, depend on it by path:

```json
"dependencies": { "conveyor-engine-assets": "file:../conveyor-engine-assets" }
```

> **Note on entry points.** The root barrel (`src/index.ts`) re-exports `node-fs.ts` and `http-fetch.ts` as well as the rest of the package. `node-fs.ts` imports `node:fs/promises` and `node:path` at module load, so importing the root entry pulls in Node built-ins. The `./node` and `./http` subpaths are narrower entry points. They do **not** make the root entry browser-safe. A browser bundle that imports the root needs those Node modules stubbed or tree-shaken.

---

## Dependencies

| Kind | Package | Notes |
| --- | --- | --- |
| dependency | `conveyor-engine-core` | `file:../conveyor-engine-core`. Declared in `package.json`, but no file under `src/` currently imports it. |
| devDependency | `typescript` | `^5.8.2` |
| devDependency | `@types/node` | `^22.10.0` |

Runtime built-ins used: `node:fs/promises` and `node:path` (filesystem provider only), plus global `fetch`, `AbortSignal.timeout`, and optionally `AbortSignal.any` (HTTP provider), and `TextEncoder`/`TextDecoder`.

---

## Build, typecheck, and test

```bash
npm run build       # rm -rf dist && tsc -p tsconfig.json
npm run typecheck   # tsc --noEmit
npm test            # node --experimental-strip-types --import ../test/register.mjs --test test/*.test.ts
```

The `tsconfig.json` targets ES2022 with `module`/`moduleResolution` `Node16`, `strict`, and declarations, compiling `src/` to `dist/`.

How the tests run:

- 12 of the 13 test files import `../src/index.ts` directly. They rely on the shared loader hook at the repository root (`../test/register.mjs`), so they need the monorepo layout.
- `test/static-world.test.ts` imports `../dist/index.js`, so run `npm run build` before `npm test`.

---

## Core concepts

### Authority classes

Every `AssetEntry` has an `authority`:

| Authority | Plane | Behavior |
| --- | --- | --- |
| `authoritative` | simulation | Required by `requireStaticReady`. No fallback. Included in the authoritative compatibility record. |
| `authoritative-static` | simulation | Same as above. Intended for static collision or world data. |
| `authoritative-admitted` | simulation | Loaded mid-session through `AssetAdmissionQueue.stage` and committed at a tick by `takeAdmitted`. |
| `presentation` | render | May degrade to `runtimePolicy.fallbackAssetId`. |
| `presentation-required` | render | Presentation plane. Included in the presentation compatibility record. |
| `development` / `diagnostic` | tooling | Not part of either compatibility record. |

`AssetRuntime.request` only tries a fallback for entries that are **not** authoritative. For authoritative entries, a hash mismatch or a missing asset always fails.

### Content identity and hashing

- `ContentHash` is `sha256:<64 lowercase hex>`, checked by `isContentHash`.
- `hashBytes`, `hashUtf8`, and `hashCanonicalJson` all go through one swappable hasher (`setBytesHasher(fn)`; pass `undefined` to restore the built-in pure-JS SHA-256).
- `canonicalJson` sorts object keys recursively. A top-level or array-element `undefined` becomes `null`, and object properties whose value is `undefined` are dropped. A `bigint` becomes its decimal string, and a `Uint8Array` becomes `{ $bytes: <base64> }`. Functions and symbols throw.

### Compatibility records

- `collectAuthoritativeCompatibility(manifest)` returns the bundle id, version, protocol and schema versions, and the sorted `(id, version, contentHash, kind, authority)` of every authoritative asset.
- `collectPresentationCompatibility` does the same for presentation assets.
- `hashCompatibility` and `authoritativeManifestHash` hash these records. Changing a visual asset never changes the authoritative hash.

### Loader lifecycle

1. `request(id)` looks up the entry. An unknown id fails with `not-found`, and an already-aborted signal fails with `cancelled`.
2. The cache key is `id@version#contentHash`. On a cache hit (unless `runtimePolicy.cache === "none"`) the refcount goes up. Identical in-flight loads are coalesced.
3. On a miss: dependencies are requested and released first. Then the provider acquires the bytes. The runtime enforces `maxBytes`, verifies the hash, and decodes the payload.
4. Decoding produces JSON when the content type contains `json`, the kind is a JSON kind, or the URI ends with `.json`. Otherwise it produces raw bytes.
5. The caller gets an `AssetHandle` with `state`, `payload`, `degraded`, `failureCode`, `snapshot()`, and `release()`.
6. Releasing the last handle disposes the cache entry unless the asset is pinned (`pin(id)`, `preload`, or `runtimePolicy.pin`).

Failures throw `AssetLoadError` with a `code` (`FailureCode`) and an `AssetSnapshot`.

### Admission at tick boundaries

`AssetAdmissionQueue` never touches world state. It produces `AdmissionRecord`s (asset, version, hash, authority, tick, outcome, reason) for the caller to apply and replay:

- `requireStaticReady()` loads and pins every `authoritative` or `authoritative-static` asset. It throws `StaticAdmissionError` listing the missing ids, and returns the authoritative compatibility record on success.
- `stage(id)` resolves an asset off-tick. Unknown ids and non-`authoritative-admitted` assets are staged as errors, so they are rejected at the tick.
- `takeAdmitted(tick, decide?)` turns everything staged into records. An optional `decide` callback can reject individual assets. Rejected handles are released, and accepted ones are pinned.

---

## Module reference

### `types.ts`

Shared type vocabulary:

- **Asset kinds and roles:** `AssetKind` (20 kinds, from `primitive` and `static-collision-scene` to `skinned-character-model`, `world-manifest`, and `custom`), `AuthorityClass`, and `RuntimeRole`.
- **Records:** `LicenseRecord` and `LicenseStatus`, `ProvenanceRecord` and `OriginCategory`, `BuildRecord`, `ValidationRecord`, `RuntimePolicy`, `DependencyRef`, `AssetEntry`, and `EngineManifest`.
- **Compatibility:** `AuthoritativeCompatibility` and `PresentationCompatibility`.
- **Runtime:** `AssetLifecycleState`, `FailureCode`, `AssetMetrics`, `AssetRuntimeEvent`, `LoadedPayload` (`{kind:"json",value}` or `{kind:"bytes",bytes}`), `AssetSnapshot`, `OwnershipScope` (`consumer`, `clientId`, `regionId`, `entityId`), `AdmissionRecord`, and `BuildProfile`.
- **Legacy catalog:** `AssetRecord`, `RenderRef`, and `PrimitiveShape` (`box`, `sphere`, `capsule`, `plane`, `line`, `point`).

### `hash.ts`

`setBytesHasher`, `isContentHash`, `hashBytes`, `hashUtf8`, `hashCanonicalJson`, `canonicalJson`, and the `BytesHasher` type.

### `schema.ts`

- `parseManifest(input)` and `parseManifestJson(text)` throw `ManifestSchemaError`, whose `issues` are `{ path, message }[]`. They require `formatVersion: 1` and a non-empty `bundleId`, `bundleVersion`, and `assets[]`.
- **Rejected content:**
  - Keys named like secrets anywhere in the document: `accessToken`, `signedUrl`, `apiKey`, `secret`, `password`, `cookie`, `authorization`, `authToken`, `privateKey`, and similar.
  - Signed URLs (`X-Amz-`, `token=`, `sig=`, `signature=`, `expires=`).
  - Absolute paths and workstation paths (`/Users`, `/home`, `/tmp`, `/var/folders`).
- `authoritativeAssets` and `presentationAssets` filter entries by plane.
- `collectAuthoritativeCompatibility`, `collectPresentationCompatibility`, and `hashCompatibility` build and hash the compatibility records.
- `evaluateManifest(manifest, profile = "development")` returns `{ ok, errors, warnings }`. Errors:
  - a missing hash or a missing dependency;
  - an unknown or missing license under `release-strict` or `demo`;
  - missing provenance under `release-strict`;
  - a visual world without an authoritative collision companion under `release-strict` or `server-authoritative`.

  It also warns when a visual scene is marked `authoritative-static`.

### `acquisition.ts`

- `AcquisitionProvider` is `{ id, accepts?(uri), acquire(ctx) }`.
- `AcquisitionContext` carries `uri`, `runtimeUrl?`, `headers?`, `signal?`, and `timeoutMs?`. `ByteSource` is `{ bytes, uri, contentType? }`.
- `AcquisitionError` carries a failure `code`.
- `composeProviders(list)` tries each provider whose `accepts` matches. It rethrows the last error, or throws `provider` if no provider matched.

### `fixtures.ts`

- `MemoryAcquisitionProvider`: `register(uri, script | bytes | string)`. It accepts registered URIs and anything starting with `memory:`.
- A `FixtureScript` can set `delayMs` (abortable), `fail`, `cancel`, or `completeAfterAbort`. With `completeAfterAbort` the fixture finishes its delay and then rejects with `stale` if the caller has aborted.
- `FixtureRegistry` is a fluent wrapper around the provider: `put`, `success`, and `fail`.

### `node-fs.ts` (also `./node`)

- `FilesystemAcquisitionProvider({ root, maxBytes = 32 MiB })` reads files relative to `root`. It accepts scheme-less URIs and the file scheme, and rejects other schemes.
- It sets the content type for `.json`, `.glb`, and `.gltf`. A missing file maps to `not-found`.
- `resolveUnderRoot(root, uri)` rejects absolute paths, `..` traversal, and `memory:` or `http:` URIs.

### `http-fetch.ts` (also `./http`)

- `HttpAcquisitionProvider({ allowHosts?, fetch?, maxBytes = 32 MiB, defaultTimeoutMs = 30000 })` fetches `ctx.runtimeUrl ?? ctx.uri`, allowing only `http:` and `https:`.
- With `allowHosts`, hostnames are checked case-insensitively and a miss raises a `policy` error.
- Size is checked against `Content-Length` and again against the body length.
- Error mapping: 404 → `not-found`, an aborted caller signal → `cancelled`, a timeout → `timeout`, anything else → `provider`. `FetchLike` lets you inject a fetch implementation.

### `loader.ts`: `AssetRuntime`

- **Constructor:** `new AssetRuntime({ manifest, provider, maxBytes = 32 MiB })`.
- **Requests:** `request(id, opts)`, `getEntry(id)`, and `cacheSize()`.
- **Pinning:** `pin(id)`, `unpin(id)` (evicts unreferenced entries), and `preload(ids, opts)`, which returns `{ handles, release }` and pins each asset.
- **Ownership:** `notifyRegionLoaded` and `notifyRegionUnloaded(regionId)`, which releases region-scoped handles. `notifyClientDisconnected(clientId)` releases that client's scoped handles.
- **Replacement:** `replaceResource(id, nextHash?)` evicts cached versions and emits `resource-replaced`.
- **Shutdown:** `liveHandleCount()` and `disposeAll()`.
- **Events and metrics:** `on(listener)` (returns an unsubscribe function), `emit(event)`, and `metrics` (request, coalesce, hit/miss, bytes, ready, degraded, failure, cancellation, hash-mismatch, ownership, release, disposal, pin, and admission counters).
- **`RequestOptions`:** `signal`, `role`, `allowFallback` (default true), `scope`, `runtimeUrl`, and `headers`.

### `admission.ts`

`AssetAdmissionQueue(runtime)`: `requireStaticReady`, `stage`, `peek`, `history`, `takeAdmitted`, and `reject(id, tick, reason?)`. Also exports `StaticAdmissionError` and `StagedAdmission`.

### `collision.ts`

- **Artifact shape:** `CollisionArtifact` has `formatVersion: 1`, `representation`, `coordinateSystem` (`y-up` or `z-up`), `unitScale`, `origin`, and `bounds`. Optional fields are `visualAssetId`, `contentHash`, `aabbs`, `mesh`, `grid`, `primitives`, and `spawnPoints`.
- **Parsing:** `parseCollisionArtifact(input)` throws `CollisionParseError` and rejects render or `three` fields. `collisionFromPayload(payload)` requires a JSON payload.
- **Validation:** `validateCollisionArtifact(a)` checks bounds, scale and origin finiteness, per-representation structure, mesh index ranges, and grid cell counts. It warns above 250,000 triangles and reports counts.
- **Flattening:** `collisionToObstacles(a)` returns `{ id, minX, maxX, minZ, maxZ }[]`, the same shape as `conveyor-engine-world`'s `StaticObstacle`. Boxes keep their XZ extent. Spheres and capsules become radius squares. Occupied grid cells become cell boxes, and each mesh triangle becomes its XZ bounding box.

### `static-world.ts`

- **Types:** `StaticWorldDefinition` holds bundle identity, schema and protocol version, coordinate system, unit scale, bounds, `SpawnPoint[]`, `aabbs`, collision asset id and hash, the optional visual asset id and hash, and the optional fallback id.
- **`definitionFromCollision(artifact, opts)`:** spawn points default to the artifact's own (`y` and `yaw` default to 0). `aabbs` are taken **only** from `artifact.aabbs`; other representations produce an empty list here.
- **Hashing:** `staticWorldCompatibilityRecord(def)` and `hashStaticWorld(def)` cover only authoritative fields, so visual ids do not affect the hash.
- **Validation:** `validateStaticWorld(def, profile = "minimal" | "example-arena")` checks that spawns are unique, finite, inside the bounds, and not intersecting any AABB (by clearance). It also checks AABB ids are unique and not inverted. `example-arena` additionally requires at least 2 spawns and 4 AABBs. `assertValidStaticWorld` throws `StaticWorldError`.
- **Manifest lookups:** `collisionAssetFromManifest` and `visualAssetFromManifest` find the authoritative `static-collision-scene` and the presentation `static-visual-scene`.
- **Resolution:** `resolveStaticWorld({ manifest, collision, profile })` returns `{ definition, hash, collision }`. `collision` may be an artifact, a `LoadedPayload`, or raw JSON. `resolveStaticWorldFromParts({ manifestInput, collisionInput, profile })` parses the manifest first.
- **Presentation:** `resolvePresentation(visual, load)` maps a visual load outcome to `idle`, `ready`, `degraded` (when a fallback exists), or `failed`. It is presentation-only.
- **Other exports:** `authoritativeManifestHash` and `parseSpawnPoint`.

### `glb.ts`

- `RendererCapabilities` and `DEFAULT_CAPABILITIES`: static meshes on; skins, animations, Draco, KTX2, material extensions, and instancing off.
- `sniffGlb(bytes, capabilities?)` returns a `GlbValidationReport`:
  - `support`: `static-mesh` or `unsupported`;
  - counts of scenes, nodes, meshes, primitives, materials, textures, images, buffers, accessors, skins, animations, and joints;
  - animation names, used and required extensions, `unsupportedRequired`, scene and node info, `finiteTransforms`, errors, and warnings.
- It throws `GlbParseError` for a short header, missing magic, a missing JSON chunk, or invalid JSON. A required extension the renderer does not support is an error. Skins or animations without declared support are warnings.
- `encodeGlb(doc, bin?)` writes a GLB container.

### `render-descriptor.ts`

- `parseRenderDescriptor(input)` returns an `EngineRenderDescriptor`:
  - `id`, `modelAssetId`, and the scene and node selectors;
  - `fallback` `{ shape, color?, material? }`, where `shape` defaults to `box`;
  - material class, tint, scale and shadow policies, visibility, instancing, and the animation profile id;
  - `placeholderPolicy` `primitive` or `hide`.
- `resolveRenderDescriptor(descriptor, report?)` returns either a `glb-node` (scene index and optional node index, looked up by name across the whole file) or a `primitive` fallback with a reason.
- `parseSkeletalMetadata` handles declarative skeleton metadata (`modelAssetId`, `jointCount`, and so on) with no bone transforms.

### `animation-profile.ts`, `skinned-fixture.ts`

- `AnimationProfile` maps the semantics `idle`, `walk`, `run`, and `action-primary` to clip names, along with fades, speeds, and thresholds. `rootMotion` must be `"disabled"`.
- `validateAnimationProfile(profile, sniffed?)` requires all four aliases. When given a sniffed GLB report, it also requires at least one skin and one animation, and checks that every alias names a real clip.
- `HUMANOID_BASIC_V1` maps the semantics to the clips `Idle`, `Walk`, `Run`, and `Attack`, with walk speed 2 and run speed 5.
- `encodeSkinnedDemoGlb()` builds a tiny one-joint, one-mesh GLB with those four clips, for tests. `SKINNED_DEMO_PROFILE` is an alias for `HUMANOID_BASIC_V1`.

### `render-profile.ts`

- `RENDER_PROFILES` defines `workstation-high`, `desktop-balanced`, `diagnostic`, and `minimal`. Each sets antialiasing, pixel-ratio cap, tone mapping, exposure, environment and PMREM, light intensities, shadow settings, bloom, clear color, fog, and diagnostics level.
- `validateRenderProfile(input)` rejects authoritative keys (`tickRate`, `collision`, `replication`, `canonicalSeed`, `authoritativeHash`, `bundleId`) and returns the built-in profile for `id`. Other fields in the input are not merged.
- `parsePresentationVisual(input)` merges lighting with `DEFAULT_LIGHTING`. `background` defaults to `clear`.

### `compose.ts`

- `createAssetStages({ runtime, admission?, sinks?, sniffGlb? })` returns four stages: `resolve-manifest`, `resolve-deps`, `acquire-verify-decode-own`, and `sink`.
  - The acquire stage sniffs GLB bytes for presentation visual kinds and decodes collision JSON for `static-collision-scene` entries.
  - The sink stage calls `onMetrics`, `onFailure`, `onProvenance`, `onPresentationReady`, and `onAuthoritativeReady`. For `authoritative-admitted` assets it calls `admission.stage` and then `onAuthoritativeStaged`.
- `runAssetPipeline(stages, work, signal?)` runs the stages in order. Thrown errors and aborts become `work.error`; the pipeline does not throw.
- `loadThroughPipeline(opts, assetId, options?)`, `assetComposeStageSpecs(opts)` (`{ id, handler }[]` for `buildConveyorPipeline({ stages })`), and `staticCompatibilityOf(runtime)`.

> The handle obtained by the acquire stage is returned on `work.handle`. The caller owns it and should `release()` it.

### `manifest.ts`

`AssetManifest(seed = BUILTIN_PRIMITIVES)`: `register`, `get`, `has`, `keys` (sorted), `resolve(key)` (returns a `RenderRef`, or a box placeholder for unknown keys), and `loadJson`. This is the legacy key-based catalog used for primitive shapes.

---

## Usage examples

### Parse a manifest and load assets from memory

```ts
import { AssetRuntime, FixtureRegistry, hashBytes, parseManifest } from "conveyor-engine-assets";

const bytes = new TextEncoder().encode('{"grid":[1,0,1]}');
const fixtures = new FixtureRegistry().success("memory:collision", bytes);

const manifest = parseManifest({
  formatVersion: 1,
  bundleId: "arena",
  bundleVersion: "1",
  assets: [{
    id: "arena.collision",
    kind: "static-collision-scene",
    authority: "authoritative-static",
    version: "1.0.0",
    contentHash: hashBytes(bytes),
    runtimeUri: "memory:collision",
    license: { id: "CC0-1.0", status: "spdx" },
  }],
});

const runtime = new AssetRuntime({ manifest, provider: fixtures.provider });
const handle = await runtime.request("arena.collision");
console.log(handle.state, handle.payload); // "ready", { kind: "json", value: { grid: [1,0,1] } }
handle.release();
```

### Filesystem and HTTP providers together

```ts
import { AssetRuntime, composeProviders } from "conveyor-engine-assets";
import { FilesystemAcquisitionProvider } from "conveyor-engine-assets/node";
import { HttpAcquisitionProvider } from "conveyor-engine-assets/http";

const provider = composeProviders([
  new FilesystemAcquisitionProvider({ root: "./assets" }),
  new HttpAcquisitionProvider({ allowHosts: ["cdn.example.com"], defaultTimeoutMs: 10_000 }),
]);
const runtime = new AssetRuntime({ manifest, provider });
```

### Fail-closed static readiness, then tick-boundary admission

```ts
import { AssetAdmissionQueue } from "conveyor-engine-assets";

const admission = new AssetAdmissionQueue(runtime);
const compat = await admission.requireStaticReady(); // throws StaticAdmissionError if anything is missing

await admission.stage("arena.rules-patch");          // off-tick
const records = admission.takeAdmitted(42n);         // on the tick boundary
// apply accepted records to the world yourself and log them for replay
```

### Resolve a static world

```ts
import { resolveStaticWorld, collisionToObstacles } from "conveyor-engine-assets";

const { definition, hash, collision } = resolveStaticWorld({
  manifest,
  collision: handle.payload,      // LoadedPayload, artifact, or raw JSON
  profile: "example-arena",
});
const obstacles = collisionToObstacles(collision); // world StaticObstacle-shaped AABBs
```

### Inspect a GLB and pick a render path

```ts
import { sniffGlb, parseRenderDescriptor, resolveRenderDescriptor } from "conveyor-engine-assets";

const report = sniffGlb(glbBytes);
const desc = parseRenderDescriptor({ id: "crate", modelAssetId: "props.crate", nodeSelector: "Crate", fallback: { shape: "box" } });
const resolved = resolveRenderDescriptor(desc, report);
if (resolved.kind === "primitive") console.warn("fallback:", resolved.reason);
```

---

## Configuration

| Option | Where | Default | Effect |
| --- | --- | --- | --- |
| `maxBytes` | `AssetRuntimeOptions` | 32 MiB | Rejects larger payloads with `size-limit`. |
| `maxBytes` | `FilesystemProviderOptions`, `HttpProviderOptions` | 32 MiB | Provider-level size limit. |
| `allowHosts` | `HttpProviderOptions` | none (any host) | Host allowlist, compared case-insensitively. |
| `defaultTimeoutMs` | `HttpProviderOptions` | 30000 | Overridden per entry by `runtimePolicy.timeoutMs`. `<= 0` disables the timeout. |
| `fetch` | `HttpProviderOptions` | global `fetch` | Injectable `FetchLike`. |
| `sniffGlb` | `AssetPipelineOptions` | `true` | Whether the acquire stage sniffs presentation GLBs. |
| `runtimePolicy.cache` | `AssetEntry` | cached | `"none"` skips the cache. `"memory"` and `"refcount"` are accepted but behave the same. |
| `runtimePolicy.pin` | `AssetEntry` | `false` | Keeps the payload after the last release. |
| `runtimePolicy.fallbackAssetId` | `AssetEntry` | none | Presentation-only degrade target. |
| `runtimePolicy.timeoutMs` | `AssetEntry` | provider default | Passed to the provider as `timeoutMs`. |

`runtimePolicy.preload`, `runtimePolicy.retryLimit`, and `runtimePolicy.disposeOnRelease` are parsed and validated, but the loader does not act on them. There is no retry loop, and `metrics.retryCount` and each snapshot's `retryCount` stay at 0. Call `preload()` explicitly if you want preloading. `requiredExtensions` on an entry is parsed but not checked against GLB contents; `sniffGlb` checks the GLB's own `extensionsRequired` instead.

---

## Relationship to other packages

| Package | Relationship |
| --- | --- |
| `conveyor-engine-core` | Declared dependency (`file:../conveyor-engine-core`). No source file imports it today. |
| `conveyor-engine-world` | Depends on this package. It uses collision artifacts, `collisionToObstacles`, static-world definitions, and compatibility hashing to load authoritative static worlds. |
| `conveyor-engine-example` | Depends on this package to build the arena manifest, collision, and visual assets and to drive presentation loading. |
| `conveyor-engine-three` | No direct dependency. Render descriptors, render profiles, and GLB reports are designed as renderer-agnostic inputs for a presentation layer. |
| `conveyor-graph-compose` | Not a dependency. `assetComposeStageSpecs` produces `{ id, handler }` stages that fit `buildConveyorPipeline({ stages })`. |

---

## Project layout

```
conveyor-engine-assets/
├── package.json, tsconfig.json, README.md
├── src/
│   ├── index.ts              # barrel (re-exports everything below, including node-fs and http-fetch)
│   ├── node.ts               # ./node subpath → FilesystemAcquisitionProvider, resolveUnderRoot
│   ├── http.ts               # ./http subpath → HttpAcquisitionProvider
│   ├── types.ts              # kinds, authorities, records, manifest, metrics, events
│   ├── hash.ts               # portable SHA-256, canonical JSON
│   ├── schema.ts             # parseManifest, evaluateManifest, compatibility records
│   ├── acquisition.ts        # provider contract, AcquisitionError, composeProviders
│   ├── fixtures.ts           # MemoryAcquisitionProvider, FixtureRegistry
│   ├── node-fs.ts            # filesystem provider
│   ├── http-fetch.ts         # HTTP provider
│   ├── loader.ts             # AssetRuntime, AssetHandle, AssetLoadError
│   ├── admission.ts          # AssetAdmissionQueue
│   ├── collision.ts          # collision artifacts and flattening
│   ├── static-world.ts       # static world definitions and hashing
│   ├── glb.ts                # sniffGlb, encodeGlb
│   ├── render-descriptor.ts  # render descriptors, skeletal metadata
│   ├── render-profile.ts     # render quality profiles, lighting
│   ├── animation-profile.ts  # animation profiles, HUMANOID_BASIC_V1
│   ├── skinned-fixture.ts    # tiny skinned GLB fixture
│   ├── compose.ts            # pipeline stages
│   └── manifest.ts           # legacy primitive catalog
└── test/
    ├── admission.test.ts
    ├── animation-profile.test.ts
    ├── assets.test.ts
    ├── collision.test.ts
    ├── compose.test.ts
    ├── glb.test.ts
    ├── loader.test.ts
    ├── ownership.test.ts
    ├── providers.test.ts
    ├── render-profile.test.ts
    ├── schema.test.ts
    ├── skinned-fixture.test.ts
    └── static-world.test.ts
```

---

## License

ISC. Copyright (c) 2026 autonomous1. See `LICENSE` at the root of the [repository](https://github.com/autonomous1/conveyor-engine-packages).

**Repository:** [conveyor-engine-packages on GitHub](https://github.com/autonomous1/conveyor-engine-packages)
