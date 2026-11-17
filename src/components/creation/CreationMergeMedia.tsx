import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Music2, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  commands,
  type GitMergeContent,
  type GitMergeSide,
  type AudioPreviewSnapshot,
} from '@/lib/tauri-bindings'
import { creationTestOutput, timeLabel } from '@/lib/creation-test-audio'
import { onCreationAudioPreviewDisconnected } from '@/lib/events'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationMergeStore } from '@/store/creation-merge-store'

function MergeImage({
  content,
  alt,
  summary,
}: {
  content: GitMergeContent
  alt: string
  summary: string
}) {
  const [dimensions, setDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  return (
    <>
      <div className="creation-merge-image">
        <img
          src={content.url ?? undefined}
          alt={alt}
          onLoad={event => {
            const { naturalWidth: width, naturalHeight: height } =
              event.currentTarget
            if (width > 0 && height > 0) setDimensions({ width, height })
          }}
        />
      </div>
      <div className="creation-merge-media-facts">
        <span>{summary}</span>
        {dimensions && (
          <span>
            {dimensions.width} × {dimensions.height}
          </span>
        )}
      </div>
    </>
  )
}

function MergeAudio({
  content,
  side,
}: {
  content: GitMergeContent
  side: GitMergeSide
}) {
  const { t } = useTranslation()
  const identity = useCreationMergeStore(state => state.identity)
  const candidate = useCreationMergeStore(state => state.candidate)
  const project = useCreationStore(state => state.workspace?.project)
  const runtimeProject = useCreationStore(state => state.runtimeProject)
  const ready = useSessionStore(state => state.sessionStatus === 'ready')
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const selection = useSessionStore(state => state.outputDevice)
  const output = creationTestOutput(
    project,
    runtimeProject,
    ready ? snapshot : null,
    selection
  )
  const token = useRef<string | null>(null)
  const request = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const retirePreview = useEffectEvent(() => {
    request.current++
    const preview = token.current
    token.current = null
    setPlaying(false)
    setBusy(false)
    if (preview)
      void commands.stopPendingAudioPreview(preview).catch(() => undefined)
  })
  useEffect(() => {
    const unsubscribe = onCreationAudioPreviewDisconnected(({ preview }) => {
      if (preview === token.current) {
        token.current = null
        request.current++
        setPlaying(false)
        setFailed(true)
      }
    })
    return () => {
      unsubscribe()
      retirePreview()
    }
  }, [output, content.version])
  useEffect(() => {
    if (!playing || busy) return
    let active = true
    const timer = setInterval(() => {
      const preview = token.current
      if (!preview) return
      void commands
        .controlPendingAudioPreview(preview, { action: 'status' })
        .then(result => {
          if (!active || token.current !== preview) return
          if (result.status === 'error') {
            token.current = null
            setPlaying(false)
          } else setPlaying(result.data.playing)
        })
        .catch(() => {
          if (active) {
            setPlaying(false)
            setFailed(true)
          }
        })
    }, 250)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [busy, playing])
  const toggle = async () => {
    if (busy || !identity || !candidate) return
    const revision = ++request.current
    setBusy(true)
    setFailed(false)
    try {
      if (token.current && playing) {
        const preview = token.current
        const stopped = await commands.stopPendingAudioPreview(preview)
        if (stopped.status === 'error') throw stopped.error
        if (request.current === revision) {
          token.current = null
          setPlaying(false)
        }
        return
      }
      const preview = crypto.randomUUID()
      token.current = preview
      const result = await commands.startMergeAudioPreview({
        identity,
        candidateId: candidate.id,
        revision: candidate.revision,
        path: content.path,
        side,
        version: content.version,
        preview,
        device: output,
        positionMs: 0,
        gain: 0.75,
      })
      if (request.current !== revision || token.current !== preview) {
        if (result.status === 'ok')
          await commands.stopPendingAudioPreview(preview)
        return
      }
      if (result.status === 'error') throw result.error
      const state: AudioPreviewSnapshot = result.data
      setPlaying(state.playing)
    } catch {
      if (request.current === revision) {
        const preview = token.current
        token.current = null
        setPlaying(false)
        setFailed(true)
        if (preview)
          void commands.stopPendingAudioPreview(preview).catch(() => undefined)
      }
    } finally {
      if (request.current === revision) setBusy(false)
    }
  }
  const peaks = content.waveform ?? []
  return (
    <div className="creation-merge-audio">
      {peaks.length ? (
        <svg
          viewBox={`0 0 ${peaks.length * 4} 64`}
          role="img"
          aria-label={t('creation.merge.waveform')}
        >
          {peaks.map((peak, index) => (
            <rect
              key={index}
              x={index * 4}
              y={32 - Math.min(1, Math.max(0, peak)) * 28}
              width="2"
              height={Math.max(1, Math.min(1, Math.max(0, peak)) * 56)}
              rx="1"
            />
          ))}
        </svg>
      ) : (
        <Music2 aria-hidden="true" className="creation-merge-audio-icon" />
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void toggle()}
        aria-pressed={playing}
      >
        {playing ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
        {t(playing ? 'creation.merge.stopListening' : 'creation.merge.listen')}
      </Button>
      {failed && <p role="status">{t('creation.merge.audioUnavailable')}</p>}
    </div>
  )
}

export function CreationMergeMedia({
  path,
  locked,
}: {
  path: string
  locked: boolean
}) {
  const { t, i18n } = useTranslation()
  const candidate = useCreationMergeStore(state => state.candidate)
  const current = useCreationMergeStore(
    state => state.contents[`current:${path}`]
  )
  const incoming = useCreationMergeStore(
    state => state.contents[`incoming:${path}`]
  )
  useEffect(() => {
    for (const side of ['current', 'incoming'] as const)
      void useCreationMergeStore.getState().read(path, side)
  }, [path, candidate?.revision])
  const size = (bytes: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'unit',
      unit: bytes >= 1_000_000 ? 'megabyte' : 'kilobyte',
      maximumFractionDigits: 1,
    }).format(bytes / (bytes >= 1_000_000 ? 1_000_000 : 1_000))
  return (
    <div className="creation-merge-media-grid">
      {(['current', 'incoming'] as const).map(side => {
        const content = side === 'current' ? current : incoming
        const image = content?.mime?.startsWith('image/') && content.url
        return (
          <article className="creation-merge-media-column" key={side}>
            <header>
              <strong>{t(`creation.merge.${side}`)}</strong>
              <span
                title={
                  side === 'current' ? candidate?.target : candidate?.source
                }
              >
                {(side === 'current'
                  ? candidate?.target
                  : candidate?.source
                )?.slice(0, 8)}
              </span>
            </header>
            {!content ? (
              <p role="status">{t('creation.loading')}</p>
            ) : !content.exists ? (
              <p>{t('creation.merge.missingFile')}</p>
            ) : (
              <>
                {image ? (
                  <MergeImage
                    key={`${side}:${content.version}`}
                    content={content}
                    alt={t(`creation.merge.${side}`)}
                    summary={`${content.mime} · ${size(content.size)}`}
                  />
                ) : content.mime?.startsWith('audio/') ? (
                  <MergeAudio
                    key={`${side}:${content.version}`}
                    content={content}
                    side={side}
                  />
                ) : (
                  <p className="creation-merge-media-kind">
                    {content.mime ?? path.split('.').at(-1)}
                  </p>
                )}
                {!image && (
                  <div className="creation-merge-media-facts">
                    <span>
                      {content.mime ?? path.split('.').at(-1)} ·{' '}
                      {size(content.size)}
                    </span>
                    {content.durationMs != null && (
                      <span>
                        {timeLabel(content.durationMs)}
                        {content.sampleRate
                          ? ` · ${content.sampleRate / 1000} kHz`
                          : ''}
                        {content.channels
                          ? ` · ${t('creation.merge.channels', { count: content.channels })}`
                          : ''}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={locked || !content}
              onClick={() =>
                void useCreationMergeStore
                  .getState()
                  .choose(path, side)
                  .catch(() => undefined)
              }
            >
              {t(
                side === 'current'
                  ? 'creation.merge.keepCurrent'
                  : 'creation.merge.useIncoming'
              )}
            </Button>
          </article>
        )
      })}
    </div>
  )
}
