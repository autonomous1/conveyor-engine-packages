/**
 * Optional real Three.js entry. Never imported by assets/world.
 * Dynamic import so `tsc` and headless CI succeed without the peer installed.
 */
export type OptionalThree = {
  GLTFLoader: new () => {
    parse(data: ArrayBuffer, path: string, onLoad: (gltf: unknown) => void, onError?: (err: unknown) => void): void;
  };
  SkeletonUtils: { clone(root: unknown): unknown };
  AnimationMixer: new (root: unknown) => {
    clipAction(clip: unknown): { play(): unknown; reset(): unknown; setEffectiveWeight(n: number): unknown; stop(): unknown };
    update(dt: number): void;
    stopAllAction(): void;
    uncacheRoot(root: unknown): void;
  };
};

export async function tryLoadThree(): Promise<OptionalThree | undefined> {
  try {
    const dyn = Function("specifier", "return import(specifier)") as (s: string) => Promise<Record<string, unknown>>;
    const three = await dyn("three");
    let extras: Record<string, unknown> = {};
    try {
      extras = { ...extras, ...(await dyn("three/addons/loaders/GLTFLoader.js")) };
    } catch {
      extras = { ...extras, ...(await dyn("three/examples/jsm/loaders/GLTFLoader.js")) };
    }
    try {
      extras = { ...extras, ...(await dyn("three/addons/utils/SkeletonUtils.js")) };
    } catch {
      extras = { ...extras, ...(await dyn("three/examples/jsm/utils/SkeletonUtils.js")) };
    }
    if (!three?.AnimationMixer || !extras.GLTFLoader || !extras.SkeletonUtils) return undefined;
    return {
      GLTFLoader: extras.GLTFLoader as OptionalThree["GLTFLoader"],
      SkeletonUtils: extras.SkeletonUtils as OptionalThree["SkeletonUtils"],
      AnimationMixer: three.AnimationMixer as OptionalThree["AnimationMixer"],
    };
  } catch {
    return undefined;
  }
}

export function parseGltf(api: OptionalThree, bytes: Uint8Array): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const loader = new api.GLTFLoader();
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    loader.parse(copy, "", resolve, reject);
  });
}
