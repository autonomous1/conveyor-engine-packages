import { integratePlanarMove } from "conveyor-engine-core";
import type { InputCommand, MovementParams, PredictedState } from "./types.js";
import { DEFAULT_CLIENT_MOVE } from "./types.js";

export function applyMove(state: PredictedState, input: InputCommand, cfg: MovementParams = DEFAULT_CLIENT_MOVE): PredictedState {
  const n = integratePlanarMove(
    {
      px: state.position.x,
      pz: state.position.z,
      vx: state.velocity.x,
      vz: state.velocity.z,
      qy: state.rotation.y,
      qw: state.rotation.w,
    },
    input.moveX,
    input.moveZ,
    input.yaw,
    cfg,
  );
  return {
    position: { x: n.px, y: state.position.y, z: n.pz },
    rotation: { x: 0, y: n.qy, z: 0, w: n.qw },
    velocity: { x: n.vx, y: state.velocity.y, z: n.vz },
  };
}

export function replay(base: PredictedState, inputs: InputCommand[], cfg?: MovementParams): PredictedState {
  let s = {
    position: { ...base.position },
    rotation: { ...base.rotation },
    velocity: { ...base.velocity },
  };
  for (const input of inputs) s = applyMove(s, input, cfg);
  return s;
}

export function dist(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
