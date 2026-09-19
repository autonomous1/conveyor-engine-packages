import http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { EngineWsClient, type EngineWsClientOptions } from "./client.js";
import type { EngineWsServer } from "./server.js";
import type { TransportSocket } from "./socket.js";

export function socketFromWs(ws: WebSocket): TransportSocket {
  const messages: Array<(text: string) => void> = [];
  const closes: Array<() => void> = [];
  ws.on("message", (data: string | Buffer) => {
    const text = typeof data === "string" ? data : Buffer.from(data).toString("utf8");
    for (const h of messages) h(text);
  });
  ws.on("close", () => {
    for (const h of closes) h();
  });
  return {
    send(text) {
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
    },
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
    onMessage(handler) {
      messages.push(handler);
    },
    onClose(handler) {
      closes.push(handler);
    },
  };
}

export type LiveServer = {
  port: number;
  url: string;
  close: () => Promise<void>;
};

export function listenHttp(engine: EngineWsServer, port = 0): Promise<LiveServer> {
  return new Promise((resolve, reject) => {
    const httpServer = http.createServer();
    const wss = new WebSocketServer({ server: httpServer });
    wss.on("connection", (ws: WebSocket) => {
      engine.attach(socketFromWs(ws));
    });
    httpServer.once("error", reject);
    httpServer.listen(port, "127.0.0.1", () => {
      const addr = httpServer.address();
      const bound = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: bound,
        url: `ws://127.0.0.1:${bound}`,
        close: () =>
          new Promise((res, rej) => {
            wss.close();
            httpServer.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

export function connectUrl(url: string, opts: EngineWsClientOptions = {}): Promise<EngineWsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const sock = socketFromWs(ws);
    const client = new EngineWsClient(sock, opts);
    ws.once("open", () => {
      client.hello();
      resolve(client);
    });
    ws.once("error", reject);
  });
}
