// PNDS Template monitor: client roster, seat assignment and reset.
// QR display belongs to PNDS App; this page keeps the score connection alive.

const P = window.PNDS;

// Score-server client (observer role: never joins) — connection and
// state parsing live in client.js; this page is the table and selects.
// The connection stays INTERNAL (plain HTTP, cross-port to the
// performer server): this page is served on the monitor port and never
// travels through the App's external HTTPS entry (#138).
const client = window.PNDSClient.connectMonitor({
  io: io,
  port: P.performerPort,
  events: P.events,
  hostname: location.hostname,
  monitorNamespace: P.monitorNamespace,
});

let clients = [];
let selects = []; // p5 select elements (output channels), rebuilt on id changes
let idSelects = [];
let resetButton = null;

const TABLE_WIDTH = 560;
const HEADER_HEIGHT = 44;
const ROW_HEIGHT = 52;
const SELECT_WIDTH = 64;
const ID_SELECT_WIDTH = 56;
const RESET_WIDTH = 96;

// Theme (spec §5.3 "Theme Following"): the project's own dark colors
// until the App pushes a palette (lib/theme-follow.js delivers it to
// window.applyPndsTheme). draw() reads these every frame, so a new
// palette takes effect on the next frame — no redraw orchestration.
// Values are CSS color strings, passed to fill/stroke/background
// verbatim: p5 parses #rrggbb natively and tolerates other notations
// (rgb()/oklch()) the App might someday ship.
const DEFAULT_THEME = {
  bg: "#14161c",
  text: "#e8ecf4",
  muted: "#a0aabe",
  line: "#2a2e3a",
  control: { background: "#22262f", color: "#e8ecf4", border: "#3a4050" },
};

let THEME = DEFAULT_THEME;

// The ?theme= first-frame delivery can arrive before this script runs
// (theme-follow.js loads first); index.html stashes it for replay here.
window.applyPndsTheme = applyTheme;
if (window.PNDS_LAST_THEME) {
  applyTheme(window.PNDS_LAST_THEME.name, window.PNDS_LAST_THEME.palette);
}

// Locale ("Language Following", App ≥ v1.3.0): the same contract as
// THEME above — the page's own default is Chinese (the operator
// strings the page shipped before locales existed) until the App
// pushes a locale (lib/locale-follow.js delivers it to
// window.applyPndsLocale). draw() reads S every frame; DOM labels are
// re-rendered in applyLocale, so a new locale lands without redraw
// orchestration. Table headers (ID / AMP / …) are technical tokens
// shared by both languages.
const STRINGS = {
  en: {
    waiting: "Waiting for performers…",
    reset: "Reset IDs",
    resetConfirm:
      "Reset the seat id of every device? Each device rejoins with a fresh id and channel assignments reset to defaults.",
  },
  "zh-CN": {
    waiting: "等待演奏者加入…",
    reset: "重配 ID",
    resetConfirm:
      "重配所有设备的演奏序号？每台设备将重新拿到新的序号，声道分配也会重置。",
  },
};

let S = STRINGS["zh-CN"];

// The ?lang= first-frame delivery can arrive before this script runs
// (locale-follow.js loads first); index.html stashes it for replay here.
window.applyPndsLocale = applyLocale;
if (window.PNDS_LAST_LOCALE) {
  applyLocale(window.PNDS_LAST_LOCALE);
}

// Applies one of STRINGS' own keys — a code the page can't render
// keeps the previous language. Idempotent: relabeling the same locale
// writes the same values.
function applyLocale(locale) {
  if (!STRINGS[locale]) {
    return;
  }

  S = STRINGS[locale];

  if (resetButton) {
    resetButton.html(S.reset);
  }
}

function isHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function hexToRgb(hex) {
  if (!isHexColor(hex)) {
    return null;
  }

  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// Perceived brightness for the native color-scheme hint; unparsable
// values read as light (the safer popup default).
function isLightColor(color) {
  const rgb = hexToRgb(color);
  return rgb === null || (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 >= 140;
}

// Maps an App palette onto the page's drawing roles. Application is
// ATOMIC: bg and text carry the whole readability contract, so a
// palette missing either keeps the previous complete theme — keys are
// never mixed across themes (that is how unreadable combos happen).
// Separators and control borders take text-secondary: the recessed
// pill token is nearly invisible against the light themes'
// backgrounds, and this canvas has no card gaps or shadows to lean on.
function applyTheme(name, palette) {
  const pick = (key) => {
    const value = palette[key];
    return typeof value === "string" && value !== "" ? value : null;
  };

  const bg = pick("bg");
  const text = pick("text");

  if (!bg || !text) {
    return;
  }

  const secondary = pick("text-secondary") || text;

  THEME = {
    bg,
    text,
    muted: secondary,
    line: secondary,
    control: {
      background: pick("card") || bg,
      color: text,
      border: secondary,
    },
  };

  // WKWebView renders <select> as a native control that ignores CSS
  // background but honors CSS color — a themed dark text color over the
  // native dark chrome is unreadable. color-scheme flips the native
  // rendering (closed box AND the popup list) to match the theme.
  document.documentElement.style.colorScheme = isLightColor(bg)
    ? "light"
    : "dark";

  restyleControls();
}

client.onClients((next) => {
  const idsChanged =
    next.length !== clients.length ||
    next.some((entry, index) => !clients[index] || entry.id !== clients[index].id);

  clients = next;

  if (idsChanged) {
    rebuildSelects();
  } else {
    syncSelects();
  }
});

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("stage");
  createResetButton();
  rebuildSelects();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  layoutSelects();
  layoutResetButton();
}

// ------------------------------------------------------------
// Seat reset
// ------------------------------------------------------------

// A small caret SVG in the current text color — appearance:none
// removes the native select chrome (which ignores our background), so
// the arrow has to be drawn ourselves.
function caretImage(color) {
  const stroke = color.replace("#", "%23");
  return (
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' " +
    "width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' " +
    "stroke='" + stroke + "' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E\")"
  );
}

// The theme colors of a p5 DOM control — separated from the geometry
// styles so a palette arriving after setup() can restyle the live
// controls. Selects additionally drop the native appearance: WKWebView
// ignores CSS background on native selects, which left the themed text
// color unreadable on the untouched dark chrome (issue: lavender).
function styleControlColors(control, isSelect) {
  control.style("background", THEME.control.background);
  control.style("color", THEME.control.color);
  control.style("border", "1px solid " + THEME.control.border);

  if (isSelect) {
    control.style("-webkit-appearance", "none");
    control.style("appearance", "none");
    control.style("background-image", caretImage(THEME.control.color));
    control.style("background-repeat", "no-repeat");
    control.style("background-position", "right 6px center");
    control.style("padding-right", "20px");
  }
}

function restyleControls() {
  for (const select of [...selects, ...idSelects]) {
    styleControlColors(select, true);
  }

  if (resetButton) {
    styleControlColors(resetButton, false);
  }
}

function createResetButton() {
  resetButton = createButton(S.reset);
  resetButton.mousePressed(requestResetIds);
  styleControlColors(resetButton, false);
  resetButton.style("border-radius", "6px");
  resetButton.style("padding", "6px 12px");
  resetButton.style("font-size", "14px");
  resetButton.style("width", RESET_WIDTH + "px");
  layoutResetButton();
}

// The server wipes every seat record and bounces the performers, who
// rejoin with fresh ids in rejoin order. Channel assignments go with
// them — reset means a new lineup, where the old channels are meaningless.
function requestResetIds() {
  if (!window.confirm(S.resetConfirm)) {
    return;
  }

  client.resetIds();
}

function layoutResetButton() {
  if (resetButton) {
    resetButton.position(width - RESET_WIDTH - 16, 14);
  }
}

// ------------------------------------------------------------
// Select management
// ------------------------------------------------------------

function rebuildSelects() {
  removeSelects();
  createSelects();
  layoutSelects();
}

function removeSelects() {
  for (const select of selects) {
    select.remove();
  }

  for (const select of idSelects) {
    select.remove();
  }

  selects = [];
  idSelects = [];
}

function styleSelect(select, width) {
  styleControlColors(select, true);
  select.style("border-radius", "6px");
  select.style("padding", "4px 8px");
  select.style("font-size", "14px");
  select.style("width", width + "px");
}

function createSelects() {
  for (const entry of clients) {
    // Seat number: the device can move to any id not held by another
    // LIVE device (stale seat records are evicted server-side).
    const idSelect = createSelect();

    for (let id = 1; id <= P.outputChannels; id += 1) {
      const taken = clients.some(
        (other) => other.id === id && other.id !== entry.id,
      );

      if (!taken) {
        idSelect.option(String(id));
      }
    }

    idSelect.selected(String(entry.id));
    idSelect.changed(() => {
      const to = Number(idSelect.value());

      // Optimistic send, immediate revert: the server's state broadcast
      // (only on success) rebuilds the table with the new id; a rejected
      // move leaves the reverted value standing.
      if (to !== entry.id) {
        client.setSeat(entry.id, to);
      }

      idSelect.selected(String(entry.id));
    });
    styleSelect(idSelect, ID_SELECT_WIDTH);
    idSelects.push(idSelect);

    const select = createSelect();

    for (let channel = 1; channel <= P.outputChannels; channel += 1) {
      select.option(String(channel));
    }

    select.selected(String(entry.out));
    select.changed(() => {
      client.setOut(entry.id, Number(select.value()));
    });
    styleSelect(select, SELECT_WIDTH);
    selects.push(select);
  }
}

// Client values changed but the set is the same: mirror out changes (e.g.
// after a reconnect restore) back into the selects.
function syncSelects() {
  selects.forEach((select, index) => {
    const client = clients[index];

    if (client && String(select.value()) !== String(client.out)) {
      select.selected(String(client.out));
    }
  });
}

function layoutSelects() {
  const top = tableY();

  selects.forEach((select, index) => {
    select.position(
      tableX() + 440,
      top + HEADER_HEIGHT + index * ROW_HEIGHT + 14,
    );
  });

  idSelects.forEach((select, index) => {
    select.position(
      tableX() + 8,
      top + HEADER_HEIGHT + index * ROW_HEIGHT + 14,
    );
  });
}

// ------------------------------------------------------------
// Layout math (all centered)
// ------------------------------------------------------------

function tableX() {
  return (width - TABLE_WIDTH) / 2;
}

function tableY() {
  const tableHeight = HEADER_HEIGHT + clients.length * ROW_HEIGHT;
  return Math.max(8, (height - tableHeight) / 2);
}

// ------------------------------------------------------------
// Drawing
// ------------------------------------------------------------

function draw() {
  background(THEME.bg);

  if (clients.length === 0) {
    drawEmpty();
    return;
  }

  drawHeader();
  clients.forEach((client, index) => {
    drawRow(client, tableY() + HEADER_HEIGHT + index * ROW_HEIGHT);
  });
}

function drawEmpty() {
  textAlign(CENTER, CENTER);
  textSize(16);
  fill(THEME.muted);
  text(S.waiting, width / 2, height / 2);
}

function drawHeader() {
  const x = tableX();
  const y = tableY();

  fill(THEME.muted);
  textAlign(LEFT, CENTER);
  textSize(12);
  text("ID", x + 16, y + HEADER_HEIGHT / 2);
  text("AMP", x + 96, y + HEADER_HEIGHT / 2);
  text("FREQ", x + 216, y + HEADER_HEIGHT / 2);
  text("RANGE", x + 348, y + HEADER_HEIGHT / 2);
  text("OUT CH", x + 440, y + HEADER_HEIGHT / 2);

  stroke(THEME.line);
  line(x, y + HEADER_HEIGHT, x + TABLE_WIDTH, y + HEADER_HEIGHT);
}

function drawRow(client, y) {
  const x = tableX();

  // The seat number is an idSelect positioned at x + 8, not text.
  fill(THEME.text);
  textAlign(LEFT, CENTER);
  textSize(15);
  text(client.amp.toFixed(3), x + 96, y + ROW_HEIGHT / 2);
  text(Math.round(client.freq) + " Hz", x + 216, y + ROW_HEIGHT / 2);
  text(String(client.register), x + 348, y + ROW_HEIGHT / 2);

  stroke(THEME.line);
  line(x, y + ROW_HEIGHT, x + TABLE_WIDTH, y + ROW_HEIGHT);
}
