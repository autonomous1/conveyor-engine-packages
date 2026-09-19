/**
 * Shared planar integrator used by the authoritative store and the client predictor.
 *
 * `maxSpeed` scales intent into a target velocity and is also the post-damping
 * clamp. With default damping, steady-state speed is below maxSpeed; that is
 * intentional, not a second limiter.
 */
export type PlanarMoveConfig = {
  maxSpeed: number;
  accel: number;
  damping: number;
  dt: number;
};

export type PlanarMoveState = {
  px: number;
  pz: number;
  vx: number;
  vz: number;
  qy: number;
  qw: number;
};

export function integratePlanarMove(
  s: PlanarMoveState,
  moveX: number,
  moveZ: number,
  yaw: number,
  cfg: PlanarMoveConfig,
): PlanarMoveState {
  const dt = cfg.dt;
  let vx = s.vx + (moveX * cfg.maxSpeed - s.vx) * Math.min(1, cfg.accel * dt);
  let vz = s.vz + (moveZ * cfg.maxSpeed - s.vz) * Math.min(1, cfg.accel * dt);
  vx *= Math.max(0, 1 - cfg.damping * dt);
  vz *= Math.max(0, 1 - cfg.damping * dt);
  const sp = Math.hypot(vx, vz);
  if (sp > cfg.maxSpeed && sp > 0) {
    vx *= cfg.maxSpeed / sp;
    vz *= cfg.maxSpeed / sp;
  }
  const half = yaw * 0.5;
  return {
    px: s.px + vx * dt,
    pz: s.pz + vz * dt,
    vx,
    vz,
    qy: Math.sin(half),
    qw: Math.cos(half),
  };
}
