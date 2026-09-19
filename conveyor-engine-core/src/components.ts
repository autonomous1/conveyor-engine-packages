export const ComponentKind = {
  Transform: 1,
  Velocity: 2,
  Bounds: 3,
  Ownership: 4,
  Replication: 5,
  Lifecycle: 6,
  InputState: 7,
} as const;

export type ComponentKind = (typeof ComponentKind)[keyof typeof ComponentKind];

export const ComponentName: Record<ComponentKind, string> = {
  [ComponentKind.Transform]: "Transform",
  [ComponentKind.Velocity]: "Velocity",
  [ComponentKind.Bounds]: "Bounds",
  [ComponentKind.Ownership]: "Ownership",
  [ComponentKind.Replication]: "Replication",
  [ComponentKind.Lifecycle]: "Lifecycle",
  [ComponentKind.InputState]: "InputState",
};
