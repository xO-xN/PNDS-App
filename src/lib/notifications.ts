/**
 * Simple notification system supporting both in-app toasts and native system notifications
 */

import { toast } from 'sonner'
import { logger } from './logger'
import { commands } from './tauri-bindings'

type NotificationType = 'success' | 'error' | 'info' | 'warning'

interface NotificationOptions {
  /** Type of notification (affects styling) */
  type?: NotificationType
  /** Send as native system notification instead of toast */
  native?: boolean
  /** Duration in milliseconds for toasts (0 = no auto-dismiss) */
  duration?: number
}

/**
 * Send a notification - either as an in-app toast or native system notification
 *
 * @param title - Main notification title
 * @param message - Optional message body
 * @param options - Notification configuration
 *
 * @example
 * ```typescript
 * // Simple toast
 * notify('Success!', 'File saved successfully')
 *
 * // Error toast
 * notify('Error', 'Failed to save file', { type: 'error' })
 *
 * // Native system notification
 * notify('Update Available', 'A new version is ready to install', { native: true })
 * ```
 */
export async function notify(
  title: string,
  message?: string,
  options: NotificationOptions = {}
): Promise<void> {
  const { type = 'info', native = false, duration } = options

  try {
    if (native) {
      // Send native system notification via Tauri
      logger.debug('Sending native notification', { title, message, type })
      const result = await commands.sendNativeNotification(
        title,
        message ?? null
      )
      if (result.status === 'error') {
        throw new Error(result.error)
      }
    } else {
      // Send in-app toast notification
      logger.debug('Sending toast notification', { title, message, type })

      const toastContent = message ? `${title}: ${message}` : title
      const toastOptions = duration !== undefined ? { duration } : {}

      switch (type) {
        case 'success':
          toast.success(toastContent, toastOptions)
          break
        case 'error':
          toast.error(toastContent, toastOptions)
          break
        case 'warning':
          toast.warning(toastContent, toastOptions)
          break
        case 'info':
        default:
          toast.info(toastContent, toastOptions)
          break
      }
    }
  } catch (error) {
    logger.error('Failed to send notification', { title, message, error })
    // Fallback to toast if native notification fails
    if (native) {
      toast.error(`${title}${message ? `: ${message}` : ''}`)
    }
  }
}

/**
 * Convenience functions for common notification types
 */
export const notifications = {
  /** Show success notification */
  success: (title: string, message?: string, native?: boolean) =>
    notify(title, message, { type: 'success', native }),

  /** Show error notification */
  error: (title: string, message?: string, native?: boolean) =>
    notify(title, message, { type: 'error', native }),

  /** Show info notification */
  info: (title: string, message?: string, native?: boolean) =>
    notify(title, message, { type: 'info', native }),

  /** Show warning notification */
  warning: (title: string, message?: string, native?: boolean) =>
    notify(title, message, { type: 'warning', native }),

  /**
   * v1.4.0 (user report after #59): a long-running flow's progress toast.
   * The same `id` passed to a later `succeed`/`fail` morphs the loading
   * toast in place instead of stacking another — progress and outcome read
   * as ONE indicator. Pure UI: no native variant (the owning flow logs
   * its own milestones).
   */
  flow: {
    /** Starts the loading toast, or refreshes its description. */
    step: (id: string, title: string, description?: string): void => {
      toast.loading(
        title,
        description !== undefined ? { id, description } : { id }
      )
    },
    /** Resolves the loading toast as success (same toast, same place). */
    succeed: (id: string, title: string, description?: string): void => {
      toast.success(
        title,
        description !== undefined ? { id, description } : { id }
      )
    },
    /** Resolves the loading toast as failure (same toast, same place). */
    fail: (id: string, title: string, description?: string): void => {
      toast.error(
        title,
        description !== undefined ? { id, description } : { id }
      )
    },
  },
}

// Export individual convenience functions
export const { success, error, info, warning } = notifications
