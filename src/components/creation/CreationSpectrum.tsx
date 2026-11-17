import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { onCreationAudioAnalyzer } from '@/lib/events'
import { logger } from '@/lib/logger'
import {
  MAX_SPECTRUM_DB,
  MIN_SPECTRUM_DB,
  readSpectrum,
  spectrumColumns,
  spectrumEnd,
  spectrumFraction,
  spectrumPitch,
  type AudioSpectrum,
  type SpectrumReading,
} from '@/lib/audio-spectrum'
import { commands } from '@/lib/tauri-bindings'
import { useCreationSpectrumStore } from '@/store/creation-spectrum-store'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import './creation-spectrum.css'

const STATS_REFRESH_MS = 5_000
const STATS_STALE_MS = 12_000
const FRAME_STALE_MS = 2_000
const WATCH_INTERVAL_MS = 500

function useCreationAudioGeneration(): string | null {
  const active = useCreationStore(state => state.active)
  const root = useCreationStore(state => state.workspace?.project.root)
  const runtimePath = useCreationStore(state =>
    state.runtimeProject?.root === root ? state.runtimeProject?.path : undefined
  )
  return useSessionStore(state => {
    const snapshot = state.latestSnapshot
    if (
      !active ||
      !root ||
      state.sessionStatus !== 'ready' ||
      snapshot?.status !== 'ready' ||
      snapshot.audioMode !== 'internal' ||
      (snapshot.projectPath !== root && snapshot.projectPath !== runtimePath)
    )
      return null
    return snapshot.runtimeGeneration || null
  })
}

let analyzerQueue = Promise.resolve()

function setAnalyzer(generation: string, enabled: boolean): void {
  analyzerQueue = analyzerQueue.then(async () => {
    try {
      const result = await commands.setCreationAudioAnalyzer(
        generation,
        enabled
      )
      if (result.status === 'error' && enabled)
        logger.debug('Creation audio analyzer unavailable', {
          error: result.error,
        })
    } catch (error) {
      if (enabled)
        logger.debug('Creation audio analyzer request failed', { error })
    }
  })
}

/** One owner for both layouts. A layout change only moves the display. */
export function CreationSpectrumTelemetry() {
  const generation = useCreationAudioGeneration()

  useEffect(() => {
    if (!generation) return
    const store = useCreationSpectrumStore
    let stopped = false
    let unlisten: (() => void) | undefined
    let enabled = false
    let lastFrame = 0
    let pendingStats = false
    store.setState({ generation, frame: null, stats: null })

    void onCreationAudioAnalyzer(frame => {
      if (stopped || frame.generation !== generation) return
      lastFrame = performance.now()
      store.setState({ frame })
    })
      .then(off => {
        if (stopped) {
          off()
          return
        }
        unlisten = off
        enabled = true
        setAnalyzer(generation, true)
      })
      .catch(error =>
        logger.debug('Creation audio listener unavailable', { error })
      )

    const readStats = async () => {
      if (pendingStats) return
      pendingStats = true
      try {
        const result = await commands.getCreationAudioStats(generation)
        if (!stopped && result.status === 'ok') {
          const stats = result.data
          store.setState({
            stats:
              stats && Date.now() - stats.observedAt <= STATS_STALE_MS
                ? stats
                : null,
          })
        }
      } catch (error) {
        if (!stopped) logger.trace('Creation DSP status unavailable', { error })
      } finally {
        pendingStats = false
      }
    }
    void readStats()
    const statsTimer = window.setInterval(
      () => void readStats(),
      STATS_REFRESH_MS
    )
    const staleTimer = window.setInterval(() => {
      const { frame, stats } = store.getState()
      if (frame && performance.now() - lastFrame > FRAME_STALE_MS)
        store.setState({ frame: null })
      if (stats && Date.now() - stats.observedAt > STATS_STALE_MS)
        store.setState({ stats: null })
    }, WATCH_INTERVAL_MS)

    return () => {
      stopped = true
      unlisten?.()
      window.clearInterval(statsTimer)
      window.clearInterval(staleTimer)
      if (enabled) setAnalyzer(generation, false)
      store.setState({ generation: null, frame: null, stats: null })
    }
  }, [generation])

  return null
}

interface Paint {
  grid: string
  trace: string
  low: string
  mid: string
  high: string
  cursor: string
}

function spectrumPaint(canvas: HTMLCanvasElement): Paint {
  const styles = getComputedStyle(canvas)
  const color = (name: string) => styles.getPropertyValue(name).trim()
  return {
    grid: color('--pnds-creation-line'),
    cursor: color('--pnds-accent-text'),
    trace: color('--spectrum-trace'),
    low: color('--spectrum-low'),
    mid: color('--spectrum-mid'),
    high: color('--spectrum-high'),
  }
}

function drawSpectrum(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  frame: AudioSpectrum,
  paint: Paint,
  selection: number | null
): SpectrumReading | null {
  const width = Math.floor(canvas.clientWidth)
  const height = Math.floor(canvas.clientHeight)
  const scale = window.devicePixelRatio || 1
  if (width < 2 || height < 2) return null
  const rasterWidth = Math.round(width * scale)
  const rasterHeight = Math.round(height * scale)
  if (canvas.width !== rasterWidth) canvas.width = rasterWidth
  if (canvas.height !== rasterHeight) canvas.height = rasterHeight
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.clearRect(0, 0, width, height)

  const top = 2
  const bottom = height - 2
  const end = spectrumEnd(frame)
  const y = (db: number) =>
    bottom -
    ((Math.min(MAX_SPECTRUM_DB, db) - MIN_SPECTRUM_DB) /
      (MAX_SPECTRUM_DB - MIN_SPECTRUM_DB)) *
      (bottom - top)
  const columns = spectrumColumns(frame, width)
  const trace = new Path2D()
  columns.forEach((db, x) => {
    if (x === 0) trace.moveTo(x, y(db))
    else trace.lineTo(x, y(db))
  })
  const area = new Path2D(trace)
  area.lineTo(width - 1, bottom)
  area.lineTo(0, bottom)
  area.closePath()
  const gradient = context.createLinearGradient(0, bottom, 0, top)
  gradient.addColorStop(0, paint.low)
  gradient.addColorStop(0.58, paint.mid)
  gradient.addColorStop(1, paint.high)
  context.fillStyle = gradient
  context.fill(area)

  context.strokeStyle = paint.grid
  context.globalAlpha = 0.45
  context.lineWidth = 1
  for (const frequency of [100, 1_000, 10_000]) {
    if (frequency >= end) continue
    const x = spectrumFraction(frequency, end) * (width - 1)
    context.beginPath()
    context.moveTo(x, top)
    context.lineTo(x, bottom)
    context.stroke()
  }
  context.globalAlpha = 1
  context.strokeStyle = paint.trace
  context.lineWidth = 1.25
  context.stroke(trace)
  if (selection === null) return null

  const reading = readSpectrum(frame, selection, 10 / width)
  const x = spectrumFraction(reading.frequency, end) * (width - 1)
  context.strokeStyle = paint.cursor
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(x, top)
  context.lineTo(x, bottom)
  context.stroke()
  context.fillStyle = paint.cursor
  context.beginPath()
  context.arc(x, y(reading.db), 2, 0, Math.PI * 2)
  context.fill()
  return reading
}

export function CreationSpectrum() {
  const { t, i18n } = useTranslation()
  const generation = useCreationAudioGeneration()
  const visible = useCreationSpectrumStore(
    state =>
      !!generation && state.generation === generation && state.frame !== null
  )
  const theme = useSettingsStore(state => state.colorThemeSetting)
  const channels = useSessionStore(
    state => state.latestSnapshot?.channelPlan?.projectChannels ?? 1
  )
  const canvas = useRef<HTMLCanvasElement>(null)
  const selected = useRef<number | null>(null)
  const redraw = useRef<(() => void) | null>(null)
  const [reading, setReading] = useState<SpectrumReading | null>(null)

  useEffect(() => {
    const element = canvas.current
    if (!visible || !element) return
    const context = element.getContext('2d')
    if (!context) return
    const paint = spectrumPaint(element)
    const draw = () => {
      const { frame } = useCreationSpectrumStore.getState()
      if (!frame || frame.generation !== generation) return
      const next = drawSpectrum(
        element,
        context,
        frame,
        paint,
        selected.current
      )
      if (selected.current !== null) setReading(next)
    }
    redraw.current = draw
    const off = useCreationSpectrumStore.subscribe((state, previous) => {
      if (state.frame !== previous.frame) draw()
    })
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(draw)
    observer?.observe(element)
    const initialFrame = requestAnimationFrame(draw)
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(initialFrame)
      off()
      redraw.current = null
    }
  }, [generation, theme, visible])

  if (!visible) return null
  const source = t(
    channels > 1 ? 'creation.spectrumStereo' : 'creation.spectrumMono'
  )
  const formatter = new Intl.NumberFormat(i18n.resolvedLanguage, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  const pitch = reading?.peak ? spectrumPitch(reading.frequency) : null
  const level = reading
    ? t('creation.spectrumLevel', { db: formatter.format(reading.db) })
    : undefined
  const frequency = reading
    ? t('creation.spectrumFrequency', {
        frequency: formatter.format(reading.frequency),
      })
    : undefined
  const note = pitch
    ? t('creation.spectrumPitch', {
        note: pitch.note,
        cents: pitch.cents < 0 ? String(pitch.cents) : `+${pitch.cents}`,
      })
    : undefined
  function select(fraction: number | null) {
    selected.current = fraction
    if (fraction === null) setReading(null)
    redraw.current?.()
  }
  function pointAt(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width > 0)
      select(
        Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width))
      )
  }
  return (
    <figure className="creation-spectrum" aria-label={source}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={t('creation.spectrum')}
        onPointerDown={pointAt}
        onPointerMove={pointAt}
        onPointerLeave={() => select(null)}
      />
      <input
        className="creation-spectrum-cursor"
        type="range"
        min="0"
        max="200"
        defaultValue="40"
        aria-label={t('creation.spectrumCursor')}
        aria-valuetext={
          [level, frequency, note].filter(Boolean).join(' · ') || undefined
        }
        onFocus={event => select(Number(event.currentTarget.value) / 200)}
        onChange={event => select(Number(event.currentTarget.value) / 200)}
        onBlur={() => select(null)}
      />
      {reading && (
        <figcaption
          className="creation-spectrum-readout"
          data-native-overlay=""
        >
          <span dir="ltr">{level}</span>
          <span dir="ltr">{frequency}</span>
          <span dir="ltr" aria-hidden={!note}>
            {note ?? '—'}
          </span>
        </figcaption>
      )}
    </figure>
  )
}

export function CreationSpectrumStats() {
  const { t, i18n } = useTranslation()
  const generation = useCreationAudioGeneration()
  const stats = useCreationSpectrumStore(state =>
    generation && state.generation === generation ? state.stats : null
  )
  if (!stats) return null
  const formatter = new Intl.NumberFormat(i18n.resolvedLanguage)
  return (
    <p className="creation-spectrum-stats">
      {t('creation.spectrumDsp', {
        average: formatter.format(Math.round(stats.averageCpu)),
        peak: formatter.format(Math.round(stats.peakCpu)),
        synths: formatter.format(stats.synths),
      })}
    </p>
  )
}
