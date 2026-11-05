# Changelog

## 0.2.0

Breaking. The root entry no longer re-exports the filesystem provider. Import it from `conveyor-engine-assets/node`. `http-fetch` stays on the root (it uses `fetch`) and on `./http`.

| Before | After |
| --- | --- |
| `import { FilesystemAcquisitionProvider, resolveUnderRoot } from "conveyor-engine-assets"` | `import { FilesystemAcquisitionProvider, resolveUnderRoot } from "conveyor-engine-assets/node"` |

A browser import of `/node` loads a stub that throws `conveyor-engine-assets/node is Node-only`.
