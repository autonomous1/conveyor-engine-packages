function nodeOnly(): never {
  throw new Error("conveyor-engine-transport-ws/node is Node-only");
}

export function socketFromWs(): never {
  nodeOnly();
}

export function listenHttp(): never {
  nodeOnly();
}

export function connectUrl(): never {
  nodeOnly();
}

export type LiveServer = {
  port: number;
  url: string;
  close: () => Promise<void>;
};
