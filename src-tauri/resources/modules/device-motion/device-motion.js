// Native device input only. Musical mapping, identity admission and recording stay in the work.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PNDSDeviceMotion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const fields = { tilt: { beta: 180, gamma: 90 }, acceleration: { x: 200, y: 200, z: 200 }, gravity: { x: 200, y: 200, z: 200 } };
  function normalizeMotion(sample) {
    if (!sample || sample.version !== 1 || !fields[sample.kind] || !sample.value || typeof sample.value !== 'object') return null;
    const value = {};
    let valid = false;
    for (const [key, maximum] of Object.entries(fields[sample.kind])) {
      const number = sample.value[key];
      if (number == null) value[key] = null;
      else if (!Number.isFinite(number) || Math.abs(number) > maximum) return null;
      else { value[key] = number; valid = true; }
    }
    if (!valid) return null;
    const result = { version: 1, kind: sample.kind, value };
    if (sample.intervalMs !== undefined) {
      if (!Number.isFinite(sample.intervalMs) || sample.intervalMs < 0 || sample.intervalMs > 1000) return null;
      result.intervalMs = sample.intervalMs;
    }
    return result;
  }
  function createDeviceMotion({ target = globalThis, onSample = () => {}, onState = () => {}, isOwner = () => true } = {}) {
    const document = target.document;
    const owns = () => target.PNDS_MEDIA_SURFACE?.captureAllowed !== false && new URLSearchParams(target.location?.search || "").get("surface") !== "venue" && isOwner();
    let generation = 0, listening = false, timer = null, disposed = false;
    let state = { status: 'idle', error: null };
    const last = new Map();
    function notify(status, error = null) { state = { status, error }; onState({ ...state }); }
    function detach() {
      target.removeEventListener('deviceorientation', orientation);
      target.removeEventListener('devicemotion', acceleration);
      target.clearTimeout(timer); timer = null; listening = false; last.clear();
    }
    function stop(status = 'stopped') { ++generation; detach(); notify(status); }
    function active(ticket) {
      if (ticket !== generation || disposed) return false;
      if (document?.hidden || !owns()) { stop('suspended'); return false; }
      return true;
    }
    function publish(kind, value, intervalMs) {
      if (!listening || document?.hidden) return;
      if (!owns()) { stop("suspended"); return; }
      const sample = normalizeMotion({ version: 1, kind, value, ...(Number.isFinite(intervalMs) ? { intervalMs } : {}) });
      if (!sample) return;
      const now = target.performance.now();
      if (last.has(kind) && now - last.get(kind) < 1000 / 30) return;
      last.set(kind, now);
      target.clearTimeout(timer); timer = null;
      const ticket = generation;
      notify('active');
      if (active(ticket) && listening) onSample(sample);
    }
    function orientation(event) { publish('tilt', { beta: event.beta, gamma: event.gamma }); }
    function acceleration(event) {
      if (event.acceleration) publish('acceleration', event.acceleration, event.interval);
      if (event.accelerationIncludingGravity) publish('gravity', event.accelerationIncludingGravity, event.interval);
    }
    function background() { if (document.hidden && state.status !== 'idle' && state.status !== 'stopped') stop('suspended'); }
    function pagehide() { stop(); }
    document?.addEventListener('visibilitychange', background);
    target.addEventListener('pagehide', pagehide);
    return {
      get state() { return { ...state }; },
      async enable() {
        if (disposed) return false;
        const ticket = ++generation;
        detach();
        if (!owns()) { notify('restricted', 'This page does not own device capture'); return false; }
        if (target.isSecureContext === false) { notify('restricted', 'A secure HTTPS or supported native entry is required'); return false; }
        if (document?.hidden) { notify('suspended'); return false; }
        const capabilities = [target.DeviceOrientationEvent, target.DeviceMotionEvent].filter(Boolean);
        if (!capabilities.length) { notify('unavailable', 'This browser exposes no device motion API'); return false; }
        notify('requesting');
        if (!active(ticket)) return false;
        try {
          // Invoke both requests synchronously inside the enable button's user action.
          const permissions = capabilities.map(api => typeof api.requestPermission === 'function' ? api.requestPermission() : 'granted');
          const answers = await Promise.all(permissions);
          if (ticket !== generation || disposed) return false;
          if (answers.some(answer => answer !== 'granted')) { notify('denied', 'Device motion permission was not granted; enable again to retry'); return false; }
          if (document?.hidden || !owns()) { notify('suspended'); return false; }
          listening = true;
          target.addEventListener('deviceorientation', orientation);
          target.addEventListener('devicemotion', acceleration);
          notify('waiting');
          if (!active(ticket)) return false;
          timer = target.setTimeout(() => { if (ticket === generation && state.status === 'waiting') notify('no-data', 'No valid motion fields received; this device may have no sensor'); }, 1500);
          return true;
        } catch (error) {
          if (ticket === generation && !disposed) notify(error?.name === 'NotAllowedError' ? 'denied' : 'error', String(error?.message || error));
          return false;
        }
      },
      stop() { stop(); },
      dispose() { if (disposed) return; disposed = true; stop(); document?.removeEventListener('visibilitychange', background); target.removeEventListener('pagehide', pagehide); },
    };
  }
  return { createDeviceMotion, normalizeMotion };
});
