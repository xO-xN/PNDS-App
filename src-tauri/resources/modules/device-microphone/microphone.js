/* Current-page input only. No audio destination, recording or network fallback. */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.PNDSMicrophone = api
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict'
  function createDeviceMicrophone(options = {}) {
    const env = options.environment || globalThis
    const onState = options.onState || (() => {})
    const onSample = options.onSample || (() => {})
    const isOwner = () => env.PNDS_MEDIA_SURFACE?.captureAllowed !== false && new URLSearchParams(env.location?.search || '').get('surface') !== 'venue' && (options.isOwner?.() ?? true)
    let generation = 0, stream = null, context = null, source = null, analyser = null, timer = null, envelope = 0, disposed = false
    const ended = () => stop('unavailable', 'The selected audio input ended. Select an input and retry.')
    const state = (status, message = '') => onState({ status, message })
    function release() {
      if (timer !== null) env.clearTimeout(timer)
      timer = null
      if (stream) for (const track of stream.getTracks()) {
        track.removeEventListener('ended', ended)
        track.stop()
      }
      stream = null
      source?.disconnect()
      analyser?.disconnect()
      source = analyser = null
      const old = context
      context = null
      if (old) Promise.resolve(old.close()).catch(() => {})
      envelope = 0
    }
    function stop(status = 'stopped', message = '') {
      generation++
      release()
      state(status, message)
    }
    function active(owner) {
      if (owner !== generation || disposed) return false
      if (!isOwner() || env.document?.visibilityState === 'hidden') {
        stop('paused', 'This page no longer owns the active input.')
        return false
      }
      return true
    }
    const hidden = () => {
      if (env.document?.visibilityState === 'hidden') stop('paused', 'Enable again when this page returns to the foreground.')
    }
    const unload = () => stop()
    env.document?.addEventListener('visibilitychange', hidden)
    env.addEventListener?.('pagehide', unload)
    function sample(owner) {
      if (!active(owner) || !analyser) return false
      try {
        const waveform = new Float32Array(1024)
        const frequencies = new Float32Array(analyser.frequencyBinCount)
        analyser.getFloatTimeDomainData(waveform)
        analyser.getFloatFrequencyData(frequencies)
        let sum = 0, peak = 0
        for (let i = 0; i < waveform.length; i++) {
          const value = Number.isFinite(waveform[i]) ? Math.max(-1, Math.min(1, waveform[i])) : 0
          waveform[i] = value
          sum += value * value
          peak = Math.max(peak, Math.abs(value))
        }
        envelope = .8 * envelope + .2 * Math.sqrt(sum / waveform.length)
        const result = { version: 1, sampleRate: context.sampleRate, fftSize: 1024, envelope, peak, waveform: Array.from(waveform), fft: Array.from(frequencies, value => Number.isFinite(value) ? Math.max(-100, Math.min(0, value)) : -100) }
        state('active')
        if (!active(owner)) return false
        onSample(result)
        if (!active(owner)) return false
        timer = env.setTimeout(() => sample(owner), 50)
        return true
      } catch (error) {
        if (owner === generation) stop('failed', error.message || String(error))
        return false
      }
    }
    async function enable({ deviceId } = {}) {
      if (disposed) return false
      const owner = ++generation
      release()
      state('requesting')
      if (!active(owner)) return false
      if (env.isSecureContext !== true) {
        state('restricted', 'Microphone input requires a trusted secure source; ordinary LAN HTTP is restricted.')
        return false
      }
      const media = env.navigator?.mediaDevices
      const Audio = env.AudioContext || env.webkitAudioContext
      if (!media?.getUserMedia || !Audio) {
        state('unavailable', 'Microphone capture or Web Audio is unavailable on this page.')
        return false
      }
      let acquired = null
      try {
        // Start AudioContext from the same user action, before awaiting permission.
        context = new Audio()
        const activeContext = context
        const resumed = Promise.resolve(activeContext.resume())
        resumed.catch(() => {})
        acquired = await media.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false })
        if (!active(owner)) {
          for (const track of acquired.getTracks()) track.stop()
          return false
        }
        stream = acquired
        for (const track of stream.getTracks()) track.addEventListener('ended', ended)
        await resumed
        if (!active(owner)) {
          return false
        }
        analyser = activeContext.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = .8
        analyser.minDecibels = -100
        analyser.maxDecibels = -30
        source = activeContext.createMediaStreamSource(stream)
        source.connect(analyser)
        return sample(owner)
      } catch (error) {
        if (owner !== generation) {
          if (acquired) for (const track of acquired.getTracks()) track.stop()
          return false
        }
        stop(error.name === 'NotAllowedError' || error.name === 'SecurityError' ? 'denied' : error.name === 'NotFoundError' || error.name === 'OverconstrainedError' ? 'unavailable' : 'failed', error.message || String(error))
        return false
      }
    }
    return {
      enable,
      stop,
      async devices() {
        const devices = await env.navigator?.mediaDevices?.enumerateDevices?.() || []
        return devices.filter(device => device.kind === 'audioinput').map(device => ({ id: device.deviceId, label: device.label || 'Audio input' }))
      },
      dispose() {
        disposed = true
        stop()
        env.document?.removeEventListener('visibilitychange', hidden)
        env.removeEventListener?.('pagehide', unload)
      },
    }
  }
  function microphoneSample(value) {
    if (!value || value.version !== 1 || value.fftSize !== 1024 || !Number.isFinite(value.sampleRate) || value.sampleRate < 8000 || value.sampleRate > 384000) return null
    for (const key of ['envelope', 'peak']) if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) return null
    for (const [key, length, min, max] of [['waveform', 1024, -1, 1], ['fft', 512, -100, 0]]) {
      if (!Array.isArray(value[key]) || value[key].length !== length || !value[key].every(item => Number.isFinite(item) && item >= min && item <= max)) return null
    }
    return { version: 1, sampleRate: value.sampleRate, fftSize: 1024, envelope: value.envelope, peak: value.peak, waveform: value.waveform.slice(), fft: value.fft.slice() }
  }
  function microphoneAction(payload) {
    if (!payload || payload.kind !== 'microphone' || Object.keys(payload).some(key => !['kind', 'sample'].includes(key))) return null
    const sample = microphoneSample(payload.sample)
    return sample ? { kind: 'microphone', sample } : null
  }
  function connectMicrophone(player, options = {}) {
    return createDeviceMicrophone({ ...options, onSample(sample) {
      // The players connector rechecks socket.connected synchronously, so no
      // disconnected samples enter Socket.IO's reconnection send buffer.
      if (player.connected && player.joined && (options.canSend?.() ?? true)) player.sendAction({ kind: 'microphone', sample })
      options.onSample?.(sample)
    } })
  }
  function mountMicrophoneControls({ player, container, locale = 'en', ...options }) {
    const env = options.environment || globalThis
    const doc = env.document
    const zh = locale === 'zh-CN'
    const group = doc.createElement('fieldset')
    const legend = doc.createElement('legend')
    legend.textContent = zh ? '设备麦克风' : 'Device microphone'
    const select = doc.createElement('select')
    select.setAttribute('aria-label', zh ? '音频输入' : 'Audio input')
    const start = doc.createElement('button'), stopButton = doc.createElement('button'), status = doc.createElement('p')
    start.type = stopButton.type = 'button'
    start.textContent = zh ? '启用 / 切换输入' : 'Enable / switch input'
    stopButton.textContent = zh ? '停用' : 'Stop'
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    let disposed = false, refresh = 0
    const mic = connectMicrophone(player, { ...options, onState(state) {
      if (disposed) return
      start.disabled = state.status === 'requesting'
      status.textContent = state.status + (state.message ? ': ' + state.message : '')
      options.onState?.(state)
    } })
    async function choices() {
      const request = ++refresh
      try {
        const devices = await mic.devices()
        if (disposed || request !== refresh) return
        const previous = select.value
        select.replaceChildren()
        const fallback = doc.createElement('option')
        fallback.value = ''
        fallback.textContent = zh ? '系统默认输入' : 'System default input'
        select.append(fallback)
        for (const device of devices) {
          const option = doc.createElement('option')
          option.value = device.id
          option.textContent = device.label
          select.append(option)
        }
        if ([...select.options].some(option => option.value === previous)) select.value = previous
      } catch (error) {
        if (!disposed) status.textContent = error.message || String(error)
      }
    }
    start.onclick = async () => { await mic.enable({ deviceId: select.value || undefined }); await choices() }
    stopButton.onclick = () => mic.stop()
    group.append(legend, select, start, stopButton, status)
    container.append(group)
    env.navigator?.mediaDevices?.addEventListener?.('devicechange', choices)
    void choices()
    return {
      input: mic,
      dispose() {
        disposed = true
        refresh++
        mic.dispose()
        env.navigator?.mediaDevices?.removeEventListener?.('devicechange', choices)
        start.onclick = stopButton.onclick = null
        group.remove()
      },
    }
  }
  return { createDeviceMicrophone, connectMicrophone, microphoneSample, microphoneAction, mountMicrophoneControls }
})
