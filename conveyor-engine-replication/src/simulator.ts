/**
 * Publish-phase replication for ReferenceRuntime.
 * Must not propose StateStore changes. Publish is read-only.
 */
import type { ConveyorGraph, StreamAgent } from "conveyor-graph";
import type { RuntimeContext } from "conveyor-graph-simulator/reference";
import type { AuthoritativeWorld, WorldSnapshot } from "conveyor-engine-world";
import { Replicator } from "./replicator.js";
import type { SnapshotEnvelope } from "./types.js";

export class SimulatedReplication {
  readonly replicator: Replicator;
  lastEnvelopes = new Map<number, SnapshotEnvelope>();

  private readonly world: AuthoritativeWorld;
  private readonly snapshotOf: () => WorldSnapshot | undefined;

  constructor(
    world: AuthoritativeWorld,
    snapshotOf: () => WorldSnapshot | undefined,
    replicator: Replicator = new Replicator(),
  ) {
    this.world = world;
    this.snapshotOf = snapshotOf;
    this.replicator = replicator;
  }

  buildPublish(graph: ConveyorGraph, ctx: RuntimeContext): void {
    const host = this;
    graph.define("frame", (agent: StreamAgent) => {
      const snap = host.snapshotOf();
      if (!snap) return agent.payload;
      host.lastEnvelopes = host.replicator.publish(host.world, snap);
      void ctx;
      return { tick: snap.tick, clients: host.lastEnvelopes.size };
    });
  }
}

export { SimulatedNetPath } from "./simulated-net-path.js";
export type { NetBatch, NetDeliver } from "./simulated-net-path.js";
