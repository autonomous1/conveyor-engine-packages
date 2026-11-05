function nodeOnly(): never {
  throw new Error("conveyor-engine-assets/node is Node-only");
}

export function resolveUnderRoot(): never {
  nodeOnly();
}

export class FilesystemAcquisitionProvider {
  constructor() {
    nodeOnly();
  }
}

export type FilesystemProviderOptions = {
  root: string;
  maxBytes?: number;
};
