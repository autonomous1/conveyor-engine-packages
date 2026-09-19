import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  AcquisitionError,
  AssetRuntime,
  FilesystemAcquisitionProvider,
  HttpAcquisitionProvider,
  composeProviders,
  hashBytes,
  parseManifest,
  resolveUnderRoot,
} from "../src/index.ts";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test("resolveUnderRoot rejects traversal and absolute paths", () => {
  const root = "/var/assets";
  assert.equal(resolveUnderRoot(root, "pack/a.glb").endsWith(`${join("pack", "a.glb")}`), true);
  assert.throws(() => resolveUnderRoot(root, "../secret.bin"), AcquisitionError);
  assert.throws(() => resolveUnderRoot(root, "/etc/passwd"), AcquisitionError);
  assert.throws(() => resolveUnderRoot(root, "pack/../../etc/passwd"), AcquisitionError);
});

test("filesystem provider reads relative files under root", async () => {
  const root = await mkdtemp(join(tmpdir(), "cea-fs-"));
  await mkdir(join(root, "pack"));
  const body = bytes('{"ok":true}');
  await writeFile(join(root, "pack", "rules.json"), body);
  const provider = new FilesystemAcquisitionProvider({ root });
  const source = await provider.acquire({ uri: "pack/rules.json" });
  assert.deepEqual([...source.bytes], [...body]);
  assert.equal(source.contentType, "application/json");
  await assert.rejects(() => provider.acquire({ uri: "missing.json" }), (err: unknown) => {
    assert.ok(err instanceof AcquisitionError);
    assert.equal(err.code, "not-found");
    return true;
  });
});

test("http provider uses runtimeUrl, allowlist, and injectable fetch", async () => {
  const payload = bytes("glb-bytes");
  const calls: string[] = [];
  const provider = new HttpAcquisitionProvider({
    allowHosts: ["cdn.example.test"],
    fetch: async (url) => {
      calls.push(url);
      return {
        ok: true,
        status: 200,
        url,
        headers: { get: (n: string) => (n === "content-type" ? "model/gltf-binary" : null) },
        arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
      };
    },
  });
  await assert.rejects(
    () => provider.acquire({ uri: "https://evil.test/a.glb" }),
    (err: unknown) => err instanceof AcquisitionError && err.code === "policy",
  );
  const source = await provider.acquire({
    uri: "arena.visual",
    runtimeUrl: "https://cdn.example.test/world.glb?token=tmp",
  });
  assert.deepEqual([...source.bytes], [...payload]);
  assert.equal(source.uri, "arena.visual");
  assert.equal(calls[0], "https://cdn.example.test/world.glb?token=tmp");
});

test("composeProviders routes memory vs http vs fs", async () => {
  const root = await mkdtemp(join(tmpdir(), "cea-mix-"));
  await writeFile(join(root, "local.bin"), bytes("fs"));
  const fs = new FilesystemAcquisitionProvider({ root });
  const http = new HttpAcquisitionProvider({
    allowHosts: ["cdn.example.test"],
    fetch: async () => ({
      ok: true,
      status: 200,
      url: "https://cdn.example.test/x",
      headers: { get: () => "text/plain" },
      arrayBuffer: async () => bytes("http").buffer,
    }),
  });
  const mixed = composeProviders([fs, http]);
  const fromFs = await mixed.acquire({ uri: "local.bin" });
  assert.equal(new TextDecoder().decode(fromFs.bytes), "fs");
  const fromHttp = await mixed.acquire({ uri: "https://cdn.example.test/x" });
  assert.equal(new TextDecoder().decode(fromHttp.bytes), "http");
});

test("AssetRuntime can load through the filesystem provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "cea-rt-"));
  const json = '{"grid":[1,1]}';
  await writeFile(join(root, "collision.json"), json);
  const manifest = parseManifest({
    formatVersion: 1,
    bundleId: "arena",
    bundleVersion: "1",
    assets: [
      {
        id: "arena.collision",
        kind: "static-collision-scene",
        authority: "authoritative-static",
        version: "1",
        contentHash: hashBytes(bytes(json)),
        runtimeUri: "collision.json",
      },
    ],
  });
  const runtime = new AssetRuntime({
    manifest,
    provider: new FilesystemAcquisitionProvider({ root }),
  });
  const handle = await runtime.request("arena.collision");
  assert.equal(handle.payload?.kind, "json");
  handle.release();
});
