export type LocomotionState = "idle" | "walk" | "run";

export function locomotionFromSpeed(speed: number, idle = 0.2, run = 4): LocomotionState {
  if (!(speed > idle)) return "idle";
  if (speed >= run) return "run";
  return "walk";
}

export function shouldApplyActionEpoch(incoming: number, lastApplied: number): boolean {
  return incoming > lastApplied;
}
