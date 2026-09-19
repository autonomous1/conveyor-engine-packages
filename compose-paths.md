# Compose paths

These engine paths are intended to be wired with `conveyor-graph-compose`
source/transform/branch/merge/sink chains. The packages themselves stay
transport- and graph-agnostic; compose owns topology.

## Authoritative server input

```
Transport source
  → Decode transform
  → Session validation transform
  → Input validation transform   (validateInput)
  → Tick scheduling transform
  → Admit merge
  → Simulation-core sink         (world.enqueue applyInput + commit)
```

## Authoritative publish and replication

```
Completed world snapshot source  (world.commit)
  → Replication relevance transform
  → Per-client delta/full snapshot transform
  → Budget and queue transform
  → Encode transform
  → Transport sink
```

## Client receive

```
Transport source
  → Decode transform
  → Snapshot ordering transform
  → Client replication-store transform
  → Prediction acknowledgment transform
  → Interpolation transform
  → Client render snapshot sink
```

## Client input

```
Device/action source
  → Normalize transform
  → Sequence transform
  → Local prediction transform
  → Input history transform
  → Encode transform
  → Transport sink
```

## Three.js projection

```
Client render snapshot source
  → Render binding transform
  → Transform/property projection transform
  → Debug overlay transform
  → Renderer sink
```

The fixed-step driver retains authority over server tick execution.
Compose must not introduce uncontrolled async across tick boundaries.
