declare module "ws" {
  import type { Server as HttpServer } from "node:http";
  export class WebSocket {
    constructor(url: string);
    static readonly OPEN: number;
    static readonly CONNECTING: number;
    readyState: number;
    send(data: string): void;
    close(): void;
    on(event: "message", cb: (data: string | Buffer) => void): this;
    on(event: "close", cb: () => void): this;
    once(event: "open", cb: () => void): this;
    once(event: "error", cb: (err: Error) => void): this;
  }
  export class WebSocketServer {
    constructor(opts: { server: HttpServer });
    on(event: "connection", cb: (ws: WebSocket) => void): this;
    close(): void;
  }
}
