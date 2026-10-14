// Standalone Node module smoke fixture. This is not the App dev server.
const express = require("express");
const http = require("node:http");
const path = require("node:path");
const { qrHandler } = require("../../modules/qr/qr");
const monitorApp = express();
const performerApp = express();
const performer = http.createServer(performerApp);
const monitor = http.createServer(monitorApp);
performerApp.get("/", (request, response) => response.type("html").send('<!doctype html><html lang="en"><title>Module performer fixture</title><body><h1>Performer fixture ready</h1><p>Piece colors and language remain independent.</p></body></html>'));
for (const id of ["theme-follow", "locale-follow"]) {
  monitorApp.get(`/__pnds/${id}.js`, (request, response) => response.sendFile(path.resolve(__dirname, "../../modules", id, `${id}.js`)));
}
performer.listen(Number(process.env.PERFORMER_PORT || 0), "127.0.0.1", () => {
  const performerUrl = `http://127.0.0.1:${performer.address().port}/`;
  monitorApp.get("/qr", qrHandler(performerUrl));
  monitorApp.get("/", (request, response) => response.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>PNDS release module smoke</title>
<style>:root{--bg:#20242b;--text:#ffffff;--card:#303744;--accent:#86efac}body{margin:0;padding:32px;background:var(--bg);color:var(--text);font:18px system-ui}main{max-width:720px;margin:auto}section{padding:24px;background:var(--card);border-radius:12px}button,a{font:inherit;margin:6px;color:inherit}button{padding:8px 16px;border:1px solid currentColor;background:transparent;border-radius:6px}img{width:240px;height:240px;background:white}#ready{font-weight:600}</style>
<script>
window.PNDS_THEME_OPTIONS={onTheme:function(name,palette){window.LAST_THEME={name:name,palette:palette};if(window.applyPieceTheme)window.applyPieceTheme(name,palette)}};
window.PNDS_LOCALE_OPTIONS={locales:['en','zh-CN'],fallback:'en',onLocale:function(locale){window.LAST_LOCALE=locale;if(window.applyPieceLocale)window.applyPieceLocale(locale)}};
</script>
<script src="/__pnds/theme-follow.js"></script><script src="/__pnds/locale-follow.js"></script>
</head><body><main><h1>PNDS release module smoke</h1><section><p id="ready">Drawing initialized</p><p id="theme-result">Theme: piece default</p><p id="locale-result">Locale: piece default</p><button id="theme-switch">Switch theme</button><button id="locale-switch">Switch language</button><button id="duplicate">Repeat messages</button><button id="dispose">Dispose bridges</button><p><img src="/qr" alt="Join performer"></p><p><a href="${performerUrl}" target="_blank">Open performer</a></p><p id="calls">Theme callbacks: 0; locale callbacks: 0</p></section></main>
<script>
let themeCalls=0,localeCalls=0,themeName='stage',localeName='en';
function calls(){document.getElementById('calls').textContent='Theme callbacks: '+themeCalls+'; locale callbacks: '+localeCalls}
window.applyPieceTheme=function(name,palette){themeName=name;themeCalls++;document.getElementById('theme-result').textContent='Theme: '+name+'; background: '+palette.bg;calls()};
window.applyPieceLocale=function(locale){localeName=locale;localeCalls++;document.getElementById('locale-result').textContent='Locale: '+locale;document.getElementById('ready').textContent=locale==='zh-CN'?'绘制已初始化':'Drawing initialized';calls()};
if(window.LAST_THEME)applyPieceTheme(LAST_THEME.name,LAST_THEME.palette);
if(window.LAST_LOCALE)applyPieceLocale(LAST_LOCALE);
function sendTheme(){window.postMessage({type:'pnds:theme',version:1,theme:themeName,palette:PNDS_THEME.THEME_PALETTES[themeName]},'*')}
function sendLocale(){window.postMessage({type:'pnds:locale',version:1,locale:localeName},'*')}
document.getElementById('theme-switch').onclick=function(){themeName=themeName==='stage'?'pond':'stage';sendTheme()};
document.getElementById('locale-switch').onclick=function(){localeName=localeName==='en'?'zh-CN':'en';sendLocale()};
document.getElementById('duplicate').onclick=function(){sendTheme();sendLocale()};
document.getElementById('dispose').onclick=function(){PNDS_THEME.dispose();PNDS_LOCALE.dispose();document.getElementById('dispose').textContent='Bridges disposed'};
</script></body></html>`));
  monitor.listen(Number(process.env.MONITOR_PORT || 0), "127.0.0.1", () => console.log(JSON.stringify({ monitorUrl: `http://127.0.0.1:${monitor.address().port}/?theme=stage&lang=en`, performerUrl })));
});
process.on("SIGTERM", () => { performer.closeAllConnections(); monitor.closeAllConnections(); performer.close(); monitor.close(); });
