import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const packages = [
  "conveyor-engine-core",
  "conveyor-engine-assets",
  "conveyor-engine-world",
  "conveyor-engine-replication",
  "conveyor-engine-client",
  "conveyor-engine-three",
  "conveyor-engine-transport-ws",
];

type Meta = {
  inputs: Record<string, { imports?: Array<{ path: string }> }>;
  outputs: Record<string, { imports?: Array<{ path: string }> }>;
};

function forbiddenSpecifier(spec: string): boolean {
  if (spec.startsWith("node:")) return true;
  if (spec === "ws" || spec.startsWith("ws/")) return true;
  const base = spec.split("/").pop() ?? spec;
  return base === "live.js" || base === "node-fs.js";
}

function forbiddenInput(input: string): boolean {
  if (input.includes("node:")) return true;
  if (input.includes("/node_modules/ws/") || input.endsWith("/node_modules/ws")) return true;
  const base = input.split("/").pop() ?? input;
  return base === "live.js" || base === "node-fs.js" || base === "ws";
}

function leakedPaths(meta: Meta): string[] {
  const hits: string[] = [];
  for (const [input, info] of Object.entries(meta.inputs)) {
    if (forbiddenInput(input)) hits.push(input);
    for (const imp of info.imports ?? []) {
      if (forbiddenSpecifier(imp.path)) hits.push(imp.path);
    }
  }
  for (const output of Object.values(meta.outputs)) {
    for (const imp of output.imports ?? []) {
      if (forbiddenSpecifier(imp.path)) hits.push(imp.path);
    }
  }
  return hits;
}

/** Browser output must not contain Node specifiers. glTF fixtures use the property key `node`. */
function assertBrowserOutput(text: string): void {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(noComments.includes("require("), false);
  assert.equal(noComments.includes("Buffer."), false);
  const residual = noComments.replace(/([{,\s])node\s*:/g, "$1");
  const at = residual.indexOf("node:");
  assert.equal(at, -1, at === -1 ? "" : residual.slice(Math.max(0, at - 60), at + 60));
}

async function bundleEntry(entry: string, external: string[] = []) {
  return esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
    absWorkingDir: repo,
    external,
  });
}

test("package main entries bundle for the browser", async () => {
  for (const name of packages) {
    const external = name === "conveyor-engine-three" ? ["three"] : [];
    const result = await bundleEntry(join(repo, name, "dist/index.js"), external);
    const text = result.outputFiles[0]?.text ?? "";
    const hits = leakedPaths(result.metafile as Meta);
    assert.deepEqual(hits, [], `${name} bundle leaked ${hits.join(", ")}`);
    assertBrowserOutput(text);
  }
});

test("transport-ws browser bundle connects memoryPair through welcome", async () => {
  const result = await esbuild.build({
    stdin: {
      contents: `
        import { memoryPair, EngineWsServer, EngineWsClient } from "conveyor-engine-transport-ws";
        const pair = memoryPair();
        const server = new EngineWsServer({ onHello: () => 7 });
        server.attach(pair.server);
        const client = new EngineWsClient(pair.client, {});
        client.hello();
        if (client.clientId !== 1) throw new Error("clientId " + client.clientId);
        if (client.ownedEntityId !== 7) throw new Error("owned " + client.ownedEntityId);
        if (!client.reconnectToken) throw new Error("missing token");
      `,
      resolveDir: join(repo, "conveyor-engine-example"),
      sourcefile: "browser-memory.mjs",
    },
    bundle: true,
    platform: "browser",
    format: "esm",
    write: false,
    metafile: true,
    logLevel: "silent",
    absWorkingDir: repo,
  });
  const text = result.outputFiles[0]?.text ?? "";
  assert.deepEqual(leakedPaths(result.metafile as Meta), []);
  assertBrowserOutput(text);
  const dir = await mkdtemp(join(tmpdir(), "ce-browser-"));
  try {
    const file = join(dir, "entry.mjs");
    await writeFile(file, text);
    await import(pathToFileURL(file).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("node subpaths still export the Node APIs", async () => {
  const transport = await import("../conveyor-engine-transport-ws/dist/node.js");
  assert.equal(typeof transport.listenHttp, "function");
  assert.equal(typeof transport.connectUrl, "function");
  assert.equal(typeof transport.socketFromWs, "function");
  const assets = await import("../conveyor-engine-assets/dist/node.js");
  assert.equal(typeof assets.FilesystemAcquisitionProvider, "function");
  assert.equal(typeof assets.resolveUnderRoot, "function");
  const transportMissing = await import("../conveyor-engine-transport-ws/dist/node-unavailable.js");
  assert.throws(() => transportMissing.listenHttp(), /conveyor-engine-transport-ws\/node is Node-only/);
  const assetsMissing = await import("../conveyor-engine-assets/dist/node-unavailable.js");
  assert.throws(() => assetsMissing.resolveUnderRoot(), /conveyor-engine-assets\/node is Node-only/);
  assert.throws(() => new assetsMissing.FilesystemAcquisitionProvider(), /conveyor-engine-assets\/node is Node-only/);
});
