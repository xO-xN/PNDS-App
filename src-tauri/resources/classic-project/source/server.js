// PNDS Template — score server entry point.
//
// Composition root: wires the reusable core (lib/) to the work layer
// (audio/controller.js):
// - serves performer + monitor pages from public/ on both ports
// - exposes /__pnds/health on both ports
// - attaches the performer protocol (join / claim / restore / control —
//   lib/protocol.js owns the semantics)
// - shuts down cleanly on SIGINT / SIGTERM

const path = require("node:path");
const libraries = require("./lib/shared-libraries");
const express = libraries.requireLibrary("express");

const {
  loadManifest,
  parseCliOptions,
  printUsage,
  resolveAudioMode,
  resolveOscTarget,
  resolvePerformerUrl,
  resolveServerConfig,
  formatAudioMode,
} = require("./lib/config");
const { resolveHostLanIp } = require("./lib/network");
const { HealthTracker } = require("./lib/health");
const { AudioEngine } = require("./lib/audio-engine");
const { PlayerRegistry } = require("./lib/players");
const { SeatsStore } = require("./lib/seats-store");
const { qrHandler } = require("./lib/qr");
const { attachProtocol } = require("./lib/protocol");
const { attachMonitorState } = require("./lib/monitor-state");
const { ProjectAudio } = require("./audio/controller");
const {
  attachShutdown,
  closeHttpServer,
} = require("./lib/lifecycle");
const shared = require("./public/shared");

const PROJECT_ROOT = __dirname;

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------

const manifest = loadManifest(PROJECT_ROOT);
const cliOptions = parseCliOptions(process.argv.slice(2));

if (cliOptions.help) {
  printUsage();
  process.exit(0);
}

const audioMode = resolveAudioMode(cliOptions.audioMode, manifest);
const oscTarget = resolveOscTarget(
  cliOptions.oscTarget,
  manifest,
  process.env,
);
const serverConfig = resolveServerConfig(manifest);
const hostLanIp = resolveHostLanIp(process.env.PNDS_HOST_IP);
// The one full performer URL every outward surface shares — QR, the
// monitor's copyable address, __config.js and the startup log. The App
// injects PNDS_PERFORMER_URL while its HTTPS entry is in effect;
// without it the LAN HTTP fallback keeps today's behavior (runtime-
// contract §15).
const performerUrl = resolvePerformerUrl(
  process.env,
  hostLanIp,
  serverConfig.performerPort,
);

// ------------------------------------------------------------
// HTTP servers (performer port + monitor port share public/)
// ------------------------------------------------------------

const app = express();
const monitorApp = express();

libraries.attachBrowserRoutes(app);
libraries.attachBrowserRoutes(monitorApp);

app.use(express.static(path.join(PROJECT_ROOT, "public")));
monitorApp.use(express.static(path.join(PROJECT_ROOT, "public")));

// Injects runtime config into the browser so shared.js can read it.
// Ports come from the manifest; outputChannels is the RESOLVED channel
// count (App-injected PNDS_AUDIO_OUTPUT_CHANNELS or the manifest value),
// so the monitor page offers exactly the channels the server validates.
//
// `role` says which server served the page: under the App's HTTPS entry
// the browser's port is the entry's, not the manifest's, so the page
// must never infer its role from a port comparison (#138). performerUrl
// is the one full URL the QR and the copyable address show; projectId
// binds the entry's access context to this work's identity.
function configScript(role) {
  return (request, response) => {
    response.type("application/javascript").send(
      `window.__PNDS_CONFIG__ = ${JSON.stringify({
        role,
        projectId: manifest.id,
        performerUrl,
        performerPort: serverConfig.performerPort,
        monitorPort: serverConfig.monitorPort,
        outputChannels: audioEngine.outputChannels,
      })};`,
    );
  };
}

app.get("/__config.js", configScript("performer"));
monitorApp.get("/__config.js", configScript("monitor"));

const health = new HealthTracker({
  projectId: manifest.id,
  audioMode,
  performerPort: serverConfig.performerPort,
  monitorPort: serverConfig.monitorPort,
});

app.get("/__pnds/health", health.handler());
monitorApp.get("/__pnds/health", health.handler());

// QR code for the performer page, shown on the monitor page. Encodes
// the same resolved performer URL the config and the copyable address
// carry — one source, no drift.
monitorApp.get("/qr", qrHandler(performerUrl));

// The lib/ files the monitor page loads in the browser: the bridge
// modules (theme, spec §5.3; locale, App ≥ v1.3.0), served under the
// App-contract namespace like /__pnds/health. Monitor port only — the
// performer branch of the page never loads them and keeps the
// project's own colors and language.
monitorApp.get("/__pnds/theme-follow.js", (request, response) => {
  response.sendFile(path.join(PROJECT_ROOT, "lib", "theme-follow.js"));
});

monitorApp.get("/__pnds/locale-follow.js", (request, response) => {
  response.sendFile(path.join(PROJECT_ROOT, "lib", "locale-follow.js"));
});

// ------------------------------------------------------------
// Audio layer
// ------------------------------------------------------------

const audioEngine = new AudioEngine({
  mode: audioMode,
  target: oscTarget,
  projectRoot: PROJECT_ROOT,
  manifest,
  environment: process.env,
});
const projectAudio = new ProjectAudio(audioEngine);

const registry = new PlayerRegistry({
  maxClients: audioEngine.outputChannels,
});

// Seat assignments (token -> {id, out}) survive restarts, so a reopened
// work hands every known device back its seat and channel. Relocate the
// file with PNDS_SEATS_FILE (tests and the App point it elsewhere).
const seats = new SeatsStore({
  file:
    process.env.PNDS_SEATS_FILE ||
    path.join(PROJECT_ROOT, ".pnds-seats.json"),
});

// ------------------------------------------------------------
// Startup
// ------------------------------------------------------------

const server = app.listen(serverConfig.performerPort, "0.0.0.0", (error) => {
  if (error) {
    console.error(`Performer HTTP server failed on port ${serverConfig.performerPort}:`, error);
    process.exit(1);
  }
  printRuntimeInfo();
});

const monitorServer = monitorApp.listen(
  serverConfig.monitorPort,
  "0.0.0.0",
  (error) => {
    if (error) {
      console.error(`Monitor HTTP server failed on port ${serverConfig.monitorPort}:`, error);
      process.exit(1);
    }
    console.log(
      `Monitor page: http://${hostLanIp}:${serverConfig.monitorPort}/`,
    );
  },
);

const io = libraries.requireLibrary("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

async function startAudio() {
  health.setAudioStarting();

  try {
    await projectAudio.start();
    health.setAudioReady(oscTarget);
  } catch (error) {
    console.error("[audio] start failed:", error);
    health.setError(error);
    process.exitCode = 1;
  }
}

startAudio();

// ------------------------------------------------------------
// Socket.IO protocol (lib/protocol.js owns the semantics)
// ------------------------------------------------------------

attachProtocol(io, {
  events: shared.events,
  registry,
  projectAudio,
  seats,
});

// ------------------------------------------------------------
// Monitor view state (lib/monitor-state.js owns the semantics)
// ------------------------------------------------------------

// The monitor page's view controls (view toggles, debug picks) live on
// the server as the single source of truth, on their own Socket.IO
// namespace — every copy of the page converges there. Memory-only,
// session-scoped; lib/monitor-state.js owns the semantics.
attachMonitorState(io.of(shared.monitorNamespace), {
  events: shared.events,
  defaults: shared.monitorViewState,
});

// ------------------------------------------------------------
// Shutdown
// ------------------------------------------------------------

attachShutdown({
  onShutdown: async () => {
    health.setStopping();

    // Drop every connected client first — performers, the monitor
    // page's observer socket AND its view-state socket (namespace
    // broadcasts are not covered by the main-namespace call). io.close()
    // waits for clients to take their disconnect; a phone on a weak
    // network must not outlive the host's kill window. Per-step elapsed
    // below: a slow step found in the wild is diagnosable from the
    // output tail alone.
    const t0 = Date.now();
    io.disconnectSockets(true);
    io.of(shared.monitorNamespace).disconnectSockets(true);
    io.close();
    const tSockets = Date.now() - t0;

    const t1 = Date.now();
    await projectAudio.stop();
    const tAudio = Date.now() - t1;

    const t2 = Date.now();
    await closeHttpServer(server);
    await closeHttpServer(monitorServer);
    const tHttp = Date.now() - t2;

    console.log(
      `[shutdown] steps: sockets ${tSockets}ms, audio ${tAudio}ms, http ${tHttp}ms`,
    );
  },
});

// ------------------------------------------------------------
// Console output
// ------------------------------------------------------------

function printRuntimeInfo() {
  console.log(`[server] ${manifest.name} v${manifest.version}`);
  console.log(
    `[server] audio mode: ${formatAudioMode(audioMode)} (target ${oscTarget})`,
  );
  console.log(
    `[server] output: ${audioEngine.outputChannels} channels from bus ${audioEngine.outputBus}`,
  );
  console.log(`[server] performer page: ${performerUrl}`);
}
