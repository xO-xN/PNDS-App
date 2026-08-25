import { describe, it, expect, vi } from 'vitest'
import {
  buildLocaleMessage,
  pushLocaleToFrame,
  LOCALE_MESSAGE_TYPE,
  LOCALE_MESSAGE_VERSION,
} from './locale-bridge'

/**
 * v1.3.0 (#54): the locale bridge's contract — the message shape
 * projects listen for and the delivery guarantees, mirroring the theme
 * bridge tests (#44). The payload is the RESOLVED language code
 * ("en" / "zh-CN"), never the General setting ('system' has no code).
 */

describe('locale-bridge (#54)', () => {
  it('builds the contract message shape projects listen for', () => {
    const message = buildLocaleMessage('zh-CN')
    expect(message).toEqual({
      type: LOCALE_MESSAGE_TYPE,
      version: LOCALE_MESSAGE_VERSION,
      locale: 'zh-CN',
    })
    expect(message.type).toBe('pnds:locale')
    expect(message.version).toBe(1)
  })

  it('posts the message to the frame with the exact monitor origin', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const postMessage = vi.fn()
    Object.defineProperty(frame, 'contentWindow', {
      value: { postMessage },
      configurable: true,
    })

    const delivered = pushLocaleToFrame(
      frame,
      'http://192.168.1.10:6869',
      'zh-CN'
    )

    expect(delivered).toBe(true)
    expect(postMessage).toHaveBeenCalledTimes(1)
    const firstCall = postMessage.mock.calls[0]
    const message = firstCall?.[0]
    const origin = firstCall?.[1]
    expect(origin).toBe('http://192.168.1.10:6869') // never '*'
    expect(message.type).toBe('pnds:locale')
    expect(message.version).toBe(1)
    expect(message.locale).toBe('zh-CN')
  })

  it('delivers the latest value on every push (latest value wins)', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const postMessage = vi.fn()
    Object.defineProperty(frame, 'contentWindow', {
      value: { postMessage },
      configurable: true,
    })

    pushLocaleToFrame(frame, 'http://x:1', 'en')
    pushLocaleToFrame(frame, 'http://x:1', 'zh-CN')

    expect(postMessage.mock.calls.at(-1)?.[0].locale).toBe('zh-CN')
  })

  it('fails soft without a frame — the show is never affected', () => {
    expect(pushLocaleToFrame(null, 'http://x:1', 'en')).toBe(false)
  })

  it('fails soft when postMessage throws — never affects the show', () => {
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    Object.defineProperty(frame, 'contentWindow', {
      value: {
        postMessage: () => {
          throw new Error('cross-origin refusal')
        },
      },
      configurable: true,
    })

    expect(pushLocaleToFrame(frame, 'http://x:1', 'en')).toBe(false)
  })
})
