import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = join(here, "../..");

const aliases = {
  "conveyor-engine-core": join(here, "../conveyor-engine-core/src/index.ts"),
  "conveyor-engine-assets": join(here, "../conveyor-engine-assets/src/index.ts"),
  "conveyor-engine-world": join(here, "../conveyor-engine-world/src/index.ts"),
  "conveyor-engine-replication": join(here, "../conveyor-engine-replication/src/index.ts"),
  "conveyor-engine-client": join(here, "../conveyor-engine-client/src/index.ts"),
  "conveyor-engine-three": join(here, "../conveyor-engine-three/src/index.ts"),
  "conveyor-engine-transport-ws": join(here, "../conveyor-engine-transport-ws/src/index.ts"),
  ws: join(here, "./ws-stub.mjs"),
  "conveyor-graph": join(artifacts, "conveyor-graph/src/index.ts"),
  "conveyor-graph-simulator": join(artifacts, "conveyor-graph-simulator/src/index.ts"),
  "conveyor-graph-simulator/reference": join(artifacts, "conveyor-graph-simulator/src/reference/index.ts"),
};

export async function resolve(specifier, context, next) {
  if (aliases[specifier]) {
    return { url: pathToFileURL(aliases[specifier]).href, shortCircuit: true };
  }
  if (specifier.endsWith(".js") && context.parentURL?.startsWith("file:")) {
    try {
      const resolved = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
      if (existsSync(fileURLToPath(resolved))) {
        return { url: resolved.href, shortCircuit: true };
      }
    } catch {
      /* fall through */
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  return next(url, context);
}
