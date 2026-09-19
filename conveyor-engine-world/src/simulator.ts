/**
 * Bind AuthoritativeWorld to conveyor-graph-simulator ReferenceRuntime phases.
 */
import type { ConveyorGraph, StreamAgent } from "conveyor-graph";
import type { RuntimeContext } from "conveyor-graph-simulator/reference";
import type { EntityId, OwnerId } from "conveyor-engine-core";
import { AuthoritativeWorld } from "./world.js";
import type { RenderDescriptor, WorldSnapshot } from "./types.js";

export type EngineAdmitPayload = {
  type?: string;
  clientId?: number;
  seq?: number;
  moveX?: number;
  moveZ?: number;
  yaw?: number;
  buttons?: number;
  entity?: number;
  create?: { render?: RenderDescriptor; owner?: OwnerId };
  destroy?: EntityId;
  validated?: boolean;
};

export class SimulatedWorld {
  readonly world: AuthoritativeWorld;
  lastSnapshot: WorldSnapshot | undefined;
  owned = new Map<number, EntityId>();

  constructor(world: AuthoritativeWorld = new AuthoritativeWorld()) {
    this.world = world;
  }

  buildAdmit(graph: ConveyorGraph, ctx: RuntimeContext): void {
    graph.define("in", (agent: StreamAgent) => {
      const event = agent.payload as { id?: string; payload?: EngineAdmitPayload; kind?: string };
      const payload = (event?.payload ?? event) as EngineAdmitPayload;
      if (payload && typeof payload === "object" && "position" in payload) {
        ctx.fail(new Error("claimed-authority"), "in");
        return { disposition: "skip" as const };
      }
      return payload;
    });
  }

  buildSim(graph: ConveyorGraph, ctx: RuntimeContext): void {
    const host = this;
    graph.define("step", (agent: StreamAgent) => {
      const tick = ctx.dueTick();
      const payload = agent.payload as EngineAdmitPayload;
      if (payload?.create) {
        const id = host.world.createEntity(tick, payload.create.render, payload.create.owner);
        if (payload.create.owner) host.owned.set(payload.create.owner, id);
      }
      if (payload?.destroy !== undefined) {
        host.world.enqueue({ kind: "destroy", entity: payload.destroy });
      }
      if (payload?.type === "input" || (payload?.clientId && payload?.seq)) {
        const owner = payload.clientId ?? 0;
        const entity = host.owned.get(owner);
        if (entity) {
          if (payload.entity !== undefined && payload.entity !== entity) {
            /* ownership miss: do not mutate */
          } else {
            host.world.enqueue({
              kind: "applyInput",
              entity,
              seq: payload.seq ?? 0,
              moveX: payload.moveX ?? 0,
              moveZ: payload.moveZ ?? 0,
              yaw: payload.yaw ?? 0,
            });
          }
        }
      }
      host.lastSnapshot = host.world.commit(tick);
      ctx.propose({
        vertexId: "step",
        path: ["world"],
        value: host.world.canonicalPlain(),
      });
      return host.lastSnapshot;
    });
  }
}

export function attachSimulatedWorld(world?: AuthoritativeWorld): SimulatedWorld {
  return new SimulatedWorld(world);
}
