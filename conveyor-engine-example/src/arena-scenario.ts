import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthoritativeWorld } from "conveyor-engine-world";
import { Replicator } from "conveyor-engine-replication";
import { NetworkScheduler, SplitMix64 } from "conveyor-graph-simulator/reference";
import { listenHttp, EngineWsServer } from "conveyor-engine-transport-ws";
import { ARENA_COLLISION, ARENA_BUNDLE_ID, arenaStaticWorld } from "./arena-assets.js";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

export async function recordArenaWander(opts: { ticks?: number; seed?: number; outFile?: string } = {}) {
  const ticks = opts.ticks ?? 240;
  const rng = mulberry32(opts.seed ?? 20260917);
  const arena = arenaStaticWorld();
  const world = new AuthoritativeWorld({ worldVersion: "example-v1" });
  world.actorSeparation = true;
  world.setBundleIdentity(arena.definition.bundleId, arena.hash);
  world.setWorldBounds(ARENA_COLLISION.bounds);
  for (const box of ARENA_COLLISION.aabbs) {
    world.addObstacle({ id: box.id, minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ });
  }
  const agents = ARENA_COLLISION.spawnPoints.map((s, i) => {
    const id = world.createEntity(0n, { type: "pawn", shape: "capsule", assetKey: i === 2 ? "prey" : "fox" }, i + 1);
    world.enqueue({
      kind: "setTransform",
      entity: id,
      position: { x: s.x, y: 0, z: s.z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    world.enqueue({ kind: "setBounds", entity: id, radius: 0.5 });
    return {
      id,
      heading: i === 0 ? 0.35 : Math.PI - 0.4,
      gait: i === 0 ? "run" : "walk",
      nextTurn: 8 + i * 12,
    };
  });
  const extra = world.createEntity(0n, { type: "pawn", shape: "capsule", assetKey: "prey" }, 3);
  world.enqueue({
    kind: "setTransform",
    entity: extra,
    position: { x: 0, y: 0, z: 8 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    scale: { x: 1, y: 1, z: 1 },
  });
  world.enqueue({ kind: "setBounds", entity: extra, radius: 0.5 });
  agents.push({ id: extra, heading: 1.2, gait: "run", nextTurn: 16 });

  const replicator = new Replicator();
  replicator.setAssetCompatibilityHash(arena.hash);
  replicator.connect(1, agents[0]!.id, 64);
  const net = new NetworkScheduler();
  net.useRng(new SplitMix64(opts.seed ?? 20260917));
  net.addPeer("world").addPeer("client:1");
  net.connect("world", "client:1", "snap", { latencyTicks: 2, jitterTicks: 0 });
  const outbox = new Map<string, unknown>();
  const boot = world.commit(0n);
  const lines: string[] = [
    JSON.stringify({
      type: "header",
      bundleId: ARENA_BUNDLE_ID,
      authoritativeHash: arena.hash,
      ticks,
      seed: opts.seed ?? 20260917,
      net: { latencyTicks: 2 },
    }),
  ];

  const enqueueNet = (snap: typeof boot, tick: number) => {
    const envs = replicator.publish(world, snap);
    const env = envs.get(1);
    if (!env) return;
    const payload = {
      type: "snap",
      kind: env.kind,
      seq: env.seq,
      tick: env.tick,
      lastProcessedInput: env.lastProcessedInput,
      worldVersion: env.worldVersion,
      assetsCompatHash: env.assetsCompatHash,
      spawns: env.spawns.map((s) => ({ entity: s.entity, view: s.view })),
      updates: env.updates.map((u) => ({ entity: u.entity, view: u.view })),
      despawns: env.despawns.map((d) => ({ entity: d.entity })),
    };
    const decision = net.send({
      id: `snap-${tick}-${env.seq}`,
      from: "world",
      to: "client:1",
      channel: "snap",
      sendTick: BigInt(tick),
      payload,
    });
    if (decision.outcome !== "drop" && decision.outcome !== "reject" && decision.outcome !== "partition") {
      outbox.set(decision.message.payloadHash, payload);
    }
  };

  const drainNet = (tick: number) => {
    for (const due of net.tick(BigInt(tick))) {
      const payload = outbox.get(due.payloadHash);
      if (payload) lines.push(JSON.stringify(jsonSafe(payload)));
    }
  };

  enqueueNet(boot, 0);
  drainNet(0);

  for (let t = 1; t <= ticks; t++) {
    for (const a of agents) {
      if (t >= a.nextTurn) {
        a.heading += (rng() - 0.5) * Math.PI * 1.4;
        const roll = rng();
        a.gait = roll < 0.2 ? "stop" : roll < 0.55 ? "walk" : "run";
        a.nextTurn = t + 25 + Math.floor(rng() * 45);
      }
      const scale = a.gait === "run" ? 1 : a.gait === "walk" ? 0.45 : 0;
      const view = world.store.view(a.id);
      if (view) {
        const moved = Math.hypot(view.velocity.x, view.velocity.z);
        if (scale > 0 && moved < 0.05 && t > 2) {
          a.heading += Math.PI * 0.6 + (rng() - 0.5);
          a.nextTurn = t + 12;
        }
      }
      world.enqueue({
        kind: "applyInput",
        entity: a.id,
        seq: t,
        moveX: Math.sin(a.heading) * scale,
        moveZ: Math.cos(a.heading) * scale,
        yaw: a.heading,
      });
    }
    const snap = world.commit(BigInt(t));
    enqueueNet(snap, t);
    drainNet(t);
  }

  const out =
    opts.outFile ??
    join(dirname(fileURLToPath(import.meta.url)), "..", "viewer", "replay", "arena-wander.jsonl");
  drainNet(ticks + 2);
  drainNet(ticks + 4);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, lines.join("\n") + "\n");
  return { out, ticks, hash: arena.hash, bundleId: ARENA_BUNDLE_ID, lines: lines.length };
}

export async function liveArena(port = 4174) {
  const arena = arenaStaticWorld();
  const world = new AuthoritativeWorld({ worldVersion: "example-v1" });
  world.actorSeparation = true;
  world.setBundleIdentity(arena.definition.bundleId, arena.hash);
  world.setWorldBounds(ARENA_COLLISION.bounds);
  for (const box of ARENA_COLLISION.aabbs) {
    world.addObstacle({ id: box.id, minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ });
  }
  const rng = mulberry32(20260917);
  const agents = ARENA_COLLISION.spawnPoints.map((s, i) => {
    const id = world.createEntity(0n, { type: "pawn", shape: "capsule", assetKey: "fox" }, i + 1);
    world.enqueue({
      kind: "setTransform",
      entity: id,
      position: { x: s.x, y: 0, z: s.z },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    world.enqueue({ kind: "setBounds", entity: id, radius: 0.5 });
    return { id, heading: i === 0 ? 0.4 : 2.2, gait: "walk" as string, nextTurn: 10 + i * 8 };
  });
  {
    const id = world.createEntity(0n, { type: "pawn", shape: "capsule", assetKey: "prey" }, 3);
    world.enqueue({
      kind: "setTransform",
      entity: id,
      position: { x: 0, y: 0, z: 8 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    });
    world.enqueue({ kind: "setBounds", entity: id, radius: 0.5 });
    agents.push({ id, heading: 1.1, gait: "run", nextTurn: 14 });
  }
  world.commit(0n);
  const server = new EngineWsServer({
    compatibility: { protocol: 1, world: "example-v1" },
    // Handshake identity is protocol+world; bundle hash is carried on snapshots.
    bundle: {},
    onHello: () => agents[0]!.id,
  });
  const metaPath = join(dirname(fileURLToPath(import.meta.url)), "..", "viewer", "replay", "live-meta.json");
  await mkdir(dirname(metaPath), { recursive: true });
  await writeFile(
    metaPath,
    JSON.stringify({ bundleId: arena.definition.bundleId, authoritativeHash: arena.hash }),
  );
  const live = await listenHttp(server, port);
  const net = new NetworkScheduler();
  net.useRng(new SplitMix64(20260917));
  net.addPeer("world").addPeer("client:1");
  net.connect("world", "client:1", "snap", { latencyTicks: 2 });
  const box = new Map<string, { clientId: number; env: NonNullable<ReturnType<Replicator["publish"]> extends Map<number, infer E> ? E : never> }>();
  let t = 0;
  setInterval(() => {
    t += 1;
    for (const a of agents) {
      if (t >= a.nextTurn) {
        a.heading += (rng() - 0.5) * Math.PI;
        a.gait = rng() < 0.25 ? "stop" : rng() < 0.6 ? "walk" : "run";
        a.nextTurn = t + 20 + Math.floor(rng() * 30);
      }
      const scale = a.gait === "run" ? 1 : a.gait === "walk" ? 0.45 : 0;
      world.enqueue({
        kind: "applyInput",
        entity: a.id,
        seq: t,
        moveX: Math.sin(a.heading) * scale,
        moveZ: Math.cos(a.heading) * scale,
        yaw: a.heading,
      });
    }
    const snap = world.commit(BigInt(t));
    server.setTick(BigInt(t));
    for (const id of server.connected) server.replicator.requestResync(id);
    const envs = server.replicator.publish(world, snap);
    const ids = server.connected;
    if (t <= 5 || t % 40 === 0) {
      console.error("[live]", JSON.stringify({
        t,
        connected: ids,
        worldEntities: snap.entities.length,
        pos: snap.entities.map((e) => [e.id, +e.position.x.toFixed(2), +e.position.z.toFixed(2)]),
        published: [...envs.entries()].map(([id, env]) => ({
          id,
          kind: env.kind,
          spawns: env.spawns.length,
          updates: env.updates.length,
        })),
      }));
    }
    for (const clientId of ids) {
      const env = envs.get(clientId);
      if (!env) continue;
      const peer = `client:${clientId}`;
      if (!net.peers.has(peer)) {
        net.addPeer(peer);
        net.connect("world", peer, "snap", { latencyTicks: 2, jitterTicks: 0 });
      }
      const decision = net.send({
        id: `live-${t}-${clientId}-${env.seq}`,
        from: "world",
        to: peer,
        channel: "snap",
        sendTick: BigInt(t),
        payload: jsonSafe({ seq: env.seq, tick: String(env.tick), clientId }),
      });
      if (decision.outcome === "drop" || decision.outcome === "reject" || decision.outcome === "partition") continue;
      box.set(decision.message.payloadHash, { clientId, env });
    }
    for (const due of net.tick(BigInt(t))) {
      const held = box.get(due.payloadHash);
      if (!held) continue;
      const cid = Number(String(due.to).replace("client:", "")) || held.clientId;
      server.sendSnapshot(cid, held.env);
    }
  }, 50);
  console.log(JSON.stringify({ live: live.url, bundleId: arena.definition.bundleId, hash: arena.hash }));
  return live;
}

const arg = process.argv[2];
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("arena-scenario.ts") || process.argv[1]?.endsWith("arena-scenario.js")) {
  if (arg === "live") await liveArena(Number(process.argv[3] ?? 4174));
  else {
    const result = await recordArenaWander({ ticks: Number(arg ?? 240) });
    console.log(JSON.stringify(result, null, 2));
  }
}
