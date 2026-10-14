// Browser input boundary: dispatch PointerEvents onto the actual performer canvas.
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function performerPage() {
  const controls = [];
  const canvas = new EventTarget();
  canvas.style = {};
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 1000, height: 600 });
  canvas.setPointerCapture = () => {};
  const page = {
    innerWidth: 1000, innerHeight: 600,
    windowWidth: 1000, windowHeight: 600, width: 1000, height: 600,
    document: { getElementById: () => ({ classList: { toggle() {} } }) },
    createCanvas: () => ({ elt: canvas, parent() {} }),
    constrain: (value, low, high) => Math.max(low, Math.min(high, value)),
    location: { origin: "https://score.example.test" }, localStorage: {}, io() {},
    PNDS: require("../public/shared"),
    PNDSClient: { connectPerformer: () => ({ sendControls: payload => controls.push({ ...payload }) }) },
  };
  page.window = page;
  vm.createContext(page);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/performer.js"), "utf8"), page);
  page.setup();
  const pointer = (type, id, x, y, pointerType = "touch") => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerId: id, pointerType, clientX: x + 10, clientY: y + 20, button: 0 });
    canvas.dispatchEvent(event);
  };
  return { controls, pointer };
}

test("two fingers keep separate faders through movement and independent release in p5 2", () => {
  const { controls, pointer } = performerPage();
  pointer("pointerdown", 7, 120, 48);
  pointer("pointerdown", 9, 880, 48);
  assert.deepEqual(controls.at(-1), { amp: 1, freq: 1, range: 3 });
  pointer("pointermove", 7, 400, 510);
  assert.deepEqual(controls.at(-1), { amp: 1, freq: 0, range: 3 });
  pointer("pointerup", 7, 400, 510);
  pointer("pointermove", 9, 600, 510);
  assert.deepEqual(controls.at(-1), { amp: 0, freq: 0, range: 3 });
  pointer("pointercancel", 9, 600, 510);
  const sent = controls.length;
  pointer("pointermove", 9, 880, 48);
  assert.equal(controls.length, sent, "a cancelled pointer cannot resume controlling a fader");
});

test("a register gesture stays on the switch; a released id can later control a fader", () => {
  const { controls, pointer } = performerPage();
  pointer("pointerdown", 7, 430, 65);
  assert.deepEqual(controls.at(-1), { amp: 0, freq: 0, range: 1 });
  const sent = controls.length;
  pointer("pointermove", 7, 120, 48);
  assert.equal(controls.length, sent);
  pointer("pointerup", 7, 120, 48);
  pointer("pointerdown", 7, 120, 48, "mouse");
  assert.deepEqual(controls.at(-1), { amp: 0, freq: 1, range: 1 });
  pointer("pointermove", 7, 400, 510, "mouse");
  assert.deepEqual(controls.at(-1), { amp: 0, freq: 0, range: 1 });
});

test("an active finger can grab a fader after entering its track, then keep that ownership", () => {
  const { controls, pointer } = performerPage();
  pointer("pointerdown", 7, 500, 300);
  assert.deepEqual(controls.at(-1), { amp: 0, freq: 0, range: 3 });
  pointer("pointermove", 7, 120, 48);
  assert.deepEqual(controls.at(-1), { amp: 0, freq: 1, range: 3 });
  pointer("pointermove", 7, 400, 510);
  assert.deepEqual(controls.at(-1), { amp: 0, freq: 0, range: 3 });
});
