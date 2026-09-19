export type LocomotionState = "idle" | "walk" | "run";

export type AnimationIntent = {
  locomotion: LocomotionState;
  speed: number;
  action: "none" | "action-primary";
  actionEpoch: number;
  profileId?: string;
};

export type LocomotionThresholds = {
  idle: number;
  run: number;
};

export const DEFAULT_LOCOMOTION: LocomotionThresholds = { idle: 0.2, run: 4 };

export function planarSpeed(vx: number, vz: number): number {
  return Math.hypot(vx, vz);
}

export function deriveLocomotion(speed: number, thresholds: LocomotionThresholds = DEFAULT_LOCOMOTION): LocomotionState {
  if (!(speed > thresholds.idle)) return "idle";
  if (speed >= thresholds.run) return "run";
  return "walk";
}

export function intentFromVelocity(
  vx: number,
  vz: number,
  actionEpoch = 0,
  action: AnimationIntent["action"] = "none",
  profileId?: string,
): AnimationIntent {
  const speed = planarSpeed(vx, vz);
  return {
    locomotion: deriveLocomotion(speed),
    speed,
    action: actionEpoch > 0 ? action : "none",
    actionEpoch,
    profileId,
  };
}
