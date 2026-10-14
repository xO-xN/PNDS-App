// The monitor page's view-state wiring (the server-held state module
// lives in lib/monitor-state.js): the p5 surface is stubbed like the
// theme and locale harnesses, and the client stub records what the
// page reports. Pins the page-side halves of the pattern — nothing
// view-dependent is visible before the snapshot, rendering follows the
// delivered state, and an adjustment goes out as a set instead of a
// local mutation.

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createPageHarness() {
  const fakeControl = () => {
    const control = {
      styles: new Map(),
      visible: true,
      label: "",
      press: () => {},
      style: (name, value) => control.styles.set(name, value),
      html: (value) => {
        control.label = value;
      },
      mousePressed: (handler) => {
        control.press = handler;
      },
      changed: () => {},
      option: () => {},
      selected: () => {},
      remove: () => {},
      position: () => {},
      size: () => {},
      parent: () => {},
      hide: () => {
        control.visible = false;
      },
      show: () => {
        control.visible = true;
      },
    };

    return control;
  };

  const img = fakeControl();
  img.elt = { alt: "" };

  // setup() builds the QR toggle first, the reset button second.
  const buttons = [];
  const sets = [];
  let viewListener = null;
  // #138: the copyable address captioned under the QR (createDiv).
  const urlText = fakeControl();
  urlText.content = null;

  const page = {
    location: { hostname: "127.0.0.1", search: "" },
    windowWidth: 800,
    windowHeight: 600,
    width: 800,
    height: 600,
    document: { documentElement: { style: {} } },
    PNDS: {
      performerPort: 6868,
      monitorPort: 6869,
      outputChannels: 16,
      monitorNamespace: "/monitor",
      performerUrl: "https://show.example.org:8443/",
    },
    PNDSClient: {
      connectMonitor: () => ({
        onClients: () => {},
        onViewState: (listener) => {
          viewListener = listener;
        },
        setViewState: (key, value) => sets.push({ key, value }),
        resetIds: () => {},
        setSeat: () => {},
        setOut: () => {},
      }),
    },
    io: () => {},
    createCanvas: () => ({ parent: () => {} }),
    createImg: (url, alt) => {
      img.elt.alt = alt;
      return img;
    },
    createDiv: (text) => {
      urlText.content = text;
      return urlText;
    },
    createButton: (label) => {
      const control = fakeControl();
      control.label = label;
      buttons.push(control);
      return control;
    },
    createSelect: () => fakeControl(),
  };
  page.self = page;
  page.window = page;

  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "public", "monitor.js"), "utf8"),
    vm.createContext(page),
  );

  return {
    page,
    img,
    urlText,
    get qrButton() {
      return buttons[0];
    },
    get resetButton() {
      return buttons[1];
    },
    sets,
    deliverViewState: (state) => viewListener(state),
  };
}

test("view-dependent UI stays hidden until the snapshot lands", () => {
  const h = createPageHarness();

  h.page.setup();

  assert.equal(h.img.visible, false); // no default QR to un-see
  assert.equal(h.urlText.visible, false); // the address waits with it
  assert.equal(h.qrButton.visible, false); // the toggle waits with it
});

test("the snapshot shows the QR, its address and labels the toggle from server state", () => {
  const h = createPageHarness();

  h.page.setup();
  h.deliverViewState({ showQr: true });

  assert.equal(h.img.visible, true);
  // The caption carries the SAME resolved URL the QR encodes and
  // __config.js injects (#138) — one source.
  assert.equal(h.urlText.content, "https://show.example.org:8443/");
  assert.equal(h.urlText.visible, true);
  assert.equal(h.qrButton.visible, true);
  assert.equal(h.qrButton.label, "隐藏二维码"); // QR showing → offer to hide

  // A broadcast in the other direction re-renders, not just the
  // snapshot.
  h.deliverViewState({ showQr: false });

  assert.equal(h.img.visible, false);
  assert.equal(h.urlText.visible, false);
  assert.equal(h.qrButton.label, "显示二维码");
});

test("pressing the toggle reports a set and waits for the broadcast", () => {
  const h = createPageHarness();

  h.page.setup();
  h.deliverViewState({ showQr: true });
  h.qrButton.press();

  assert.deepStrictEqual(h.sets, [{ key: "showQr", value: false }]);

  // The label still shows the SERVER's current state — the page never
  // flips view state locally; the broadcast relabels it.
  assert.equal(h.qrButton.label, "隐藏二维码");

  h.deliverViewState({ showQr: false });

  assert.equal(h.qrButton.label, "显示二维码");
  assert.deepStrictEqual(h.sets, [{ key: "showQr", value: false }]);
});

test("a locale switch relabels the toggle per the current state", () => {
  const h = createPageHarness();

  h.page.setup();
  h.deliverViewState({ showQr: true });
  h.page.applyPndsLocale("en");

  assert.equal(h.qrButton.label, "Hide QR");

  h.deliverViewState({ showQr: false });

  assert.equal(h.qrButton.label, "Show QR");
});
