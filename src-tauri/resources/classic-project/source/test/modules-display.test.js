const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const express = require("express");
const { qrHandler } = require("../modules/qr/qr");

async function project(t, target, options) {
  const monitor = express();
  const performer = express();
  performer.get("/play", (request, response) => response.send("performer ready"));
  monitor.get("/qr", qrHandler(target, options));
  monitor.get("/", (request, response) => response.send('<img src="/qr" alt="Join">'));
  const server = http.createServer(monitor);
  const performerServer = http.createServer(performer);
  await Promise.all([new Promise(resolve => server.listen(0, "127.0.0.1", resolve)), new Promise(resolve => performerServer.listen(0, "127.0.0.1", resolve))]);
  t.after(() => Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => performerServer.close(resolve))]));
  return { url: `http://127.0.0.1:${server.address().port}`, performerUrl: `http://127.0.0.1:${performerServer.address().port}/play` };
}

test("QR HTTP output preserves a complete performer address and is a decodable PNG", async (t) => {
  const target = "https://stage.example.org:8443/play?piece=water%20music&group=2#join";
  const fixture = await project(t, target);
  const response = await fetch(`${fixture.url}/qr`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^image\/png/);
  const png = Buffer.from(await response.arrayBuffer());
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 480);
  if (process.platform === "darwin") {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pnds-qr-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const image = path.join(directory, "qr.png");
    fs.writeFileSync(image, png);
    const decoded = execFileSync("swift", [path.join(__dirname, "fixtures", "decode-qr.swift"), image], { env: { ...process.env, CLANG_MODULE_CACHE_PATH: path.join(directory, "cache") }, encoding: "utf8" });
    assert.equal(decoded.trim(), target);
  }
  assert.equal(await (await fetch(fixture.performerUrl)).text(), "performer ready");
});

test("QR HTTP route rejects missing and invalid performer addresses without inventing a target", async (t) => {
  for (const target of [undefined, "", "/play", "javascript:alert(1)", "https://user:secret@stage.example.org/"]) {
    const fixture = await project(t, target);
    const response = await fetch(`${fixture.url}/qr`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid-performer-url" });
  }
});

test("QR HTTP output supports project display choices and reports encoder failure", async (t) => {
  const svg = await project(t, "http://127.0.0.1:6868/", { format: "svg", width: 256, margin: 4, errorCorrectionLevel: "H" });
  const response = await fetch(`${svg.url}/qr`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^image\/svg\+xml/);
  assert.match(await response.text(), /width="256" height="256"/);
  const tooLong = await project(t, `https://stage.example.org/?score=${"a".repeat(20000)}`);
  const failure = await fetch(`${tooLong.url}/qr`);
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), { error: "qr-generation-failed" });
  assert.throws(() => qrHandler("http://127.0.0.1/", { width: -1 }), /Invalid QR output options/);
});

const vm = require("node:vm");

function monitorPage(search, themeOptions = {}, localeOptions = {}) {
  const listeners = new Map();
  const styles = {};
  const page = { document: { documentElement: { lang: "piece-default", style: { setProperty(name, value) { styles[name] = value; } } } }, location: { search }, PNDS_THEME_OPTIONS: themeOptions, PNDS_LOCALE_OPTIONS: localeOptions,
    addEventListener(type, callback) { const handlers = listeners.get(type) || new Set(); handlers.add(callback); listeners.set(type, handlers); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); }
  };
  page.self = page;
  const context = vm.createContext(page);
  return { page, styles, load(source) { vm.runInContext(source, context); }, deliver(data) { for (const handler of listeners.get("message") || []) handler({ data }); } };
}

async function bridgeProject(t) {
  const monitor = express();
  const performer = express();
  monitor.get("/", (request, response) => response.send('<script src="/__pnds/theme-follow.js"></script><script src="/__pnds/locale-follow.js"></script>'));
  performer.get("/", (request, response) => response.send("piece performer"));
  for (const id of ["theme-follow", "locale-follow"]) monitor.get(`/__pnds/${id}.js`, (request, response) => response.sendFile(path.resolve(__dirname, "..", "modules", id, `${id}.js`)));
  const servers = [http.createServer(monitor), http.createServer(performer)];
  await Promise.all(servers.map(server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve))));
  t.after(() => Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))));
  return servers.map(server => `http://127.0.0.1:${server.address().port}`);
}

test("released monitor scripts deliver first frames, tolerate messages, suppress duplicates and release listeners", async (t) => {
  const [monitor, performer] = await bridgeProject(t);
  const themeSource = await (await fetch(`${monitor}/__pnds/theme-follow.js`)).text();
  const localeSource = await (await fetch(`${monitor}/__pnds/locale-follow.js`)).text();
  assert.match(await (await fetch(monitor)).text(), /theme-follow.js.*locale-follow.js/);
  assert.equal(await (await fetch(performer)).text(), "piece performer");
  assert.equal((await fetch(`${performer}/__pnds/theme-follow.js`)).status, 404);
  assert.equal((await fetch(`${performer}/__pnds/locale-follow.js`)).status, 404);
  const themes = [], locales = [];
  const document = monitorPage("?theme=stage&lang=ZH-cn", { onTheme: (name, palette) => themes.push({ name, bg: palette.bg }) }, { onLocale: resolved => locales.push(resolved) });
  document.load(themeSource);
  document.load(localeSource);
  assert.equal(document.styles["--bg"], "#0b0c10");
  assert.equal(document.page.document.documentElement.lang, "zh-CN");
  document.deliver({ type: "pnds:locale", version: 1, locale: "zh-CN" });
  document.deliver({ type: "pnds:theme", version: 1, theme: "stage", palette: document.page.PNDS_THEME.THEME_PALETTES.stage });
  assert.equal(themes.length, 1);
  assert.equal(locales.length, 1);
  document.deliver({ type: "pnds:theme", version: 9, palette: {} });
  document.deliver({ type: "pnds:locale", version: 1, locale: 6 });
  assert.equal(document.styles["--bg"], "#0b0c10");
  document.deliver({ type: "pnds:theme", version: 1, theme: "future", palette: { bg: "#123456", text: "#ffffff" } });
  document.deliver({ type: "pnds:locale", version: 1, locale: "fr" });
  assert.equal(document.styles["--bg"], "#123456");
  assert.equal(document.page.document.documentElement.lang, "en");
  document.page.PNDS_THEME.dispose(); document.page.PNDS_LOCALE.dispose();
  document.page.PNDS_THEME.dispose(); document.page.PNDS_LOCALE.dispose();
  document.deliver({ type: "pnds:locale", version: 1, locale: "zh-CN" });
  assert.equal(document.page.document.documentElement.lang, "en");
  document.deliver({ type: "pnds:theme", version: 1, palette: { bg: "#ffffff" } });
  assert.equal(document.styles["--bg"], "#123456");
});

test("monitor modules keep piece defaults without Host input and adapt custom drawing and language tables", async (t) => {
  const [monitor] = await bridgeProject(t);
  const theme = await (await fetch(`${monitor}/__pnds/theme-follow.js`)).text();
  const locale = await (await fetch(`${monitor}/__pnds/locale-follow.js`)).text();
  const missing = monitorPage("");
  missing.load(theme); missing.load(locale);
  assert.deepEqual(missing.styles, {});
  assert.equal(missing.page.document.documentElement.lang, "piece-default");
  let drawing = null, language = null;
  const adapted = monitorPage("?theme=lavender&lang=pt", { applyVariables: false, onTheme: (name, palette) => { drawing = { name, bg: palette.bg }; } }, { locales: ["pt-BR"], onLocale: code => { language = code; } });
  adapted.load(theme); adapted.load(locale);
  assert.deepEqual(drawing, { name: "lavender", bg: "#eef0f8" });
  assert.deepEqual(adapted.styles, {});
  assert.equal(language, "pt-BR");
  adapted.deliver({ type: "pnds:locale", version: 1, locale: "unknown" });
  assert.equal(language, "pt-BR", "fallback always belongs to the piece string table");
  let updates = 0;
  const reload = monitorPage("", {}, { onLocale: () => updates++ });
  reload.load(locale); reload.load(locale);
  reload.deliver({ type: "pnds:locale", version: 1, locale: "en" });
  assert.equal(updates, 1, "reloading the script releases its previous listener");
});

test("malformed monitor payloads preserve the last valid drawing and language without throwing", async (t) => {
  const [monitor] = await bridgeProject(t);
  const document = monitorPage("?theme=stage&lang=zh-CN");
  for (const id of ["theme-follow", "locale-follow"]) document.load(await (await fetch(`${monitor}/__pnds/${id}.js`)).text());
  const circular = {}; circular.bg = circular;
  for (const palette of [null, [], {}, { bg: 7 }, { bg: "" }, circular]) {
    assert.doesNotThrow(() => document.deliver({ type: "pnds:theme", version: 1, theme: "broken", palette }));
  }
  for (const locale of [null, 7, "", " ", "en_"]) document.deliver({ type: "pnds:locale", version: 1, locale });
  assert.equal(document.styles["--bg"], "#0b0c10");
  assert.equal(document.page.document.documentElement.lang, "zh-CN");
});
