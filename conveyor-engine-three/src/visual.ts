import type { RenderKey } from "conveyor-engine-client";
import type { PrimitiveShape } from "./types.js";

export type VisualResource = {
  kind: "primitive" | "glb-template";
  shape: PrimitiveShape;
  descriptorId: string;
  assetKey?: string;
  placeholder: boolean;
};

/**
 * Renderer adapter contract. Asset core never holds THREE objects.
 * A future GLTFLoader adapter implements the same shape.
 */
export interface VisualResourceFactory {
  readonly capabilities: {
    supportsStaticMeshes: boolean;
    supportsSkins: boolean;
    supportsAnimations: boolean;
    supportsDraco: boolean;
    supportsKtx2: boolean;
  };
  resolve(key: RenderKey | undefined): VisualResource;
  release(resource: VisualResource): void;
}

export class PrimitiveVisualFactory implements VisualResourceFactory {
  readonly capabilities = {
    supportsStaticMeshes: true,
    supportsSkins: false,
    supportsAnimations: false,
    supportsDraco: false,
    supportsKtx2: false,
  };
  private live = 0;

  resolve(key: RenderKey | undefined): VisualResource {
    this.live += 1;
    const shape = ((key?.shape as PrimitiveShape) ?? "box");
    return {
      kind: "primitive",
      shape,
      descriptorId: key?.type ?? shape,
      assetKey: key?.assetKey,
      placeholder: !key?.assetKey,
    };
  }

  release(_resource: VisualResource): void {
    this.live = Math.max(0, this.live - 1);
  }

  liveCount(): number {
    return this.live;
  }
}
