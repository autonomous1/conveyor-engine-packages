import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  AnimationDirector,
  MemoryBytesSource,
  PresentationRuntime,
  RendererCache,
} from "conveyor-engine-three";
import { EngineClient, locomotionFromSpeed } from "conveyor-engine-client";

function viewWire(e) {
  return {
    id: e.id,
    owner: e.owner,
    position: { ...e.position },
    rotation: { ...e.rotation },
    scale: { ...e.scale },
    velocity: { ...e.velocity },
    radius: e.radius,
    replicationVersion: e.replicationVersion,
    inputSeq: e.inputSeq,
    render: e.render,
    actionEpoch: e.actionEpoch,
    action: e.action,
  };
}

/** Keep in sync with conveyor-engine-assets RENDER_PROFILES + DEFAULT_LIGHTING. */
const LIGHTING = {
  keyAzimuthDeg: 35,
  keyElevationDeg: 50,
  keyColor: 0xfff2d6,
  fillSkyColor: 0xc8d8ff,
  fillGroundColor: 0x3a3228,
  environmentIntensity: 1,
};

const PROFILES = {
  "workstation-high": {
    id: "workstation-high",
    antialias: true,
    pixelRatioCap: 2,
    toneMapping: "aces-filmic",
    exposure: 1,
    keyLightIntensity: 1.8,
    fillLightIntensity: 0.35,
    shadows: true,
    shadowMap: "pcfsoft",
    shadowMapSize: 2048,
    bloom: true,
    clearColor: 0x0b0d12,
  },
  "desktop-balanced": {
    id: "desktop-balanced",
    antialias: true,
    pixelRatioCap: 1.5,
    toneMapping: "aces-filmic",
    exposure: 1,
    keyLightIntensity: 1.5,
    fillLightIntensity: 0.45,
    shadows: true,
    shadowMap: "pcf",
    shadowMapSize: 1024,
    bloom: false,
    clearColor: 0x10141c,
  },
  diagnostic: {
    id: "diagnostic",
    antialias: false,
    pixelRatioCap: 1,
    toneMapping: "none",
    exposure: 1,
    keyLightIntensity: 1.1,
    fillLightIntensity: 0.7,
    shadows: false,
    shadowMap: "basic",
    shadowMapSize: 512,
    bloom: false,
    clearColor: 0x202830,
  },
  minimal: {
    id: "minimal",
    antialias: false,
    pixelRatioCap: 1,
    toneMapping: "none",
    exposure: 1,
    keyLightIntensity: 0.9,
    fillLightIntensity: 0.5,
    shadows: false,
    shadowMap: "basic",
    shadowMapSize: 256,
    bloom: false,
    clearColor: 0x111111,
  },
};

const TONE = {
  none: THREE.NoToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  "aces-filmic": THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping ?? THREE.ACESFilmicToneMapping,
  neutral: THREE.NeutralToneMapping ?? THREE.ACESFilmicToneMapping,
};

const SHADOW = {
  basic: THREE.BasicShadowMap,
  pcf: THREE.PCFShadowMap,
  pcfsoft: THREE.PCFSoftShadowMap,
  vsm: THREE.VSMShadowMap,
};

const statusEl = document.getElementById("status");
const statsEl = document.getElementById("stats");
const profileEl = document.getElementById("profile");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
camera.position.set(6, 4, 8);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);

const hemi = new THREE.HemisphereLight(0xc8d8ff, 0x3a3228, 0.45);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff2d6, 1.5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 0.5;
key.shadow.camera.far = 40;
key.shadow.camera.left = -12;
key.shadow.camera.right = 12;
key.shadow.camera.top = 12;
key.shadow.camera.bottom = -12;
scene.add(key);
scene.add(key.target);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x3a404c, roughness: 0.9, metalness: 0.05 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

let content = new THREE.Group();
scene.add(content);
const mixers = [];
let last = performance.now();
let arenaMode = false;
let arenaSim = null;
const MOVE = { maxSpeed: 8, accel: 40, damping: 8, dt: 1 / 20 };
const FOX_URL = "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models/Fox/glTF-Binary/Fox.glb";
const PREY_URL = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@dev/examples/models/gltf/Flamingo.glb";
let skinnedTemplate = null;
let skinnedClips = [];
let skeletonUtils = null;

function setStatus(text) {
  statusEl.textContent = text;
}

function placeKey(azimuthDeg, elevationDeg) {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const r = 12;
  key.position.set(Math.cos(el) * Math.sin(az) * r, Math.sin(el) * r, Math.cos(el) * Math.cos(az) * r);
  key.target.position.set(0, 0, 0);
}

function applyProfile(id) {
  const p = PROFILES[id] ?? PROFILES["desktop-balanced"];
  renderer.setClearColor(p.clearColor);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = TONE[p.toneMapping] ?? THREE.NoToneMapping;
  renderer.toneMappingExposure = p.exposure;
  renderer.shadowMap.enabled = p.shadows;
  renderer.shadowMap.type = SHADOW[p.shadowMap] ?? THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, p.pixelRatioCap));
  key.intensity = p.keyLightIntensity;
  key.color.setHex(LIGHTING.keyColor);
  key.castShadow = p.shadows;
  hemi.intensity = p.fillLightIntensity;
  hemi.color.setHex(LIGHTING.fillSkyColor);
  hemi.groundColor.setHex(LIGHTING.fillGroundColor);
  placeKey(LIGHTING.keyAzimuthDeg, LIGHTING.keyElevationDeg);
  content.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = p.shadows;
      obj.receiveShadow = p.shadows;
      if (obj.material) {
        if (obj.material.map) obj.material.map.colorSpace = THREE.SRGBColorSpace;
        if (obj.material.emissiveMap) obj.material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
        if (obj.material.normalMap) obj.material.normalMap.colorSpace = THREE.NoColorSpace;
        if (obj.material.roughnessMap) obj.material.roughnessMap.colorSpace = THREE.NoColorSpace;
        if (obj.material.metalnessMap) obj.material.metalnessMap.colorSpace = THREE.NoColorSpace;
        if (obj.material.aoMap) obj.material.aoMap.colorSpace = THREE.NoColorSpace;
      }
    }
  });
  return p;
}

function faceMesh(mesh, dx, dz) {
  const speed = Math.hypot(dx, dz);
  if (speed < 0.04) return;
  const target = Math.atan2(dx, dz);
  let d = target - mesh.rotation.y;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  mesh.rotation.y += d * 0.65;
}

function clearContent() {
  for (const m of mixers) m.stopAllAction();
  mixers.length = 0;
  scene.remove(content);
  content.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) mat.dispose?.();
    }
  });
  content = new THREE.Group();
  scene.add(content);
}

function frameContent() {
  const box = new THREE.Box3().setFromObject(content);
  if (!Number.isFinite(box.min.x)) return;
  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(size * 0.6, size * 0.45, size * 0.8));
}

function integrate(s, moveX, moveZ) {
  const { dt, maxSpeed, accel, damping } = MOVE;
  let vx = s.vx + (moveX * maxSpeed - s.vx) * Math.min(1, accel * dt);
  let vz = s.vz + (moveZ * maxSpeed - s.vz) * Math.min(1, accel * dt);
  vx *= Math.max(0, 1 - damping * dt);
  vz *= Math.max(0, 1 - damping * dt);
  const sp = Math.hypot(vx, vz);
  if (sp > maxSpeed && sp > 0) {
    vx *= maxSpeed / sp;
    vz *= maxSpeed / sp;
  }
  return { px: s.px + vx * dt, pz: s.pz + vz * dt, vx, vz };
}

function resolveAabb(px, pz, vx, vz, r, boxes) {
  let x = px;
  let z = pz;
  let nx = 0;
  let nz = 0;
  let hit = false;
  for (const obs of boxes) {
    const minX = obs.minX - r;
    const maxX = obs.maxX + r;
    const minZ = obs.minZ - r;
    const maxZ = obs.maxZ + r;
    if (x <= minX || x >= maxX || z <= minZ || z >= maxZ) continue;
    const pushLeft = x - minX;
    const pushRight = maxX - x;
    const pushDown = z - minZ;
    const pushUp = maxZ - z;
    const smallest = Math.min(pushLeft, pushRight, pushDown, pushUp);
    if (smallest === pushLeft) {
      x = minX;
      vx = Math.min(0, vx);
      nx = -1;
      nz = 0;
    } else if (smallest === pushRight) {
      x = maxX;
      vx = Math.max(0, vx);
      nx = 1;
      nz = 0;
    } else if (smallest === pushDown) {
      z = minZ;
      vz = Math.min(0, vz);
      nx = 0;
      nz = -1;
    } else {
      z = maxZ;
      vz = Math.max(0, vz);
      nx = 0;
      nz = 1;
    }
    hit = true;
  }
  return { px: x, pz: z, vx, vz, nx, nz, hit };
}

function boxMesh(minX, maxX, minZ, maxZ, color) {
  const w = Math.max(0.1, maxX - minX);
  const d = Math.max(0.1, maxZ - minZ);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, 1.2, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 }),
  );
  mesh.position.set((minX + maxX) / 2, 0.6, (minZ + maxZ) / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function pawnMesh(color) {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 0.7, 4, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 }),
  );
  mesh.castShadow = true;
  return mesh;
}

async function loadSkeletonUtils() {
  const mod = await import("three/addons/utils/SkeletonUtils.js");
  return mod.SkeletonUtils ?? mod;
}

async function loadSkinnedTemplate() {
  if (skinnedTemplate) return skinnedTemplate;
  skeletonUtils = await loadSkeletonUtils();
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(FOX_URL);
  skinnedTemplate = gltf.scene;
  skinnedClips = gltf.animations ?? [];
  return skinnedTemplate;
}

function clipNamed(semantic) {
  const want = semantic === "run" ? ["Run"] : semantic === "walk" ? ["Walk"] : ["Survey", "Idle"];
  return skinnedClips.find((c) => want.some((n) => c.name.includes(n))) ?? skinnedClips[0];
}

function makeSkinnedPawn(utils, tint) {
  const root = new THREE.Group();
  const clone = utils.clone(skinnedTemplate);
  clone.scale.setScalar(0.012);
  clone.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      if (obj.material && tint) {
        obj.material = obj.material.clone();
        obj.material.color?.offsetHSL?.(tint, 0, 0);
      }
    }
  });
  root.add(clone);
  const mixer = new THREE.AnimationMixer(clone);
  return { root, mixer, current: "", action: null };
}

function playLocomotion(pawn, semantic) {
  if (!pawn?.mixer) return;
  if (pawn.current === semantic) return;
  const clip = clipNamed(semantic);
  if (!clip) return;
  const next = pawn.mixer.clipAction(clip);
  next.reset().fadeIn(0.12).play();
  pawn.action?.fadeOut(0.12);
  pawn.action = next;
  pawn.current = semantic;
}

async function attachFoxRuntime() {
  const bytes = new Uint8Array(await (await fetch(FOX_URL)).arrayBuffer());
  const utils = await loadSkeletonUtils();
  const loader = new GLTFLoader();
  const source = new MemoryBytesSource().put("character.fox", bytes, "sha256:fox");
  let preyBytes;
  try {
    preyBytes = new Uint8Array(await (await fetch(PREY_URL)).arrayBuffer());
    source.put("character.prey", preyBytes, "sha256:prey");
  } catch {
    preyBytes = undefined;
  }
  const parser = {
    async parse(buf, assetId, contentHash) {
      const gltf = await new Promise((resolve, reject) => {
        const copy = new ArrayBuffer(buf.byteLength);
        new Uint8Array(copy).set(buf);
        loader.parse(copy, "", resolve, reject);
      });
      return {
        templateId: `${assetId}@${contentHash}`,
        kind: "glb-template",
        assetId,
        contentHash,
        clipNames: (gltf.animations ?? []).map((c) => c.name),
        runtime: {
          scene: gltf.scene,
          clips: gltf.animations ?? [],
          scale: assetId.includes("prey") ? 0.015 : 0.012,
        },
      };
    },
  };
  const cache = new RendererCache(parser);
  const presentation = new PresentationRuntime({ add() {}, remove() {} }, cache, source);
  await cache.load("character.fox", "sha256:fox", bytes);
  if (preyBytes) await cache.load("character.prey", "sha256:prey", preyBytes);
  const director = new AnimationDirector(
    cache,
    { idle: "Survey", walk: "Walk", run: "Run", "action-primary": "Attack" },
    {
      attach(binding, template) {
        const runtime = template?.runtime;
        const cloneFn = typeof utils?.clone === "function" ? utils.clone.bind(utils) : (obj) => obj.clone(true);
        const clone = cloneFn(runtime.scene);
        clone.scale.setScalar(runtime.scale ?? 0.012);
        if (runtime.scale !== 0.012) clone.position.y = 1.2;
        const mixer = new THREE.AnimationMixer(clone);
        const root = new THREE.Group();
        root.add(clone);
        binding.driverState = { root, mixer, clips: runtime.clips, action: null, current: "" };
      },
      play(binding, _clip, clipName) {
        const st = binding.driverState;
        if (!st) return;
        const found =
          st.clips.find((c) => c.name === clipName) ??
          st.clips.find((c) => c.name.toLowerCase().includes(String(clipName).toLowerCase())) ??
          (_clip === "idle" ? st.clips.find((c) => /survey|idle/i.test(c.name)) : undefined) ??
          st.clips[0];
        if (!found || st.current === found.name) return;
        const next = st.mixer.clipAction(found);
        next.reset().fadeIn(0.12).play();
        st.action?.fadeOut(0.12);
        st.action = next;
        st.current = found.name;
      },
      update(binding, dt) {
        binding.driverState?.mixer.update(dt);
      },
      detach(binding) {
        binding.driverState?.mixer.stopAllAction();
      },
    },
  );
  return { director, presentation };
}

function addCenterProp(box) {
  const w = box.maxX - box.minX;
  const d = box.maxZ - box.minZ;
  const prop = new THREE.Mesh(
    new THREE.BoxGeometry(w * 0.92, 1.8, d * 0.92),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.55, metalness: 0.08 }),
  );
  prop.position.set((box.minX + box.maxX) / 2, 0.9, (box.minZ + box.maxZ) / 2);
  prop.castShadow = true;
  prop.userData.visualOnly = true;
  content.add(prop);
}

function addAabbDebug(box) {
  const helper = new THREE.Box3Helper(
    new THREE.Box3(new THREE.Vector3(box.minX, 0, box.minZ), new THREE.Vector3(box.maxX, 1.2, box.maxZ)),
    0x66ff99,
  );
  helper.name = "aabb-debug";
  helper.visible = document.getElementById("debug")?.checked !== false;
  content.add(helper);
}

async function loadArena(mode = "idle") {
  const spec = await fetch("./arena.json").then((r) => r.json());
  clearContent();
  arenaMode = true;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.bounds.maxX - spec.bounds.minX, spec.bounds.maxZ - spec.bounds.minZ),
    new THREE.MeshStandardMaterial({ color: 0x2a303a, roughness: 0.95, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  content.add(floor);
  spec.aabbs.forEach((box, i) => {
    if (i === 0) addCenterProp(box);
    else content.add(boxMesh(box.minX, box.maxX, box.minZ, box.maxZ, 0x6b7380));
    addAabbDebug(box);
  });
  let starts = spec.spawnPoints.map((s) => ({ x: s.x, z: s.z, moveX: 0, moveZ: 0 }));
  let ticks = 0;
  if (mode === "wall") {
    starts = [
      { x: -10, z: 0, moveX: 1, moveZ: 0 },
      { x: 10, z: 0, moveX: -1, moveZ: 0 },
    ];
    ticks = spec.ticks;
  } else if (mode === "slide") {
    starts = [
      { x: -4, z: 0, moveX: 1, moveZ: 1 },
      { x: 4, z: 0, moveX: -1, moveZ: 1 },
    ];
    ticks = 24;
  } else if (mode === "bounds") {
    starts = [
      { x: 22, z: 0, moveX: 1, moveZ: 0 },
      { x: -22, z: 0, moveX: -1, moveZ: 0 },
    ];
    ticks = 24;
  } else if (mode === "wander") {
    starts = spec.spawnPoints.map((s, i) => {
      const heading = i === 0 ? 0.35 : Math.PI - 0.4;
      return { x: s.x, z: s.z, moveX: Math.sin(heading), moveZ: Math.cos(heading), heading, kind: "fox" };
    });
    starts.push({ x: 0, z: 8, moveX: 1, moveZ: 0.2, heading: 1.2, kind: "prey" });
    ticks = 1e9;
  }
  const useSkin = document.getElementById("skinned")?.checked;
  let director = null;
  let presentation = null;
  if (useSkin) {
    try {
      setStatus("loading Fox through PresentationRuntime…");
      const pack = await attachFoxRuntime();
      director = pack.director;
      presentation = pack.presentation;
    } catch (err) {
      setStatus(`engine skinned load failed, capsules: ${err.message ?? err}`);
    }
  }
  const pawns = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i];
    const entity = i + 1;
    let mesh;
    let skin = null;
    if (director && presentation) {
      const entry =
        presentation.cache.get(s.kind === "prey" ? "character.prey@sha256:prey" : "character.fox@sha256:fox") ??
        presentation.cache.get("character.fox@sha256:fox");
      if (!entry || entry.state !== "ready") {
        mesh = pawnMesh(i === 0 ? 0x4aa3ff : 0xe07a3d);
        mesh.position.set(s.x, 0.75, s.z);
        content.add(mesh);
        pawns.push({
          mesh,
          px: s.x,
          pz: s.z,
          vx: 0,
          vz: 0,
          moveX: s.moveX,
          moveZ: s.moveZ,
          heading: s.heading ?? Math.atan2(s.moveX, s.moveZ),
          nextTurn: 8 + i * 12,
          gait: "walk",
          entity,
        });
        continue;
      }
      director.bind(entity, entry);
      const st = director.binding(entity)?.driverState;
      mesh = st.root;
      skin = st;
      director.apply(entity, {
        locomotion: s.moveX || s.moveZ ? "walk" : "idle",
        speed: s.moveX || s.moveZ ? 3 : 0,
        action: "none",
        actionEpoch: 0,
      });
    } else {
      mesh = pawnMesh(i === 0 ? 0x4aa3ff : 0xe07a3d);
    }
    mesh.position.set(s.x, skin ? 0 : 0.75, s.z);
    content.add(mesh);
    pawns.push({
      mesh,
      px: s.x,
      pz: s.z,
      vx: 0,
      vz: 0,
      moveX: s.moveX,
      moveZ: s.moveZ,
      heading: s.heading ?? Math.atan2(s.moveX, s.moveZ),
      nextTurn: 8 + i * 12,
      gait: i === 0 ? "run" : "walk",
      role: i === 0 ? "predict" : "remote",
      skin,
      entity,
    });
  }
  applyProfile(profileEl.value);
  camera.position.set(0, 22, 28);
  controls.target.set(0, 0, 0);
  const { AuthoritativeWorld } = await import("conveyor-engine-world");
  const world = new AuthoritativeWorld({ worldVersion: "viewer-arena" });
  world.actorSeparation = true;
  world.setWorldBounds(spec.bounds);
  for (const box of spec.aabbs) {
    world.addObstacle({ id: box.id, minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ });
  }
  for (const p of pawns) {
    p.entity = world.createEntity(0n, { type: "pawn", shape: "capsule" }, p.entity);
    world.enqueue({
      kind: "setTransform",
      entity: p.entity,
      position: { x: p.px, y: 0, z: p.pz },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    world.enqueue({ kind: "setBounds", entity: p.entity, radius: spec.pawnRadius ?? 0.5 });
  }
  const boot = world.commit(0n);
  const client = new EngineClient(1, { delayMs: 180, extraMs: 80 });
  const local = pawns[0];
  if (local) client.connect(local.entity, 1);
  client.applySnapshot({
    kind: "full",
    seq: 1,
    tick: boot.tick,
    lastProcessedInput: 0,
    spawns: boot.entities.map((e) => ({ entity: e.id, view: viewWire(e) })),
    updates: [],
    despawns: [],
  });
  arenaSim = {
    spec,
    pawns,
    tick: 0,
    remaining: ticks,
    mode,
    director,
    presentation,
    world,
    seq: 1,
    snapSeq: 2,
    client,
  };
  setStatus(
    `arena ${mode} · ${spec.bundleId}` +
      (director ? ` · director mixers ${director.metrics.mixers}` : ""),
  );
}

function toIncoming(line) {
  return {
    kind: line.kind,
    seq: line.seq,
    tick: BigInt(line.tick),
    lastProcessedInput: line.lastProcessedInput ?? 0,
    spawns: line.spawns ?? [],
    updates: line.updates ?? [],
    despawns: line.despawns ?? [],
  };
}

async function loadPlayback() {
  const spec = await fetch("./arena.json").then((r) => r.json());
  const raw = await fetch("./replay/arena-wander.jsonl").then((r) => {
    if (!r.ok) throw new Error("missing replay/arena-wander.jsonl — run npm run record:arena");
    return r.text();
  });
  const lines = raw.trim().split("\n").map((l) => JSON.parse(l));
  const header = lines.find((l) => l.type === "header");
  const snaps = lines.filter((l) => l.type === "snap");
  if (!snaps.length) throw new Error("replay has no snapshots");
  clearContent();
  arenaMode = true;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.bounds.maxX - spec.bounds.minX, spec.bounds.maxZ - spec.bounds.minZ),
    new THREE.MeshStandardMaterial({ color: 0x2a303a, roughness: 0.95, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  content.add(floor);
  spec.aabbs.forEach((box, i) => {
    if (i === 0) addCenterProp(box);
    else content.add(boxMesh(box.minX, box.maxX, box.minZ, box.maxZ, 0x6b7380));
    addAabbDebug(box);
  });
  let director = null;
  let presentation = null;
  if (document.getElementById("skinned")?.checked) {
    try {
      const pack = await attachFoxRuntime();
      director = pack.director;
      presentation = pack.presentation;
    } catch (err) {
      setStatus(`skinned load failed: ${err.message ?? err}`);
    }
  }
  const first = toIncoming(snaps[0]);
  const client = new EngineClient(1, { delayMs: 100, extraMs: 80 });
  const owned = first.spawns[0]?.entity ?? first.spawns[0]?.view?.id;
  client.connect(owned, 1);
  client.applySnapshot(first);
  const pawns = [];
  for (const s of first.spawns) {
    const id = s.entity ?? s.view?.id;
    const kind = s.view?.render?.assetKey === "prey" ? "prey" : "fox";
    let mesh;
    let skin = null;
    const entry = presentation?.cache.get(kind === "prey" ? "character.prey@sha256:prey" : "character.fox@sha256:fox")
      ?? presentation?.cache.get("character.fox@sha256:fox");
    if (director && entry?.state === "ready") {
      director.bind(id, entry);
      const st = director.binding(id)?.driverState;
      mesh = st.root;
      skin = st;
    } else {
      mesh = pawnMesh(kind === "prey" ? 0x88cc66 : 0x4aa3ff);
    }
    const pos = s.view?.position ?? { x: 0, y: 0, z: 0 };
    mesh.position.set(pos.x, skin ? 0 : 0.75, pos.z);
    content.add(mesh);
    pawns.push({ mesh, entity: id, px: pos.x, pz: pos.z, vx: 0, vz: 0, moveX: 0, moveZ: 0, skin });
  }
  applyProfile(profileEl.value);
  camera.position.set(0, 22, 28);
  arenaSim = {
    spec,
    pawns,
    tick: 0,
    remaining: snaps.length - 1,
    mode: "playback",
    director,
    presentation,
    client,
    snaps,
    snapIndex: 1,
  };
  setStatus(`playback ${header?.bundleId ?? ""} · ${snaps.length} snaps · no AuthoritativeWorld`);
}

function revive(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && typeof value.$i === "string") return BigInt(value.$i);
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === "object") {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = revive(v);
    return o;
  }
  return value;
}

async function loadLive() {
  const spec = await fetch("./arena.json").then((r) => r.json());
  clearContent();
  arenaMode = true;
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(spec.bounds.maxX - spec.bounds.minX, spec.bounds.maxZ - spec.bounds.minZ),
    new THREE.MeshStandardMaterial({ color: 0x2a303a, roughness: 0.95, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  content.add(floor);
  const liveMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff3344 }),
  );
  liveMarker.position.set(0, 2, 0);
  content.add(liveMarker);
  spec.aabbs.forEach((box, i) => {
    if (i === 0) addCenterProp(box);
    else content.add(boxMesh(box.minX, box.maxX, box.minZ, box.maxZ, 0x6b7380));
    addAabbDebug(box);
  });
  let director = null;
  let presentation = null;
  if (document.getElementById("skinned")?.checked) {
    try {
      const pack = await attachFoxRuntime();
      director = pack.director;
      presentation = pack.presentation;
    } catch {}
  }
  const client = new EngineClient(1, { delayMs: 80, extraMs: 0, predictOwned: false });
  const pawns = [];
  let lastSeq = 0;
  if (globalThis.__ceLiveWs) {
    try { globalThis.__ceLiveWs.close(); } catch {}
  }
  const ws = new WebSocket("ws://127.0.0.1:4174");
  globalThis.__ceLiveWs = ws;
  let lastSnapAt = 0;
  document.onvisibilitychange = () => {
    if (document.visibilityState !== "visible" || ws.readyState !== 1) return;
    if (Date.now() - lastSnapAt < 2500) return;
    ws.send(JSON.stringify({ v: 1, type: "resync" }));
  };
  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({
      v: 1,
      type: "hello",
      protocol: 1,
      world: "example-v1",
      token: globalThis.__ceTok || undefined,
      bundleId: spec.bundleId,
    }));
    setStatus("live hello · waiting welcome");
  });
  ws.addEventListener("error", () => setStatus("live ws failed — start npm run live:arena"));
  ws.addEventListener("message", (ev) => {
    try {
    const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data);
    const msg = revive(JSON.parse(text));
    console.error("live msg", msg.type, msg.envelope?.kind, msg.envelope?.spawns?.length, msg.envelope?.updates?.length);
    if (msg.type === "welcome") {
      if (msg.reconnectToken) globalThis.__ceTok = msg.reconnectToken;
      const owned = Number(msg.ownedEntityId);
      if (Number.isFinite(owned)) client.connect(owned, Number(msg.clientId) || 1);
      lastSeq = 0;
      setStatus(`live welcome client ${msg.clientId} owned ${msg.ownedEntityId ?? "?"} bundle ${msg.bundleId ?? spec.bundleId}`);
    }
    if (msg.type === "reject" || msg.type === "error") {
      setStatus(`live ${msg.type}: ${msg.reason ?? msg.code ?? "?"}`);
      return;
    }
    if (msg.type !== "snapshot" || !msg.envelope) return;
    const env = msg.envelope;
    const seq = Number(env.seq);
    if (env.kind !== "full" && lastSeq > 0 && seq > lastSeq + 1) {
      ws.send(JSON.stringify({ v: 1, type: "resync" }));
    }
    lastSeq = Number.isFinite(seq) ? seq : lastSeq;
    lastSnapAt = Date.now();
    const pre = `live snap ${env.seq} tick ${env.tick} ${env.kind} s${(env.spawns ?? []).length} u${(env.updates ?? []).length}`;
    setStatus(pre);
    const births = [...(env.spawns ?? []), ...(env.updates ?? [])];
    if (!client.connected && births[0]) {
      client.connect(Number(births[0].entity ?? births[0].view?.id), 1);
    }
    for (const s of births) {
      const id = Number(s.entity ?? s.view?.id);
      if (!Number.isFinite(id) || pawns.some((p) => p.entity === id)) continue;
      const prey = s.view?.render?.assetKey === "prey" || id === 3;
      const entry = presentation?.cache.get(prey ? "character.prey@sha256:prey" : "character.fox@sha256:fox")
        ?? presentation?.cache.get("character.fox@sha256:fox");
      let mesh;
      let skin = null;
      if (director && entry?.state === "ready") {
        try {
          director.bind(id, entry);
          skin = director.binding(id)?.driverState ?? null;
          mesh = skin?.root;
        } catch {
          skin = null;
          mesh = undefined;
        }
      }
      if (!mesh) {
        mesh = pawnMesh(id % 2 ? 0xe07a3d : 0x4aa3ff);
        mesh.scale.setScalar(3);
      }
      const pos0 = s.view?.position;
      mesh.position.set(Number(pos0?.x) || 0, skin ? 0 : 2, Number(pos0?.z) || 0);
      content.add(mesh);
      pawns.push({ mesh, entity: id, px: Number(pos0?.x) || 0, pz: Number(pos0?.z) || 0, skin, moveX: 0, moveZ: 0 });
    }
    setStatus(`${pre} · spawned ${pawns.length} from ${births.length} records`);
    try {
      client.applySnapshot({
        kind: env.kind,
        seq: Number(env.seq),
        tick: typeof env.tick === "bigint" ? env.tick : BigInt(env.tick ?? 0),
        lastProcessedInput: Number(env.lastProcessedInput ?? 0),
        spawns: env.spawns ?? [],
        updates: env.updates ?? [],
        despawns: env.despawns ?? [],
      });
      ws.send(JSON.stringify({ v: 1, type: "ack", snapshotSeq: Number(env.seq) }));
      if (env.kind === "delta" && client.renderSnapshot().entities.length === 0) {
        ws.send(JSON.stringify({ v: 1, type: "resync" }));
      }
    } catch (err) {
      setStatus(`live apply failed: ${err.message ?? err} · meshes ${pawns.length}`);
      ws.send(JSON.stringify({ v: 1, type: "resync" }));
    }
    const render = client.renderSnapshot();
    const byId = new Map(render.entities.map((e) => [Number(e.id), e]));
    for (const e of render.entities) {
      const rid = Number(e.id);
      if (!Number.isFinite(rid) || pawns.some((p) => p.entity === rid)) continue;
      const mesh = pawnMesh(rid % 2 ? 0xe07a3d : 0x4aa3ff);
      mesh.position.set(e.position.x, 0.75, e.position.z);
      content.add(mesh);
      pawns.push({ mesh, entity: rid, px: e.position.x, pz: e.position.z, skin: null, moveX: 0, moveZ: 0 });
    }
    arenaSim = { spec, pawns, tick: Number(env.tick ?? 0), remaining: 1e9, mode: "live", director, presentation, client };
    setStatus(`${pre} · render ${render.entities.length} meshes ${pawns.length} content ${content.children.length}`);
    } catch (err) {
      console.error("live handler", err);
      setStatus(`live handler: ${err.message ?? err}`);
    }
  });
  applyProfile(profileEl.value);
  camera.position.set(0, 22, 28);
  controls.target.set(0, 0, 0);
  controls.enabled = true;
  controls.update();
  arenaSim = { spec, pawns, tick: 0, remaining: 1e9, mode: "live", director, presentation, client };
}

function stepPlayback() {
  const line = arenaSim.snaps[arenaSim.snapIndex++];
  if (!line) {
    arenaSim.remaining = 0;
    return;
  }
  arenaSim.client.applySnapshot(toIncoming(line));
  const render = arenaSim.client.renderSnapshot();
  const byId = new Map(render.entities.map((e) => [e.id, e]));
  for (const p of arenaSim.pawns) {
    const view = byId.get(p.entity);
    if (!view) continue;
    p.px = view.position.x;
    p.pz = view.position.z;
    p.mesh.position.set(p.px, p.skin ? 0 : 0.75, p.pz);
    if (view.animation && arenaSim.director) arenaSim.director.apply(p.entity, view.animation);
  }
  arenaSim.tick = Number(line.tick ?? arenaSim.tick + 1);
  arenaSim.lastSnap = { tick: line.tick };
}

function stepArena() {
  if (!arenaSim) return;
  if (arenaSim.mode === "playback") {
    stepPlayback();
    return;
  }
  if (arenaSim.mode === "live") return;
  const r = arenaSim.spec.pawnRadius ?? 0.5;
  for (const p of arenaSim.pawns) {
    if (p.removed) continue;
    if (arenaSim.mode === "wander") {
      if (arenaSim.tick >= (p.nextTurn ?? 0)) {
        p.heading = (p.heading ?? 0) + (Math.random() - 0.5) * Math.PI * 1.4;
        const roll = Math.random();
        p.gait = roll < 0.2 ? "stop" : roll < 0.55 ? "walk" : "run";
        p.nextTurn = arenaSim.tick + 25 + Math.floor(Math.random() * 45);
      }
      const scale = p.gait === "run" ? 1 : p.gait === "walk" ? 0.45 : 0;
      p.moveX = Math.sin(p.heading ?? 0) * scale;
      p.moveZ = Math.cos(p.heading ?? 0) * scale;
    }
    if (arenaSim.world) {
      if (arenaSim.client && p === arenaSim.pawns[0]) {
        arenaSim.client.collectInput({
          moveX: p.moveX,
          moveZ: p.moveZ,
          yaw: p.heading ?? 0,
          buttons: 0,
        });
      }
      arenaSim.world.enqueue({
        kind: "applyInput",
        entity: p.entity,
        moveX: p.moveX,
        moveZ: p.moveZ,
        yaw: p.heading ?? 0,
        seq: arenaSim.seq++,
      });
    } else {
      const moved = integrate(p, p.moveX, p.moveZ);
      const hit = resolveAabb(moved.px, moved.pz, moved.vx, moved.vz, r, arenaSim.spec.aabbs);
      const b = arenaSim.spec.bounds;
      p.px = Math.min(b.maxX - r, Math.max(b.minX + r, hit.px));
      p.pz = Math.min(b.maxZ - r, Math.max(b.minZ + r, hit.pz));
      p.vx = hit.vx;
      p.vz = hit.vz;
      if (arenaSim.mode === "wander" && p.gait !== "stop" && hit.hit) {
        p.heading = (p.heading ?? 0) + Math.PI * 0.7;
        p.nextTurn = arenaSim.tick + 20;
      }
    }
    if (!arenaSim.world) {
      p.mesh.position.set(p.px, p.skin ? 0 : 0.75, p.pz);
      if (p.entity && arenaSim.director) {
        const speed = Math.hypot(p.vx, p.vz);
        arenaSim.director.apply(p.entity, {
          locomotion: p.gait === "stop" ? "idle" : locomotionFromSpeed(speed),
          speed,
          action: "none",
          actionEpoch: 0,
        });
      }
    }
  }
  if (arenaSim.world) {
    const snap = arenaSim.world.commit(BigInt(arenaSim.tick + 1));
    arenaSim.lastSnap = snap;
    for (const id of snap.destroyed) {
      const p = arenaSim.pawns.find((x) => x.entity === id);
      if (!p || p.removed) continue;
      arenaSim.director?.release(p.entity);
      content.remove(p.mesh);
      p.removed = true;
    }
    if (arenaSim.client) {
      arenaSim.client.applySnapshot({
        kind: "delta",
        seq: arenaSim.snapSeq++,
        tick: snap.tick,
        lastProcessedInput: arenaSim.seq - 1,
        spawns: snap.created
          .map((id) => snap.entities.find((e) => e.id === id))
          .filter(Boolean)
          .map((e) => ({ entity: e.id, view: viewWire(e) })),
        updates: snap.entities
          .filter((e) => !snap.created.includes(e.id))
          .map((e) => ({ entity: e.id, view: viewWire(e) })),
        despawns: snap.destroyed.map((id) => ({ entity: id })),
      });
    }
    const presented = arenaSim.client
      ? new Map(arenaSim.client.renderSnapshot().entities.map((e) => [e.id, e]))
      : new Map(snap.entities.map((e) => [e.id, e]));
    for (const p of arenaSim.pawns) {
      if (p.removed) continue;
      const view = presented.get(p.entity) ?? snap.entities.find((e) => e.id === p.entity);
      if (!view) continue;
      const prevX = p.px;
      const prevZ = p.pz;
      p.px = view.position.x;
      p.pz = view.position.z;
      p.vx = view.velocity?.x ?? 0;
      p.vz = view.velocity?.z ?? 0;
      if (view.animation) {
        p.vx = p.vx || (view.animation.speed ?? 0);
      }
      if (arenaSim.mode === "wander" && p.gait !== "stop") {
        const blocked = Math.hypot(p.px - prevX, p.pz - prevZ) < 0.02 && Math.hypot(p.moveX, p.moveZ) > 0.2;
        if (blocked) {
          p.heading = (p.heading ?? 0) + Math.PI * 0.6 + (Math.random() - 0.5);
          p.nextTurn = arenaSim.tick + 12;
        }
      }
      p.mesh.position.set(p.px, p.skin ? 0 : 0.75, p.pz);
      if (Math.hypot(p.moveX, p.moveZ) > 0.05) p.mesh.rotation.y = Math.atan2(p.moveX, p.moveZ);
      if (p.entity && arenaSim.director) {
        const anim = view.animation;
        const speed = anim?.speed ?? Math.hypot(p.vx, p.vz);
        arenaSim.director.apply(p.entity, anim ?? {
          locomotion: p.gait === "stop" ? "idle" : locomotionFromSpeed(speed),
          speed,
          action: "none",
          actionEpoch: 0,
        });
      }
    }
  }
  if (arenaSim.world) {
    arenaSim.tick += 1;
    return;
  }
  for (let i = 0; i < arenaSim.pawns.length; i++) {
    for (let j = i + 1; j < arenaSim.pawns.length; j++) {
      const a = arenaSim.pawns[i];
      const b = arenaSim.pawns[j];
      const dx = b.px - a.px;
      const dz = b.pz - a.pz;
      const dist = Math.hypot(dx, dz);
      const min = r * 2;
      if (dist >= min) continue;
      const nx = dist > 1e-8 ? dx / dist : 1;
      const nz = dist > 1e-8 ? dz / dist : 0;
      const push = (min - Math.max(dist, 1e-8)) / 2;
      a.px -= nx * push;
      a.pz -= nz * push;
      b.px += nx * push;
      b.pz += nz * push;
      a.mesh.position.set(a.px, a.skin ? 0 : 0.75, a.pz);
      b.mesh.position.set(b.px, b.skin ? 0 : 0.75, b.pz);
    }
  }
  arenaSim.tick += 1;
}

function loadDemo() {
  arenaMode = false;
  arenaSim = null;
  clearContent();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x4aa3ff, metalness: 0.25, roughness: 0.35, emissive: 0x112244 }),
  );
  mesh.position.y = 0.7;
  mesh.castShadow = true;
  content.add(mesh);
  applyProfile(profileEl.value);
  frameContent();
  setStatus("demo box (PBR + profile lights)");
}

async function loadBytes(bytes, label) {
  arenaMode = false;
  arenaSim = null;
  clearContent();
  const loader = new GLTFLoader();
  const gltf = await new Promise((resolve, reject) => {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    loader.parse(copy, "", resolve, reject);
  });
  content.add(gltf.scene);
  if (gltf.animations?.length) {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations[0]).play();
    mixers.push(mixer);
  }
  applyProfile(profileEl.value);
  frameContent();
  setStatus(`${label} · clips ${gltf.animations?.length ?? 0} · profile ${profileEl.value}`);
}

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function tick(now) {
  try {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  for (const m of mixers) m.update(dt);
  if (arenaSim && arenaSim.remaining > 0) {
    stepArena();
    arenaSim.remaining -= 1;
    if (arenaSim.remaining === 0) {
      const [a, b] = arenaSim.pawns;
      for (const p of arenaSim.pawns) {
        if (p.entity && arenaSim.director) {
          arenaSim.director.apply(p.entity, { locomotion: "idle", speed: 0, action: "none", actionEpoch: 0 });
        }
      }
      setStatus(
        `${arenaSim.mode} done tick ${arenaSim.tick} · A x=${a.px.toFixed(2)} B x=${b.px.toFixed(2)} · director ${arenaSim.director?.metrics.transitions ?? 0} transitions`,
      );
    }
  }
  if (arenaSim?.director) arenaSim.director.tick(dt);
  if ((arenaSim?.mode === "live" || arenaSim?.mode === "playback") && arenaSim.client) {
    const render = arenaSim.client.renderSnapshot();
    const byId = new Map(render.entities.map((e) => [Number(e.id), e]));
    for (const p of arenaSim.pawns) {
      const view = byId.get(p.entity);
      if (!view) continue;
      const dx = view.position.x - p.px;
      const dz = view.position.z - p.pz;
      p.px = view.position.x;
      p.pz = view.position.z;
      p.mesh.position.set(p.px, p.skin ? 0 : 0.75, p.pz);
      faceMesh(p.mesh, dx, dz);
      if (arenaSim.director) {
        const tickSpeed = Number(view.animation?.speed);
        const speed = Number.isFinite(tickSpeed) && tickSpeed > 0 ? tickSpeed : Math.hypot(dx, dz) / Math.max(dt, 1 / 60);
        arenaSim.director.apply(p.entity, {
          locomotion: locomotionFromSpeed(speed, 0.12, 0.7),
          speed,
          action: "none",
          actionEpoch: 0,
        });
      }
    }
  }
  if (!arenaMode && !arenaSim) {
    content.children[0]?.rotateY?.(dt * 0.15);
  }
  controls.update();
  renderer.render(scene, camera);
  const info = renderer.info;
  const extra = (() => {
    if (!arenaSim) return "";
    const a = arenaSim.pawns[0];
    const b = arenaSim.pawns[1];
    const fmt = (p) => (p ? `${p.px.toFixed(2)},${p.pz.toFixed(2)}` : "—");
    return (
      `\ntick ${arenaSim.tick} mode ${arenaSim.mode} pawns ${arenaSim.pawns.length}` +
      `\nA(${fmt(a)}) B(${b?.removed ? "despawned" : fmt(b)})` +
      `\nclient snaps ${arenaSim.client?.metrics.snapshotReceive ?? 0}`
    );
  })();
  statsEl.textContent = [
    `profile ${profileEl.value}`,
    `tone ${renderer.toneMapping} exp ${renderer.toneMappingExposure}`,
    `shadows ${renderer.shadowMap.enabled} map ${renderer.shadowMap.type}`,
    `calls ${info.render.calls} tris ${info.render.triangles}`,
    `geoms ${info.memory.geometries} tex ${info.memory.textures}${extra}`,
  ].join("\n");
  } catch (err) {
    console.error("tick", err);
    setStatus(`tick: ${err.message ?? err}`);
  }
  requestAnimationFrame(tick);
}

profileEl.addEventListener("change", () => applyProfile(profileEl.value));
document.getElementById("demo").addEventListener("click", loadDemo);
document.getElementById("arena").addEventListener("click", () => loadArena("idle"));
document.getElementById("wall").addEventListener("click", () => loadArena("wall"));
document.getElementById("slide").addEventListener("click", () => loadArena("slide"));
document.getElementById("bounds").addEventListener("click", () => loadArena("bounds"));
document.getElementById("wander").addEventListener("click", () => loadArena("wander"));
document.getElementById("playback").addEventListener("click", () => {
  loadPlayback().catch((err) => setStatus(String(err.message ?? err)));
});
document.getElementById("live")?.addEventListener("click", () => {
  loadLive().catch((err) => setStatus(String(err.message ?? err)));
});
document.getElementById("despawnB").addEventListener("click", () => {
  const b = arenaSim?.pawns[1];
  if (!b || b.removed || !arenaSim.world) return;
  arenaSim.world.enqueue({ kind: "destroy", entity: b.entity });
  setStatus(`destroy queued for B id=${b.entity}`);
});
document.getElementById("spawnB").addEventListener("click", () => {
  const b = arenaSim?.pawns[1];
  if (!b || !b.removed || !arenaSim.world) return;
  b.entity = arenaSim.world.createEntity(0n, { type: "pawn", shape: "capsule" }, 2);
  arenaSim.world.enqueue({
    kind: "setTransform",
    entity: b.entity,
    position: { x: 10, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  arenaSim.world.enqueue({ kind: "setBounds", entity: b.entity, radius: 0.5 });
  const entry = arenaSim.presentation?.cache.get("character.fox@sha256:fox");
  if (arenaSim.director && entry) {
    arenaSim.director.bind(b.entity, entry);
    const st = arenaSim.director.binding(b.entity)?.driverState;
    b.mesh = st.root;
    b.skin = st;
  } else if (!b.mesh) {
    b.mesh = pawnMesh(0xe07a3d);
  }
  b.px = 10;
  b.pz = 0;
  b.removed = false;
  content.add(b.mesh);
  setStatus(`spawn queued B id=${b.entity} · A mixer ${arenaSim.director?.binding(arenaSim.pawns[0].entity) ? "ok" : "missing"}`);
});
document.getElementById("debug")?.addEventListener("change", (ev) => {
  content.traverse((obj) => {
    if (obj.name === "aabb-debug") obj.visible = ev.target.checked;
  });
});
document.getElementById("file").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  if (!file) return;
  setStatus(`loading ${file.name}…`);
  try {
    await loadBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch (err) {
    setStatus(`load failed: ${err.message ?? err}`);
  }
});
addEventListener("resize", resize);
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  setStatus(`loading ${file.name}…`);
  try {
    await loadBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  } catch (err) {
    setStatus(`load failed: ${err.message ?? err}`);
  }
});

resize();
applyProfile("desktop-balanced");
loadDemo();
requestAnimationFrame(tick);
