const assert = require("node:assert/strict");
const test = require("node:test");
const dgram = require("node:dgram");
const { OscTransport } = require("../lib/osc-transport");

test("OSC 2 ESM transport sends exact UDP bytes and accepts a synced reply", async t => {
  const receiver = dgram.createSocket("udp4");
  await new Promise(resolve => receiver.bind(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => receiver.close(resolve)));
  const transport = new OscTransport({ target: `127.0.0.1:${receiver.address().port}`, timeoutMs: 1000 });
  t.after(() => transport.close());
  await transport.start();
  const request = new Promise(resolve => receiver.once("message", (packet, peer) => {
    resolve(packet);
    receiver.send(Buffer.from("2f73796e636564002c69000000000001", "hex"), peer.port, peer.address);
  }));
  const reply = await transport.sync();
  assert.equal((await request).toString("hex"), "2f73796e630000002c69000000000001");
  assert.deepEqual(reply, { address: "/synced", args: [{ type: "integer", value: 1 }], oscType: "message" });
});
