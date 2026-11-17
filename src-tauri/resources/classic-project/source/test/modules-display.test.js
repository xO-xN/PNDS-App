const http = require("node:http");
const express = require("express");
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

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
