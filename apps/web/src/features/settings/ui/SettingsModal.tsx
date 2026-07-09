'use client'

import {
  loadBillingSection,
  loadNotificationsSection,
  loadPrivacySection,
  loadProfileSection,
  type BillingSectionData,
  type NotificationsSectionData,
  type PrivacySectionData,
  type ProfileSectionData,
} from '@/features/settings/adapters/settings-loaders'
import {
  SETTINGS_HASH_PREFIX,
  settingsHash,
  settingsSectionMeta,
  toSettingsSectionKey,
  visibleSettingsSections,
  type SettingsSectionKey,
} from '@/features/settings/core/settings-sections'
import {
  BillingPanelSection,
  NotificationsPanel,
  PrivacyPanel,
  ProfilePanel,
} from '@/features/settings/ui/section-panels'
import { SettingsModalProvider } from '@/features/settings/ui/settings-modal-context'
import { useOrg } from '@/shared/org/org-context'
import { toRoute } from '@/shared/routes'
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  Skeleton,
} from '@cbrl/design'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

function parseSectionFromHash(hash: string): SettingsSectionKey | null {
  if (!hash.startsWith(SETTINGS_HASH_PREFIX)) return null
  return toSettingsSectionKey(hash.slice(SETTINGS_HASH_PREFIX.length))
}

export { settingsHash }

type LoadedSection =
  | { section: 'profile'; data: ProfileSectionData }
  | { section: 'privacy'; data: PrivacySectionData }
  | { section: 'billing'; data: BillingSectionData }
  | { section: 'notifications'; data: NotificationsSectionData }

type LoadOutcome = { ok: true; loaded: LoadedSection } | { ok: false; redirectTo: string }

async function loadSection(target: SettingsSectionKey): Promise<LoadOutcome> {
  switch (target) {
    case 'profile': {
      const r = await loadProfileSection()
      return r.ok ? { ok: true, loaded: { section: 'profile', data: r.data } } : r
    }
    case 'privacy': {
      const r = await loadPrivacySection()
      return r.ok ? { ok: true, loaded: { section: 'privacy', data: r.data } } : r
    }
    case 'billing': {
      const r = await loadBillingSection()
      return r.ok ? { ok: true, loaded: { section: 'billing', data: r.data } } : r
    }
    case 'notifications': {
      const r = await loadNotificationsSection()
      return r.ok ? { ok: true, loaded: { section: 'notifications', data: r.data } } : r
    }
  }
}

function SectionPanel({ loaded }: { loaded: LoadedSection }) {
  switch (loaded.section) {
    case 'profile':
      return <ProfilePanel data={loaded.data} />
    case 'privacy':
      return <PrivacyPanel data={loaded.data} />
    case 'notifications':
      return <NotificationsPanel data={loaded.data} />
    case 'billing':
      return <BillingPanelSection data={loaded.data} />
  }
}

export function SettingsModal() {
  const router = useRouter()
  const { membership } = useOrg()
  const sections = visibleSettingsSections(membership.role)

  const [section, setSection] = useState<SettingsSectionKey | null>(null)
  const [loaded, setLoaded] = useState<LoadedSection | null>(null)
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    function sync() {
      setSection(parseSectionFromHash(window.location.hash))
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  const load = useCallback(
    async (target: SettingsSectionKey) => {
      const id = ++requestId.current
      setLoading(true)
      const result = await loadSection(target)
      if (id !== requestId.current) return
      if (!result.ok) {
        window.location.hash = ''
        router.push(toRoute(result.redirectTo))
        return
      }
      setLoaded(result.loaded)
      setLoading(false)
    },
    [router],
  )

  useEffect(() => {
    if (!section) {
      setLoaded(null)
      requestId.current++
      return
    }
    void load(section)
  }, [section, load])

  const reload = useCallback(() => {
    if (section) void load(section)
  }, [section, load])

  function selectSection(next: SettingsSectionKey) {
    window.history.replaceState(null, '', settingsHash(next))
    setSection(next)
  }

  function onOpenChange(open: boolean) {
    if (open) return
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setSection(null)
  }

  if (!section) return null

  const meta = settingsSectionMeta(section)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="grid h-[min(80vh,40rem)] max-w-3xl grid-cols-[12rem_1fr] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <nav
          aria-label="Seções de configuração"
          className="bg-muted/40 flex flex-col gap-0.5 border-r p-2"
        >
          {sections.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => selectSection(item.key)}
              aria-current={item.key === section ? 'page' : undefined}
              className={cn(
                'cursor-pointer rounded-md px-3 py-2 text-left text-sm transition-colors',
                item.key === section
                  ? 'bg-background font-medium'
                  : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex min-h-0 flex-col">
          <DialogHeader className="gap-1 border-b p-6 pr-14">
            <DialogTitle>{meta.label}</DialogTitle>
            <DialogDescription>{meta.description}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="p-6">
              {loading || loaded === null || loaded.section !== section ? (
                <SectionSkeleton />
              ) : (
                <SettingsModalProvider value={{ reload }}>
                  <SectionPanel loaded={loaded} />
                </SettingsModalProvider>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
