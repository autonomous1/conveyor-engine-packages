# Changelog

## 0.2.0

Breaking. The root entry is browser-safe. Node-only helpers moved to `conveyor-engine-transport-ws/node`, and `ws` is an optional peer dependency.

| Before | After |
| --- | --- |
| `import { listenHttp, connectUrl, socketFromWs } from "conveyor-engine-transport-ws"` | `import { listenHttp, connectUrl, socketFromWs } from "conveyor-engine-transport-ws/node"` |
| Node app using `listenHttp` | also `npm i ws` (now a peer) |

`EngineWsServer`, `EngineWsClient`, `memoryPair`, and the codec stay on the root entry. A browser import of `/node` loads a stub that throws `conveyor-engine-transport-ws/node is Node-only`.
