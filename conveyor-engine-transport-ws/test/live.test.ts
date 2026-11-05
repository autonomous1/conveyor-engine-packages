import assert from "node:assert/strict";
import { test } from "node:test";
import { WebSocket } from "ws";
import { decodeFrame, encodeFrame, EngineWsServer } from "../dist/index.js";
import { connectUrl, listenHttp, socketFromWs } from "../dist/node.js";

test("live listen/connect: welcome, reject bad world, close", async () => {
  const engine = new EngineWsServer({
    compatibility: { protocol: 1, world: "world-v1" },
    onHello: () => 10,
  });
  const live = await listenHttp(engine, 0);
  try {
    let welcome = 0;
    const client = await connectUrl(live.url, {
      compatibility: { protocol: 1, world: "world-v1" },
      onWelcome: () => {
        welcome++;
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(welcome, 1);
    assert.equal(client.clientId, 1);
    assert.ok(client.reconnectToken);

    let reject = "";
    const bad = await connectUrl(live.url, {
      compatibility: { protocol: 1, world: "other" },
      onReject: (m) => {
        reject = m.reason;
      },
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.match(reject, /world/);
    assert.equal(engine.metrics.rejected >= 1, true);

    client.close();
    bad.close();
    await new Promise((r) => setTimeout(r, 30));
    assert.ok(!engine.connected.includes(client.clientId!));
  } finally {
    await live.close();
  }
});

test("live binary frame: utf-8 hello arrives as a Buffer", async () => {
  const engine = new EngineWsServer({
    compatibility: { protocol: 1, world: "world-v1" },
    onHello: () => 10,
  });
  const live = await listenHttp(engine, 0);
  const ws = new WebSocket(live.url);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const welcome = new Promise<unknown>((resolve, reject) => {
      ws.once("message", (data) => {
        const text = typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8");
        resolve(decodeFrame(text));
      });
      ws.once("error", reject);
    });
    ws.send(Buffer.from(encodeFrame({ v: 1, type: "hello", protocol: 1, world: "world-v1" })));
    const msg = await welcome;
    assert.equal((msg as { type?: string }).type, "welcome");
    assert.equal((msg as { ownedEntityId?: number }).ownedEntityId, 10);
  } finally {
    ws.close();
    await live.close();
  }
});

test("socketFromWs decodes ArrayBuffer and Buffer fragments", () => {
  const listeners = new Map<string, Array<(data: unknown) => void>>();
  const ws = {
    readyState: WebSocket.OPEN,
    send() {},
    close() {},
    on(event: string, cb: (data: unknown) => void) {
      const list = listeners.get(event) ?? [];
      list.push(cb);
      listeners.set(event, list);
      return ws;
    },
    once() {
      return ws;
    },
  };
  const sock = socketFromWs(ws as unknown as WebSocket);
  const got: string[] = [];
  sock.onMessage((text) => got.push(text));
  const fire = (data: unknown) => {
    for (const cb of listeners.get("message") ?? []) cb(data);
  };
  const text = '{"ok":1}';
  fire(text);
  fire(new TextEncoder().encode(text).buffer);
  const bytes = Buffer.from(text);
  fire([bytes.subarray(0, 4), bytes.subarray(4)]);
  assert.deepEqual(got, [text, text, text]);
});
