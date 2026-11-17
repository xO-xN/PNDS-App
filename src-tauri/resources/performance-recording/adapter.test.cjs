const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createRecordingAdapter } = require('./adapter.cjs');

function fixture() {
  const applied = [];
  const adapter = createRecordingAdapter({ adapterId: 'test-v1', snapshot: () => ({ initial: true }),
    restore: () => {}, apply: event => applied.push(event), release: () => {} });
  async function command(body) {
    const request = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(request, { url: '/__pnds/recording', method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' } });
    let status = 200, result;
    await adapter.handle(request, { setHeader() {}, writeHead(value) { status = value; }, end(value) { result = value; } });
    assert.equal(status, 200, result);
    return JSON.parse(result);
  }
  return { adapter, command, applied };
}

async function overdub(f, operationId, livePassId) {
  return f.command({ action: 'begin', operationId, mode: 'overdub', livePassId,
    initialState: { initial: true }, replayPerformers: [] });
}

test('a recording pass captures every existing and late-joining source independently', async () => {
  const f = fixture();
  f.adapter.register('old-window', 'First', 1);
  const begin = await overdub(f, 'first', 'pass-one');
  assert.equal(begin.passId, 'pass-one');
  assert.equal(begin.events[0].kind, 'join');
  assert.equal(begin.events[0].atMs, 0);
  f.adapter.register('new-window', 'Second', 2);
  assert.equal(f.adapter.admitted('old-window'), true);
  assert.equal(f.adapter.admitted('new-window'), true);
  assert.equal(f.adapter.capture('old-window', 'touch', { x: 1 }), true);
  assert.equal(f.adapter.capture('new-window', 'touch', { x: 2 }), true);
  assert.equal(f.adapter.capture(null, 'conductor', {}), false);
  const ended = await f.command({ action: 'end', operationId: 'first', release: true });
  assert.equal(ended.passId, 'pass-one');
  assert.equal(ended.performers.length, 2);
  assert.equal(new Set(ended.performers.map(p => p.id)).size, 2);
  assert.ok(ended.performers.every(p => !['old-window', 'new-window'].includes(p.id)));
  for (const performer of ended.performers) {
    assert.ok(ended.events.some(e => e.performerId === performer.id && e.kind === 'touch'));
    assert.ok(ended.events.some(e => e.performerId === performer.id && e.kind === 'release'));
  }
});

test('one source keeps its identity on reconnect and gets a fresh identity on the next pass', async () => {
  const f = fixture();
  f.adapter.register('same-device', 'Performer', 1);
  const first = await overdub(f, 'first', 'pass-one');
  const id = first.performers[0].id;
  f.adapter.selection('same-device', 2);
  f.adapter.capture('same-device', 'touch', { x: 1 });
  f.adapter.unregister('same-device');
  f.adapter.register('same-device', 'Performer', 3);
  f.adapter.capture('same-device', 'touch', { x: 2 });
  const polled = await f.command({ action: 'poll', operationId: 'first', afterSequence: 0 });
  assert.equal(polled.passId, 'pass-one');
  assert.deepEqual(polled.performers.map(p => p.id), [id]);
  assert.equal(polled.performers[0].selection, 3);
  await f.command({ action: 'end', operationId: 'first', release: true });
  const second = await overdub(f, 'second', 'pass-two');
  assert.notEqual(second.performers[0].id, id);
  assert.equal(second.performers[0].selection, 3);
});

test('first recording pass echoes its pass identity while keeping snapshot source identities', async () => {
  const f = fixture();
  f.adapter.register('device', 'Performer', 1);
  const first = await f.command({ action: 'begin', operationId: 'record', mode: 'record', livePassId: 'first-pass' });
  assert.equal(first.passId, 'first-pass');
  assert.deepEqual(first.performers.map(p => p.id), ['device']);
  f.adapter.capture('device', 'touch', { x: 1 });
  const ended = await f.command({ action: 'end', operationId: 'record', release: false });
  assert.equal(ended.passId, 'first-pass');
  assert.equal(ended.events[0].performerId, 'device');
  assert.deepEqual(await f.command({ action: 'end', operationId: 'record', release: false }), ended);
});

test('held input is seeded at the pass origin before an immediate move after a slow restore', async t => {
  const originalClock = Object.getOwnPropertyDescriptor(performance, 'now');
  let now = 1000;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  t.after(() => {
    if (originalClock) Object.defineProperty(performance, 'now', originalClock);
    else delete performance.now;
  });
  const held = {
    kind: 'contact', id: 'held-contact', phase: 'start', pointerType: 'touch',
    x: 25, y: 50, width: 100, height: 100, nx: 0.25, ny: 0.5,
  };
  const adapter = createRecordingAdapter({
    adapterId: 'held-input-v1',
    snapshot: () => ({ held: { ...held } }),
    restore() {
      // Only the monotonic clock is injected. Real restore work may take time;
      // the new pass must not sort its following move before this held start.
      now += 250;
    },
    seed(sourceId) {
      assert.equal(sourceId, 'same-live-device');
      return [{ kind: 'input', payload: { ...held } }];
    },
    apply() { /* This test observes the public captured stream. */ },
    release() { /* The callback owns no external resources in this fixture. */ },
  });
  async function command(body) {
    const request = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(request, { url: '/__pnds/recording', method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' } });
    let status = 200, result;
    await adapter.handle(request, {
      setHeader() { /* HTTP response metadata is outside this seam. */ },
      writeHead(value) { status = value; },
      end(value) { result = value; },
    });
    assert.equal(status, 200, result);
    return JSON.parse(result);
  }
  adapter.register('same-live-device', 'Performer', null);
  const begin = await command({ action: 'begin', operationId: 'held-overdub',
    mode: 'overdub', livePassId: 'new-pass', initialState: { performers: [] }, replayPerformers: [] });
  assert.equal(now, 1250, 'restore advanced the actual injected clock');
  assert.equal(begin.elapsedMs, 0, 'begin reset its new pass clock after restore');
  assert.equal(adapter.capture('same-live-device', 'input', {
    ...held, phase: 'move', x: 40, nx: 0.4,
  }), true);
  const captured = await command({ action: 'poll', operationId: 'held-overdub', afterSequence: 0 });
  const inputs = captured.events.filter(event => event.kind === 'input')
    .sort((a, b) => a.atMs - b.atMs || a.sequence - b.sequence);
  assert.deepEqual(inputs.map(event => [event.atMs, event.payload.phase, event.payload.x]), [
    [0, 'start', 25],
    [0, 'move', 40],
  ]);
  assert.ok(inputs[0].sequence < inputs[1].sequence);
  assert.equal(inputs[0].performerId, inputs[1].performerId);
  assert.notEqual(inputs[0].performerId, 'same-live-device');
  await command({ action: 'end', operationId: 'held-overdub', release: true });
});

test('a reported work fault cannot complete when stopped before polling and cleanup cannot release a new operation', async () => {
  let held = false, releases = 0;
  const adapter = createRecordingAdapter({
    adapterId: 'faulted-work-v1',
    snapshot: () => ({ held }),
    restore() { /* Record mode snapshots the actual live work. */ },
    apply() { /* This regression observes capture and cleanup through HTTP. */ },
    release() { held = false; releases++; },
  });
  async function command(body) {
    const request = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(request, { url: '/__pnds/recording', method: 'POST',
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' } });
    let status = 200, result;
    await adapter.handle(request, {
      setHeader() { /* HTTP response metadata is outside this seam. */ },
      writeHead(value) { status = value; },
      end(value) { result = value; },
    });
    return { status, body: JSON.parse(result) };
  }
  adapter.register('live-source', 'Performer', null);
  const started = await command({ action: 'begin', operationId: 'faulted-record',
    mode: 'record', livePassId: 'first-pass' });
  assert.equal(started.status, 200);
  const input = { kind: 'contact', id: 'held-contact', phase: 'start', nx: 0.6 };
  assert.equal(adapter.capture('live-source', 'input', input), true);
  held = true;
  adapter.reportFault(new Error('work failed'));
  // There is deliberately no poll between the work fault and Record-panel Stop.
  const failed = await command({ action: 'end', operationId: 'faulted-record',
    afterSequence: 0, release: false });
  assert.equal(failed.status, 409);
  assert.match(failed.body.error, /work failed/);
  assert.equal(held, false, 'the fault cleanup released actual held work state');
  assert.equal(releases, 1);
  const acknowledged = await command({ action: 'end', operationId: 'faulted-record',
    afterSequence: 0, release: false });
  assert.equal(acknowledged.status, 200);
  assert.ok(acknowledged.body.events.some(event => event.kind === 'input' && event.payload.nx === 0.6));
  assert.deepEqual(await command({ action: 'end', operationId: 'faulted-record',
    afterSequence: 0, release: false }), acknowledged);
  assert.equal(releases, 1, 'idempotent cleanup acknowledgment does not release twice');
  const next = await command({ action: 'begin', operationId: 'next-record',
    mode: 'record', livePassId: 'next-pass' });
  assert.equal(next.status, 200);
  assert.equal(adapter.capture('live-source', 'input', { ...input, id: 'new-held' }), true);
  held = true;
  const staleEnd = await command({ action: 'end', operationId: 'faulted-record',
    afterSequence: 0, release: true });
  assert.equal(staleEnd.status, 200);
  assert.equal(adapter.mode, 'record');
  assert.equal(held, true, 'an old operation cannot release the new live work');
  assert.equal(releases, 1);
  const ordinary = await command({ action: 'end', operationId: 'next-record',
    afterSequence: 0, release: false });
  assert.equal(ordinary.status, 200);
  assert.equal(held, true, 'ordinary Record stop preserves the live held work');
  assert.equal(releases, 1);
  const emptyStarted = await command({ action: 'begin', operationId: 'empty-fault-record', mode: 'record', livePassId: 'empty-fault-pass' });
  assert.equal(emptyStarted.status, 200);
  adapter.reportFault(new Error(''));
  const emptyFault = await command({ action: 'end', operationId: 'empty-fault-record', release: false });
  assert.equal(emptyFault.status, 409);
  assert.match(emptyFault.body.error, /Project recording failed/);
  assert.equal((await command({ action: 'end', operationId: 'empty-fault-record', release: false })).status, 200);
});
