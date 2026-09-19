import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { AcquisitionError, type AcquisitionContext, type AcquisitionProvider, type ByteSource } from "./acquisition.js";

export type FilesystemProviderOptions = {
  /** Directory that all relative runtimeUris resolve under. */
  root: string;
  maxBytes?: number;
};

const FILE_SCHEME = /^file:/i;

export function resolveUnderRoot(root: string, uri: string): string {
  const trimmed = uri.replace(FILE_SCHEME, "");
  if (!trimmed || trimmed.startsWith("memory:") || /^https?:/i.test(trimmed)) {
    throw new AcquisitionError("provider", `filesystem provider cannot acquire ${uri}`);
  }
  if (isAbsolute(trimmed) || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    throw new AcquisitionError("provider", "absolute paths are not allowed");
  }
  const normalized = normalize(trimmed);
  if (normalized.split(sep).includes("..") || normalized.startsWith("..")) {
    throw new AcquisitionError("provider", "path traversal is not allowed");
  }
  const rootAbs = resolve(root);
  const full = resolve(rootAbs, normalized);
  const rel = relative(rootAbs, full);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new AcquisitionError("provider", "resolved path escapes provider root");
  }
  return full;
}

export class FilesystemAcquisitionProvider implements AcquisitionProvider {
  readonly id = "fs";
  readonly root: string;
  private readonly maxBytes: number;

  constructor(opts: FilesystemProviderOptions) {
    if (!opts.root) throw new AcquisitionError("provider", "filesystem root required");
    this.root = resolve(opts.root);
    this.maxBytes = opts.maxBytes ?? 32 * 1024 * 1024;
  }

  accepts(uri: string): boolean {
    if (!uri) return false;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(uri) && !FILE_SCHEME.test(uri)) return false;
    return true;
  }

  async acquire(ctx: AcquisitionContext): Promise<ByteSource> {
    const uri = ctx.uri;
    if (!this.accepts(uri)) {
      throw new AcquisitionError("provider", `filesystem provider cannot acquire ${uri}`);
    }
    const full = resolveUnderRoot(this.root, uri);
    let buf: Buffer;
    try {
      buf = await readFile(full);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new AcquisitionError("not-found", `file not found: ${uri}`);
      throw new AcquisitionError("provider", `read failed for ${uri}: ${(err as Error).message}`);
    }
    if (buf.byteLength > this.maxBytes) {
      throw new AcquisitionError("size-limit", `file exceeds maxBytes (${this.maxBytes})`);
    }
    return { bytes: new Uint8Array(buf), uri, contentType: contentTypeOf(uri) };
  }
}

function contentTypeOf(uri: string): string | undefined {
  const lower = uri.toLowerCase();
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  return undefined;
}
