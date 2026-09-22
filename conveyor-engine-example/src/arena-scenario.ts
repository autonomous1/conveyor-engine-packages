import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AuthoritativeWorld } from "conveyor-engine-world";
import { Replicator } from "conveyor-engine-replication";
import { labelMix, NetworkScheduler, SplitMix64 } from "conveyor-graph-simulator/reference";
import { listenHttp, EngineWsServer } from "conveyor-engine-transport-ws";
import { ARENA_COLLISION, ARENA_BUNDLE_ID, arenaStaticWorld } from "./arena-assets.js";

function unit01(rng: SplitMix64): number {
  return Number(rng.nextU64() >> 11n) / 2 ** 53;
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

export async function recordArenaWander(opts: {
  ticks?: number;
  seed?: number;
  outFile?: string;
  log?: (line: string) => void;
} = {}) {
  const ticks = opts.ticks ?? 240;
  const seed = opts.seed ?? 20260917;
  const rng = new SplitMix64(labelMix(seed, "agent"));
  const stuckRng = new SplitMix64(labelMix(seed, "stuck"));
  const netProfile = { latencyTicks: 2, jitterTicks: 0 };
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
  net.useRng(new SplitMix64(labelMix(seed, "network")));
  net.addPeer("world").addPeer("client:1");
  net.connect("world", "client:1", "snap", netProfile);
  const outbox = new Map<string, unknown>();
  let droppedMissing = 0;
  const boot = world.commit(0n);
  const lines: string[] = [
    JSON.stringify({
      type: "header",
      bundleId: ARENA_BUNDLE_ID,
      authoritativeHash: arena.hash,
      ticks,
      seed: opts.seed ?? 20260917,
      net: netProfile,
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
    // Link-model hash of the scheduled payload, not a wire integrity check.
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
      if (payload) {
        lines.push(JSON.stringify(jsonSafe(payload)));
        outbox.delete(due.payloadHash);
      } else {
        droppedMissing++;
      }
      net.release(due.payloadHash);
    }
  };

  enqueueNet(boot, 0);

  for (let t = 1; t <= ticks; t++) {
    for (const a of agents) {
      if (t >= a.nextTurn) {
        a.heading += (unit01(rng) - 0.5) * Math.PI * 1.4;
        const roll = unit01(rng);
        a.gait = roll < 0.2 ? "stop" : roll < 0.55 ? "walk" : "run";
        a.nextTurn = t + 25 + Math.floor(unit01(rng) * 45);
      }
      const scale = a.gait === "run" ? 1 : a.gait === "walk" ? 0.45 : 0;
      const view = world.store.view(a.id);
      if (view) {
        const moved = Math.hypot(view.velocity.x, view.velocity.z);
        if (scale > 0 && moved < 0.05 && t > 2) {
          a.heading += Math.PI * 0.6 + (unit01(stuckRng) - 0.5);
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
  const horizon = ticks + (netProfile.latencyTicks ?? 0) + (netProfile.jitterTicks ?? 0) + 4;
  for (let extra = 1; extra <= horizon - ticks; extra++) drainNet(ticks + extra);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, lines.join("\n") + "\n");
  return { out, ticks, hash: arena.hash, bundleId: ARENA_BUNDLE_ID, lines: lines.length, droppedMissing };
}

export async function liveArena(port = 4174, opts: { log?: (line: string) => void } = {}) {
  const log = opts.log ?? ((line: string) => console.error(line));
  const arena = arenaStaticWorld();
  const world = new AuthoritativeWorld({ worldVersion: "example-v1" });
  world.actorSeparation = true;
  world.setBundleIdentity(arena.definition.bundleId, arena.hash);
  world.setWorldBounds(ARENA_COLLISION.bounds);
  for (const box of ARENA_COLLISION.aabbs) {
    world.addObstacle({ id: box.id, minX: box.minX, maxX: box.maxX, minZ: box.minZ, maxZ: box.maxZ });
  }
  const rng = new SplitMix64(labelMix(20260917, "agent"));
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
    bundle: { bundleId: arena.definition.bundleId, authoritativeHash: arena.hash },
    onHello: () => {
      const used = new Set<number>();
      for (const cid of server.connected) {
        const rec = server.gateway.get(cid);
        if (rec?.connected && rec.ownedEntity !== undefined) used.add(rec.ownedEntity);
      }
      const free = agents.find((a) => !used.has(a.id));
      // Refuse when every pawn is already owned rather than sharing agents[0].
      return free?.id;
    },
  });
  const replayDir = join(dirname(fileURLToPath(import.meta.url)), "..", "viewer", "replay");
  const metaPath = join(replayDir, `live-meta-${port}.json`);
  await mkdir(replayDir, { recursive: true });
  await writeFile(
    metaPath,
    JSON.stringify({ bundleId: arena.definition.bundleId, authoritativeHash: arena.hash, ws: `ws://127.0.0.1:${port}` }),
  );
  const live = await listenHttp(server, port);
  const net = new NetworkScheduler();
  net.useRng(new SplitMix64(labelMix(20260917, "network")));
  net.addPeer("world").addPeer("client:1");
  net.connect("world", "client:1", "snap", { latencyTicks: 2 });
  const box = new Map<string, { clientId: number; env: NonNullable<ReturnType<Replicator["publish"]> extends Map<number, infer E> ? E : never> }>();
  let t = 0;
  let open = true;
  const timer = setInterval(() => {
    if (!open) return;
    t += 1;
    for (const a of agents) {
      if (t >= a.nextTurn) {
        a.heading += (unit01(rng) - 0.5) * Math.PI;
        a.gait = unit01(rng) < 0.25 ? "stop" : unit01(rng) < 0.6 ? "walk" : "run";
        a.nextTurn = t + 20 + Math.floor(unit01(rng) * 30);
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
    const envs = server.replicator.publish(world, snap);
    const ids = server.connected;
    if (t <= 5 || t % 40 === 0) {
      log("[live] " + JSON.stringify({
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
      // Hash is of a summary for the link model; sendSnapshot still ships `env`.
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
      if (!held) {
        net.release(due.payloadHash);
        continue;
      }
      const cid = Number(String(due.to).replace("client:", "")) || held.clientId;
      server.sendSnapshot(cid, held.env);
      box.delete(due.payloadHash);
      net.release(due.payloadHash);
    }
  }, 50);
  timer.unref();
  const close = live.close;
  live.close = async () => {
    open = false;
    clearInterval(timer);
    await close();
  };
  console.log(JSON.stringify({ live: live.url, bundleId: arena.definition.bundleId, hash: arena.hash, meta: metaPath }));
  return live;
}

const arg = process.argv[2];
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (arg === "live") await liveArena(Number(process.argv[3] ?? 4174));
  else {
    const result = await recordArenaWander({ ticks: Number(arg ?? 240) });
    console.log(JSON.stringify(result, null, 2));
  }
}
