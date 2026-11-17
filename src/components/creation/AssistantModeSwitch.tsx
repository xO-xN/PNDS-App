import { TooltipHint } from '@/components/ui/tooltip'
import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type PointerEvent,
} from 'react'
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { AssistantMode } from '@/lib/tauri-bindings'

const MODES = ['discussion', 'edit'] as const
const INSET = 2
const SPEED = 0.8
const SQUASH = 5
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))
const rubber = (over: number, width: number) =>
  (over * width * 0.55) / (width + 0.55 * Math.abs(over))

interface Slot {
  left: number
  right: number
}
interface Drag {
  id: number
  button: HTMLButtonElement
  start: number
  offset: number
  width: number
  live: boolean
  history: { time: number; x: number }[]
}

/** React Bits RubberSegment, adapted to the assistant's controlled mode boundary. */
export function AssistantModeSwitch({
  value,
  disabled,
  onChange,
}: {
  value: AssistantMode
  disabled: boolean
  onChange: (value: AssistantMode) => void
}) {
  const { t, i18n } = useTranslation()
  const reducedMotion = useReducedMotion()
  const track = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const slots = useRef<Slot[]>([])
  const drag = useRef<Drag | null>(null)
  const suppressClick = useRef(false)
  const requested = useRef<AssistantMode | null>(null)
  const latestValue = useRef(value)
  const generation = useRef(0)
  const reconcileFrame = useRef<number | null>(null)
  const left = useMotionValue(0)
  const right = useMotionValue(0)
  const width = useMotionValue(0)
  const clipPath = useTransform(
    () =>
      `inset(0 ${Math.max(0, width.get() - right.get())}px 0 ${Math.max(0, left.get())}px round var(--assistant-mode-thumb-radius))`
  )

  const release = () => {
    const current = drag.current
    drag.current = null
    if (current?.live) suppressClick.current = true
    if (track.current) delete track.current.dataset.held
    if (current?.button.hasPointerCapture(current.id))
      current.button.releasePointerCapture(current.id)
    return current
  }
  const jump = (mode: AssistantMode) => {
    generation.current += 1
    left.stop()
    right.stop()
    const slot = slots.current[MODES.indexOf(mode)]
    if (!slot) return
    left.jump(slot.left)
    right.jump(slot.right)
  }
  const staticMotion = () =>
    reducedMotion || !!track.current?.closest('[data-color-theme="brutal"]')

  const land = (mode: AssistantMode, velocity = 0, flick = false) => {
    const slot = slots.current[MODES.indexOf(mode)]
    if (!slot) return
    if (staticMotion()) {
      jump(mode)
      return
    }
    const currentGeneration = ++generation.current
    left.stop()
    right.stop()
    const direction =
      Math.sign(slot.left + slot.right - left.get() - right.get()) || 1
    const [lead, leadTo, trail, trailTo] =
      direction > 0
        ? [right, slot.right, left, slot.left]
        : [left, slot.left, right, slot.right]
    const spring = {
      type: 'spring' as const,
      duration: (flick ? 0.4 : 0.3) / SPEED,
      bounce: flick ? 0.2 : 0,
      velocity: clamp(velocity, -2000, 2000),
    }
    void animate(lead, leadTo, spring)
    void animate(trail, trailTo + direction * SQUASH, spring).then(() => {
      if (generation.current !== currentGeneration) return
      void animate(trail, trailTo, {
        type: 'spring',
        duration: 0.16 / SPEED,
        bounce: 0,
      })
    })
  }

  const choose = (
    next: AssistantMode,
    velocity = 0,
    flick = false,
    keyboard = false
  ) => {
    if (disabled) return
    if (keyboard) jump(next)
    else land(next, velocity, flick)
    if (next === value) return
    requested.current = next
    onChange(next)
    // The store is authoritative even when it refuses a controlled change.
    if (reconcileFrame.current !== null)
      cancelAnimationFrame(reconcileFrame.current)
    reconcileFrame.current = requestAnimationFrame(() => {
      reconcileFrame.current = null
      if (latestValue.current !== next) jump(latestValue.current)
      requested.current = null
    })
  }

  const measure = useEffectEvent(() => {
    const element = track.current
    if (!element) return
    release()
    const rect = element.getBoundingClientRect()
    slots.current = buttons.current.map(button => {
      const item = button?.getBoundingClientRect()
      return {
        left: item ? item.left - rect.left - element.clientLeft - INSET : 0,
        right: item ? item.right - rect.left - element.clientLeft - INSET : 0,
      }
    })
    width.set(Math.max(0, rect.width - element.clientLeft * 2 - INSET * 2))
    jump(value)
  })
  const synchronize = useEffectEvent(() => {
    latestValue.current = value
    if (!disabled && requested.current === value) {
      requested.current = null
      return
    }
    release()
    requested.current = null
    jump(value)
  })
  useLayoutEffect(() => synchronize(), [value, disabled, reducedMotion])
  useLayoutEffect(() => {
    let disposed = false
    const remeasure = () => {
      if (!disposed) measure()
    }
    remeasure()
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(remeasure)
    if (track.current) observer?.observe(track.current)
    const attributes = new MutationObserver(remeasure)
    attributes.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-color-theme', 'dir', 'lang'],
    })
    window.addEventListener('resize', remeasure)
    window.addEventListener('blur', remeasure)
    void document.fonts?.ready.then(remeasure)
    return () => {
      disposed = true
      observer?.disconnect()
      attributes.disconnect()
      window.removeEventListener('resize', remeasure)
      window.removeEventListener('blur', remeasure)
      release()
      generation.current += 1
      left.stop()
      right.stop()
      if (reconcileFrame.current !== null)
        cancelAnimationFrame(reconcileFrame.current)
    }
  }, [i18n.resolvedLanguage, left, right])

  const localX = (event: PointerEvent) => {
    const element = track.current
    return (
      event.clientX -
      (element?.getBoundingClientRect().left ?? 0) -
      (element?.clientLeft ?? 0) -
      INSET
    )
  }
  const cancel = (event: PointerEvent) => {
    if (drag.current?.id !== event.pointerId) return
    release()
    jump(value)
  }

  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={t('assistant.mode.label')}
      aria-disabled={disabled || undefined}
      className="creation-assistant-mode"
      onKeyDown={event => {
        if (
          disabled ||
          ![
            'ArrowLeft',
            'ArrowRight',
            'ArrowUp',
            'ArrowDown',
            'Home',
            'End',
          ].includes(event.key)
        )
          return
        event.preventDefault()
        release()
        const next =
          event.key === 'Home'
            ? 'discussion'
            : event.key === 'End'
              ? 'edit'
              : value === 'discussion'
                ? 'edit'
                : 'discussion'
        choose(next, 0, false, true)
        buttons.current[MODES.indexOf(next)]?.focus()
      }}
      onPointerMove={event => {
        const current = drag.current
        if (disabled || !current || current.id !== event.pointerId) return
        const x = localX(event)
        current.history.push({ time: event.timeStamp, x })
        if (current.history.length > 8) current.history.shift()
        if (!current.live) {
          if (Math.abs(x - current.start) < 4) return
          current.live = true
          if (track.current) track.current.dataset.held = ''
        }
        const position = x - current.offset
        const max = Math.max(0, width.get() - current.width)
        if (staticMotion()) {
          const bounded = clamp(position, 0, max)
          left.set(bounded)
          right.set(bounded + current.width)
        } else if (position < 0) {
          left.set(0)
          right.set(current.width - rubber(-position, current.width))
        } else if (position > max) {
          right.set(width.get())
          left.set(max + rubber(position - max, current.width))
        } else {
          left.set(position)
          right.set(position + current.width)
        }
      }}
      onPointerUp={event => {
        if (drag.current?.id !== event.pointerId) return
        const current = release()
        if (!current?.live) return
        if (disabled) return
        const history = current.history.filter(
          sample => event.timeStamp - sample.time <= 100
        )
        const first = history[0]
        const last = history.at(-1)
        const velocity =
          first && last && last.time - first.time >= 8
            ? clamp(
                ((last.x - first.x) / (last.time - first.time)) * 1000,
                -2000,
                2000
              )
            : 0
        const damping = 1 - 0.1 * Math.pow(0.05, 0.65)
        const projection = ((velocity / 1000) * damping) / (1 - damping)
        const target = (left.get() + right.get()) / 2 + projection
        const [discussion, edit] = slots.current
        if (!discussion || !edit) {
          jump(value)
          return
        }
        const distance = (slot: Slot) =>
          Math.abs((slot.left + slot.right) / 2 - target)
        let next: AssistantMode =
          distance(discussion) <= distance(edit) ? 'discussion' : 'edit'
        const flick = Math.abs(velocity) > 110
        const towardEdit = Math.sign(
          edit.left + edit.right - discussion.left - discussion.right
        )
        if (
          flick &&
          next === value &&
          Math.sign(velocity) ===
            (value === 'discussion' ? towardEdit : -towardEdit)
        )
          next = value === 'discussion' ? 'edit' : 'discussion'
        choose(next, velocity, flick)
        buttons.current[MODES.indexOf(next)]?.focus()
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      {MODES.map((mode, index) => (
        <TooltipHint key={mode} content={t(`assistant.mode.${mode}Hint`)}>
          <button
            ref={element => {
              buttons.current[index] = element
            }}
            type="button"
            role="radio"
            data-mode={mode}
            aria-label={t(`assistant.mode.${mode}`)}
            aria-checked={value === mode}
            tabIndex={value === mode ? 0 : -1}
            disabled={disabled}
            className="creation-assistant-mode-item pnds-focus-ring"
            onPointerDown={event => {
              if (disabled || drag.current || event.button !== 0) return
              suppressClick.current = false
              if (mode !== value) return
              const x = localX(event)
              if (
                x < left.get() ||
                x > right.get() ||
                right.get() <= left.get()
              )
                return
              generation.current += 1
              left.stop()
              right.stop()
              drag.current = {
                id: event.pointerId,
                button: event.currentTarget,
                start: x,
                offset: x - left.get(),
                width: right.get() - left.get(),
                live: false,
                history: [{ time: event.timeStamp, x }],
              }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onClick={event => {
              if (event.detail > 0 && suppressClick.current) {
                suppressClick.current = false
                return
              }
              choose(mode)
            }}
          >
            {t(`assistant.mode.${mode}`)}
          </button>
        </TooltipHint>
      ))}
      <motion.div
        aria-hidden="true"
        className="creation-assistant-mode-thumb"
        style={{ clipPath }}
      >
        {MODES.map(mode => (
          <span key={mode} className="creation-assistant-mode-item">
            {t(`assistant.mode.${mode}`)}
          </span>
        ))}
      </motion.div>
    </div>
  )
}
