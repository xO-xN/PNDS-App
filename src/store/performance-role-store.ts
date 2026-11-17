import { create } from 'zustand'
import { updatePreferences } from '@/lib/preferences'
import type { PerformanceRole } from '@/lib/tauri-bindings'

export type { PerformanceRole } from '@/lib/tauri-bindings'

const roleMenuIdle = {
  roleMenuOpen: false,
  roleSwitchPending: false,
  restoreRoleFocus: false,
}

/** Saved role is presentation preference; native activity owns the current role. */
export const usePerformanceRoleStore = create<{
  role: PerformanceRole | null
  lastRole: PerformanceRole
  preferencesRestored: boolean
  roleMenuOpen: boolean
  roleSwitchPending: boolean
  restoreRoleFocus: boolean
  restoreRolePreference: (saved: unknown, activate?: boolean) => void
  commitRole: (role: PerformanceRole) => Promise<boolean>
  selectRole: (role: PerformanceRole) => void
  resetRole: () => void
  enterPerformance: () => void
}>(set => ({
  role: null,
  lastRole: 'host',
  preferencesRestored: false,
  ...roleMenuIdle,
  restoreRolePreference: (saved, activate = true) =>
    set(state => {
      if (state.preferencesRestored) return state
      const lastRole = saved === 'client' ? 'client' : 'host'
      return {
        lastRole,
        preferencesRestored: true,
        // A late preferences read cannot replace an explicit choice or native facts.
        ...(activate && state.role === null ? { role: lastRole } : {}),
      }
    }),
  commitRole: async role => {
    set({
      role,
      lastRole: role,
      preferencesRestored: true,
      ...roleMenuIdle,
      restoreRoleFocus: true,
    })
    return updatePreferences({ lastPerformanceRole: role })
  },
  // Repeated native Client facts must not dismiss an open role menu or save a preference.
  selectRole: role =>
    set(state => (state.role === role ? state : { role, ...roleMenuIdle })),
  resetRole: () => set({ role: null, ...roleMenuIdle }),
  enterPerformance: () =>
    set(state => ({
      role: state.preferencesRestored ? state.lastRole : null,
      ...roleMenuIdle,
    })),
}))
