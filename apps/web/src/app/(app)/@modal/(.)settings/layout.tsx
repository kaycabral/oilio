'use client'

import { RouteModal } from '@/features/settings/ui/RouteModal'
import { toSettingsSectionKey } from '@/features/settings/ui/settings-sections'
import { useSelectedLayoutSegment } from 'next/navigation'

// The persistent shell for the Configurações modal (brief 0090). Because every
// section matches the sibling `[section]` page, this layout — and the Dialog it
// renders — mounts ONCE and survives section switches: the router swaps only the
// `children` panel (soft navigation, partial render). That is what keeps the
// overlay from re-animating (flicker), the box from resizing, and the dialog
// from stealing focus back into a field (tablet keyboard) on every switch.
//
// The active section is read from this slot's own selected segment so the left
// nav can highlight it without the page having to thread it down.
export default function SettingsModalLayout({ children }: { children: React.ReactNode }) {
  const segment = useSelectedLayoutSegment()
  return <RouteModal activeSection={toSettingsSectionKey(segment)}>{children}</RouteModal>
}
