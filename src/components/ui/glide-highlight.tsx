import { useLayoutEffect, useRef } from 'react'
import { useIndicatorPill } from '@/hooks/use-indicator-pill'

const ITEM = '[data-glide-item]'
const LIST = '.pnds-glide-list'

/** Decorative GlideSelect highlight; the host widget keeps all selection authority. */
export function GlideHighlight() {
  const pill = useRef<HTMLSpanElement>(null)
  const active = useRef<HTMLElement | null>(null)
  const selected = useRef<HTMLElement | null>(null)
  const pointerInside = useRef(false)
  const input = useRef<'pointer' | 'keyboard' | null>(null)

  const update = (instant = false, candidate?: HTMLElement | null) => {
    const element = pill.current
    const host = element?.parentElement
    if (!element || !host) return
    const valid = (item: HTMLElement | null): item is HTMLElement =>
      !!item &&
      host.contains(item) &&
      item.closest(LIST) === host &&
      !item.hasAttribute('data-disabled') &&
      item.getAttribute('aria-disabled') !== 'true' &&
      !item.hasAttribute('disabled')
    const items = Array.from(host.querySelectorAll<HTMLElement>(ITEM))
    const focused = document.activeElement?.closest<HTMLElement>(ITEM) ?? null
    const checked =
      items.find(
        item =>
          valid(item) &&
          (item.dataset.state === 'checked' ||
            item.getAttribute('aria-selected') === 'true')
      ) ?? null
    const selectionChanged = checked !== selected.current
    selected.current = checked
    const target =
      (valid(candidate ?? null) ? candidate : null) ??
      (selectionChanged && !pointerInside.current ? checked : null) ??
      items.find(
        item => valid(item) && item.hasAttribute('data-highlighted')
      ) ??
      (valid(focused) ? focused : null) ??
      (valid(active.current) ? active.current : null) ??
      checked
    if (!target) {
      active.current = null
      element.style.opacity = '0'
      delete host.dataset.glideLive
      return
    }
    active.current = target
    const bounds = host.getBoundingClientRect()
    const row = target.getBoundingClientRect()
    if (!bounds.width || !row.width || !row.height) {
      element.style.opacity = '0'
      delete host.dataset.glideLive
      return
    }
    // Compensate for the surface's entrance scale, including nested scrollers.
    const scaleX = host.offsetWidth ? bounds.width / host.offsetWidth : 1
    const scaleY =
      host.offsetHeight && bounds.height ? bounds.height / host.offsetHeight : 1
    const x =
      (row.left - bounds.left) / scaleX + host.scrollLeft - host.clientLeft
    const y = (row.top - bounds.top) / scaleY + host.scrollTop - host.clientTop
    element.dataset.instant = String(
      instant || selectionChanged || host.dataset.glideLive !== 'true'
    )
    element.dataset.variant = target.dataset.variant ?? 'default'
    element.style.transform = `translate(${x}px, ${y}px)`
    element.style.width = `${row.width / scaleX}px`
    element.style.height = `${row.height / scaleY}px`
    element.style.opacity = '1'
    host.dataset.glideLive = 'true'
  }

  useIndicatorPill({
    apply: () => update(input.current !== 'pointer'),
    remeasure: () => update(true),
  })
  useLayoutEffect(() => {
    const host = pill.current?.parentElement
    if (!host) return
    const pointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || !(event.target instanceof Element))
        return
      const target = event.target.closest<HTMLElement>(ITEM)
      if (target?.closest(LIST) !== host) return
      pointerInside.current = true
      input.current = 'pointer'
      if (target === active.current && host.dataset.glideLive === 'true') return
      update(false, target)
    }
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return
      const target = event.target.closest<HTMLElement>(ITEM)
      if (target?.closest(LIST) !== host) return
      update(input.current !== 'pointer', target)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(LIST) !== host
      )
        return
      input.current = 'keyboard'
    }
    const remeasure = () => update(true)
    const leave = () => {
      pointerInside.current = false
    }
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(remeasure)
    const observedRows = new Set<HTMLElement>()
    const observeRows = () => {
      if (!resize) return
      const rows = new Set(
        Array.from(host.querySelectorAll<HTMLElement>(ITEM)).filter(
          item => item.closest(LIST) === host
        )
      )
      for (const row of observedRows) {
        if (rows.has(row)) continue
        resize.unobserve(row)
        observedRows.delete(row)
      }
      for (const row of rows) {
        if (observedRows.has(row)) continue
        resize.observe(row)
        observedRows.add(row)
      }
    }
    resize?.observe(host)
    observeRows()
    const changed = (records: MutationRecord[]) => {
      if (records.some(record => record.type === 'childList')) observeRows()
      update(input.current !== 'pointer')
    }
    const mutations = new MutationObserver(changed)
    mutations.observe(host, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        'data-highlighted',
        'data-state',
        'data-disabled',
        'aria-disabled',
        'aria-selected',
        'disabled',
      ],
    })
    host.addEventListener('pointermove', pointer)
    host.addEventListener('pointerover', pointer)
    host.addEventListener('pointerleave', leave)
    host.addEventListener('focusin', focus)
    host.addEventListener('keydown', keyboard, true)
    host.addEventListener('scroll', remeasure, true)
    return () => {
      mutations.disconnect()
      resize?.disconnect()
      observedRows.clear()
      host.removeEventListener('pointermove', pointer)
      host.removeEventListener('pointerover', pointer)
      host.removeEventListener('pointerleave', leave)
      host.removeEventListener('focusin', focus)
      host.removeEventListener('keydown', keyboard, true)
      host.removeEventListener('scroll', remeasure, true)
      delete host.dataset.glideLive
    }
  }, [])

  return <span ref={pill} className="pnds-glide-highlight" aria-hidden="true" />
}
