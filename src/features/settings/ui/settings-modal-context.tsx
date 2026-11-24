'use client'

import { createContext, useContext } from 'react'

type SettingsModalContextValue = {
  reload: () => void
}

const SettingsModalContext = createContext<SettingsModalContextValue | null>(null)

export const SettingsModalProvider = SettingsModalContext.Provider

export function useSettingsReload(): (() => void) | null {
  return useContext(SettingsModalContext)?.reload ?? null
}
