'use client'

import { createContext, useContext } from 'react'

// Lets a form INSIDE the Configurações modal refresh its section's data after a
// mutation without a route navigation (brief 0090, bug #13 fix). On the full
// `/settings/X` page there is no provider, so `useSettingsReload()` returns null
// and the form falls back to `router.refresh()` — the correct behaviour there.
// Inside the modal the provider supplies `reload`, which re-invokes the section
// loader and swaps the panel data in place, leaving the URL hash (and the open
// dialog) untouched.
type SettingsModalContextValue = {
  reload: () => void
}

const SettingsModalContext = createContext<SettingsModalContextValue | null>(null)

export const SettingsModalProvider = SettingsModalContext.Provider

// Returns the in-modal reload callback, or null when rendered outside the modal
// (i.e. on the full settings page). Callers use `?? router.refresh()`.
export function useSettingsReload(): (() => void) | null {
  return useContext(SettingsModalContext)?.reload ?? null
}
