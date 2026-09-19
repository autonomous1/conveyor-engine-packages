export const MessageCategory = {
  SessionControl: 1,
  ClientInput: 2,
  InputAck: 3,
  FullSnapshot: 4,
  DeltaSnapshot: 5,
  EntitySpawn: 6,
  EntityUpdate: 7,
  EntityDespawn: 8,
  AuthoritativeEvent: 9,
  ResyncRequest: 10,
  ProtocolError: 11,
  Diagnostic: 12,
} as const;

export type MessageCategory = (typeof MessageCategory)[keyof typeof MessageCategory];

export const ErrorCategory = {
  Protocol: "protocol",
  Session: "session",
  InputSchema: "input-schema",
  InputRate: "input-rate",
  InputSequence: "input-sequence",
  Ownership: "ownership",
  Resource: "resource",
  Internal: "internal",
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];
