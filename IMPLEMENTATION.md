# Implementation notes

Identifier choice: positive JavaScript-safe integers (`EntityId`, `ClientId`).
Rotation: quaternion, with planar movement writing yaw into `y/w`.
World storage: packed typed arrays + sparse index map; query order is sorted entity id.
Command order on commit: kind rank, enqueue sequence, entity id.
Snapshots and render snapshots are `Object.freeze`d (shallow children frozen).
Replication: per-client known set, spatial radius relevance, first snapshot full then versioned deltas.
Input: intent only; claimed position/velocity rejected.
Client: one owned entity predicted; remotes interpolated; correction replays unacked inputs.
Three: proxy objects + scene adapter so tests run without `three` installed.

Out of this slice (explicit non-goals still deferred):
hierarchy, rigid body physics, GLTF, live sockets, Colyseus adapter, sharding.

Tick is bigint in engine packages (canonical-v1 `$i`). Packed hot fields stay typed arrays; spawnTick is a parallel bigint[]. Store mutations throw CommitWindowError outside World.commit.

,"Your run (1k entities, 120 ticks, 2 clients)"
Commit,~5.5 ms/tick
Publish,~1.9 ms/tick
Envelopes,~7.6 KB/tick (~3.8 KB/client)
Whole step,~10 ms/tick
