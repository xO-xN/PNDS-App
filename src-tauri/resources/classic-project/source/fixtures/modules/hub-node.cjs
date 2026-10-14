// Minimal score server wired through the released module's documented API.
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");
const { createHubConnection } = require("../../modules/hub/hub");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
let offset = 0;
const received = [], controls = [];
const hub = createHubConnection({
  heartbeatMs: 100, peerOfflineMs: 2000, peerPruneMs: 5000,
  reconnectionDelayMs: 100, connectionTimeoutMs: 300,
  now: () => Date.now() + offset,
  summary: () => ({ role: "ensemble", performers: ["phone-one", "phone-two"] }),
  onEvent: (event, payload, sender) => received.push({ event, payload, sender }),
});
app.use(express.json());
app.get("/state", (request, response) => response.json({ hub: hub.snapshot(), received, controls }));
app.get("/", (request, response) => response.send("local performer"));
app.post("/clock", (request, response) => { offset = request.body.offset; response.json(hub.snapshot()); });
app.post("/hub-stop", (request, response) => { hub.stop(); response.json(hub.snapshot()); });
io.on("connection", socket => {
  socket.on("join", ack => ack({ joined: true }));
  socket.on("control", (payload, ack) => {
    controls.push(payload);
    const relayed = hub.send("gesture", payload);
    ack({ accepted: true, relayed });
  });
});
server.listen(Number(process.env.LOCAL_PORT), "127.0.0.1", () => hub.start());
process.on("SIGTERM", () => { hub.stop(); io.close(); server.close(); });
