import assert from "node:assert/strict";
import { test } from "node:test";
import { EngineWsServer, connectUrl, listenHttp } from "../dist/index.js";

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
