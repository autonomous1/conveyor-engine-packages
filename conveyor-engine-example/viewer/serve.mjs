import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const packages = join(root, "..", "..");
const pkgRoots = {
  three: join(packages, "conveyor-engine-three", "dist"),
  client: join(packages, "conveyor-engine-client", "dist"),
  core: join(packages, "conveyor-engine-core", "dist"),
  world: join(packages, "conveyor-engine-world", "dist"),
};
const types = {
  ".html": "text/html; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let rel = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  let file = join(root, rel);
  const pkg = rel.match(/^pkg\/(three|client|core|world)\/(.*)$/);
  if (pkg) file = join(pkgRoots[pkg[1]], pkg[2]);
  try {
    const bytes = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("not found " + rel);
  }
});

const port = Number(process.env.PORT ?? 4173);
server.listen(port, () => {
  console.log(`A5 viewer http://127.0.0.1:${port}/`);
});
