import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SPEC_RE = /\b(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function specifiers(source: string): string[] {
  return [...source.matchAll(SPEC_RE)].map((match) => match[1]!).filter((spec) => spec.length > 0);
}

function follow(fromFile: string, spec: string, kind: "js" | "dts" | "ts"): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const base = resolve(dirname(fromFile), spec);
  const candidates =
    kind === "js"
      ? [base, `${base}.js`]
      : kind === "dts"
        ? [base.replace(/\.js$/, ".d.ts"), `${base}.d.ts`, base]
        : [base.replace(/\.js$/, ".ts"), `${base}.ts`, base];
  return candidates.find((candidate) => isFile(candidate));
}

function walk(entry: string, kind: "js" | "dts" | "ts"): { files: string[]; specs: string[] } {
  const files: string[] = [];
  const specs: string[] = [];
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!isFile(file)) continue;
    files.push(file);
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      specs.push(spec);
      const next = follow(file, spec, kind);
      if (next) queue.push(next);
    }
  }
  return { files, specs };
}

function assertNoSimulator(specs: string[], label: string): void {
  const hit = specs.filter((spec) => spec === "conveyor-graph-simulator" || spec.startsWith("conveyor-graph-simulator/"));
  assert.deepEqual(hit, [], `${label} resolved conveyor-graph-simulator`);
}

test("main source and dist import graphs do not resolve conveyor-graph-simulator", () => {
  const src = walk(join(root, "src/index.ts"), "ts");
  const js = walk(join(root, "dist/index.js"), "js");
  const dts = walk(join(root, "dist/index.d.ts"), "dts");
  assert.ok(src.files.length > 0);
  assert.ok(js.files.length > 0);
  assert.ok(dts.files.length > 0);
  assertNoSimulator(src.specs, "src");
  assertNoSimulator(js.specs, "dist js");
  assertNoSimulator(dts.specs, "dist dts");
  const names = [...src.files, ...js.files, ...dts.files].map((file) => file.split("/").pop());
  assert.equal(names.includes("simulator.ts"), false);
  assert.equal(names.includes("simulator.js"), false);
  assert.equal(names.includes("simulator.d.ts"), false);
  assert.equal(names.includes("simulated-net-path.ts"), false);
  assert.equal(names.includes("simulated-net-path.js"), false);
  assert.equal(names.includes("simulated-net-path.d.ts"), false);
});

test("NetworkScheduler is only named by the sim adapter", () => {
  const hits: string[] = [];
  for (const name of readdirSync(join(root, "src"))) {
    if (!name.endsWith(".ts")) continue;
    const text = readFileSync(join(root, "src", name), "utf8");
    if (text.includes("NetworkScheduler")) hits.push(name);
  }
  hits.sort();
  assert.deepEqual(hits, ["simulated-net-path.ts"]);
});

test("loading the main export does not resolve conveyor-graph-simulator", () => {
  const dir = mkdtempSync(join(tmpdir(), "replication-main-"));
  const hook = join(dir, "deny-simulator.mjs");
  const register = join(dir, "register.mjs");
  const load = join(dir, "load.mjs");
  writeFileSync(
    hook,
    `export async function resolve(specifier, context, nextResolve) {
  if (specifier === "conveyor-graph-simulator" || specifier.startsWith("conveyor-graph-simulator/")) {
    throw new Error("production graph resolved " + specifier);
  }
  return nextResolve(specifier, context);
}
`,
  );
  writeFileSync(
    register,
    `import { register } from "node:module";
await register(${JSON.stringify(pathToFileURL(hook).href)}, import.meta.url);
`,
  );
  writeFileSync(
    load,
    `const mod = await import(process.argv[2]);
if (typeof mod.DirectNetPath !== "function") {
  console.error("missing DirectNetPath");
  process.exit(1);
}
if ("SimulatedNetPath" in mod || "SimulatedReplication" in mod) {
  console.error("simulator symbol on main: " + Object.keys(mod).join(","));
  process.exit(1);
}
`,
  );
  const entry = pathToFileURL(join(root, "dist/index.js")).href;
  assert.equal(existsSync(join(root, "dist/index.js")), true);
  const result = spawnSync(process.execPath, ["--import", register, load, entry], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});
