import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pause, Play, Speaker } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { creationTestOutput, timeLabel } from '@/lib/creation-test-audio'
import { onCreationAudioPreviewDisconnected } from '@/lib/events'
import {
  commands,
  type AudioPreviewAction,
  type AudioPreviewError,
  type AudioPreviewSnapshot,
  type CreationPendingMedia,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'

export function CreationPendingAudio({
  identity,
  media,
}: {
  identity: string
  media: CreationPendingMedia
}) {
  const { t } = useTranslation()
  const project = useCreationStore(state => state.workspace?.project)
  const runtimeProject = useCreationStore(state => state.runtimeProject)
  const ready = useSessionStore(state => state.sessionStatus === 'ready')
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const selection = useSessionStore(state => state.outputDevice)
  const [gain, setGain] = useState(0.75)
  const output = creationTestOutput(
    project,
    runtimeProject,
    ready ? snapshot : null,
    selection
  )
  return (
    <AudioPreview
      key={output ?? ''}
      gain={gain}
      onGainChange={setGain}
      output={output}
      identity={identity}
      media={media}
      outputLabel={output ?? t('sidebar.systemDefault')}
    />
  )
}

function AudioPreview({
  identity,
  media,
  output,
  outputLabel,
  gain,
  onGainChange,
}: {
  identity: string
  media: CreationPendingMedia
  output: string | null
  outputLabel: string
  gain: number
  onGainChange: (gain: number) => void
}) {
  const { t } = useTranslation()
  const volumeLabel = useId()
  const [state, setState] = useState<AudioPreviewSnapshot>({
    positionMs: 0,
    durationMs: media.durationMs ?? 0,
    playing: false,
  })
  const [busy, setBusy] = useState(false)
  const [seeking, setSeeking] = useState<number | null>(null)
  const [error, setError] = useState<AudioPreviewError | null>(null)
  const token = useRef<string | null>(null)
  const revision = useRef(0)
  useEffect(() => {
    const unsubscribe = onCreationAudioPreviewDisconnected(({ preview }) => {
      if (token.current !== preview) return
      revision.current++
      token.current = null
      setBusy(false)
      setState(current => ({ ...current, playing: false }))
      setError('deviceDisconnected')
    })
    return () => {
      unsubscribe()
      const preview = token.current
      token.current = null
      if (preview)
        void commands.stopPendingAudioPreview(preview).catch(() => undefined)
    }
  }, [])
  useEffect(() => {
    if (!state.playing || busy) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      const preview = token.current
      const captured = revision.current
      if (!preview) return
      try {
        const result = await commands.controlPendingAudioPreview(preview, {
          action: 'status',
        })
        if (!active || token.current !== preview) return
        if (captured !== revision.current) return
        if (result.status === 'error') {
          token.current = null
          setError(result.error)
          setState(current => ({ ...current, playing: false }))
          return
        }
        setState(result.data)
        if (!result.data.playing) return
      } catch {
        if (!active || token.current !== preview) return
        token.current = null
        void commands.stopPendingAudioPreview(preview).catch(() => undefined)
        setError('playback')
        setState(current => ({ ...current, playing: false }))
        return
      }
      timer = setTimeout(() => void poll(), 250)
    }
    timer = setTimeout(() => void poll(), 250)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [busy, state.playing])

  const run = async (
    preview: string,
    operation: () => Promise<
      | { status: 'ok'; data: AudioPreviewSnapshot }
      | { status: 'error'; error: AudioPreviewError }
    >
  ) => {
    const captured = ++revision.current
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      if (revision.current !== captured || token.current !== preview) {
        if (token.current !== preview && result.status === 'ok')
          void commands.stopPendingAudioPreview(preview).catch(() => undefined)
        return
      }
      if (result.status === 'ok') setState(result.data)
      else {
        token.current = null
        void commands.stopPendingAudioPreview(preview).catch(() => undefined)
        setState(current => ({ ...current, playing: false }))
        setError(result.error)
      }
    } catch {
      if (revision.current !== captured || token.current !== preview) return
      token.current = null
      void commands.stopPendingAudioPreview(preview).catch(() => undefined)
      setState(current => ({ ...current, playing: false }))
      setError('playback')
    } finally {
      if (revision.current === captured) setBusy(false)
    }
  }

  const control = (action: AudioPreviewAction) => {
    const preview = token.current
    if (preview && !busy)
      void run(preview, () =>
        commands.controlPendingAudioPreview(preview, action)
      )
  }

  const seek = (positionMs: number) => {
    setState(current => ({ ...current, positionMs }))
    control({ action: 'seek', positionMs })
  }

  const toggle = () => {
    if (busy) return
    if (token.current) {
      control({ action: state.playing ? 'pause' : 'resume' })
      return
    }
    const preview = crypto.randomUUID()
    token.current = preview
    void run(preview, () =>
      commands.startPendingAudioPreview(
        identity,
        media.id,
        media.version,
        preview,
        output,
        state.positionMs,
        gain
      )
    )
  }

  return (
    <section
      aria-label={t('creation.pending.audioPreview')}
      className="space-y-4 p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={busy} onClick={toggle}>
          {state.playing ? (
            <Pause aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
          {t(
            state.playing
              ? 'creation.pending.audioPause'
              : 'creation.pending.audioPlay'
          )}
        </Button>
        <span className="flex items-center gap-1.5 text-xs">
          <Speaker aria-hidden="true" className="size-3.5" />
          {outputLabel}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-xs text-(--pnds-danger)">
          {t(`creation.pending.audioError.${error}`)}
        </p>
      )}
      <div className="space-y-1">
        <input
          type="range"
          className="w-full accent-primary"
          aria-label={t('creation.pending.audioPosition')}
          aria-valuetext={timeLabel(seeking ?? state.positionMs)}
          min={0}
          max={state.durationMs}
          step={100}
          value={seeking ?? state.positionMs}
          disabled={busy || !state.durationMs}
          onPointerDown={event => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            setSeeking(state.positionMs)
          }}
          onPointerUp={event => {
            if (seeking === null) return
            setSeeking(null)
            seek(Number(event.currentTarget.value))
          }}
          onPointerCancel={() => setSeeking(null)}
          onBlur={() => setSeeking(null)}
          onChange={event => {
            const positionMs = Number(event.currentTarget.value)
            if (seeking === null) seek(positionMs)
            else setSeeking(positionMs)
          }}
        />
        <div className="flex justify-between text-xs tabular-nums" dir="ltr">
          <span>{timeLabel(seeking ?? state.positionMs)}</span>
          <span>{timeLabel(state.durationMs)}</span>
        </div>
      </div>
      <label className="flex flex-wrap items-center gap-3 text-xs">
        <span id={volumeLabel}>{t('creation.pending.audioVolume')}</span>
        <input
          type="range"
          className="accent-primary"
          aria-labelledby={volumeLabel}
          aria-valuetext={t('creation.pending.zoomPercent', {
            percent: Math.round(gain * 100),
          })}
          min={0}
          max={100}
          step={1}
          value={Math.round(gain * 100)}
          disabled={busy}
          onChange={event => {
            const volume = Number(event.currentTarget.value) / 100
            onGainChange(volume)
            control({ action: 'volume', gain: volume })
          }}
        />
        <span className="tabular-nums">
          {t('creation.pending.zoomPercent', {
            percent: Math.round(gain * 100),
          })}
        </span>
      </label>
    </section>
  )
}
