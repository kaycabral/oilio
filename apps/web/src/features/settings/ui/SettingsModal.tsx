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

// The Configurações modal (brief 0090, bug #13 fix). Unlike the old
// parallel-route slot, this is a plain client dialog anchored to the URL hash
// `#settings/<section>`. The hash is not a route, so a hard navigation — reload,
// a tablet resuming a suspended tab, or a form's `router.refresh()` — does NOT
// tear the modal down into a full page (the by-design failure of the `@modal`
// slot). On mount and on every `hashchange` we re-derive the open state from the
// hash, so the modal is fully restorable from the URL alone.
//
// Section data loads through server actions (guard + fetch + telemetry live
// server-side, same as the `/settings/X` pages). Switching sections only rewrites
// the hash — the Dialog never remounts, so no overlay re-animation, no size jump,
// no tablet-keyboard refocus. The box has a fixed size; only the panel scrolls.

// Parses `#settings/<section>` from a raw location hash. Returns the section key,
// or null when the hash is anything else (modal closed / unknown section).
function parseSectionFromHash(hash: string): SettingsSectionKey | null {
  if (!hash.startsWith(SETTINGS_HASH_PREFIX)) return null
  return toSettingsSectionKey(hash.slice(SETTINGS_HASH_PREFIX.length))
}

// Re-export so existing importers (user-menu, app-shell) keep their
// `@/features/settings/ui/SettingsModal` import path; the canonical definition now
// lives in settings/core/settings-sections (React-free, so adapters can import it
// without crossing the layering wall — the Stripe return URL needs it, #1376).
export { settingsHash }

// The loaded data tagged with its section, so the panel dispatch narrows without
// a cast — each `section` correlates with exactly one `data` shape.
type LoadedSection =
  | { section: 'profile'; data: ProfileSectionData }
  | { section: 'privacy'; data: PrivacySectionData }
  | { section: 'billing'; data: BillingSectionData }
  | { section: 'notifications'; data: NotificationsSectionData }

// The outcome of loading a section: either the tagged data, or a route to bounce
// to when the server guard rejected (not signed in / not a manager).
type LoadOutcome = { ok: true; loaded: LoadedSection } | { ok: false; redirectTo: string }

// Loads one section by calling its matching loader. The switch keeps the
// `section`↔`data` correlation, so the returned `loaded` is a precise union
// member — no assertion needed.
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

// Renders the loaded data with the panel that matches its section — the tagged
// union narrows each branch's `data` to the right shape.
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
  // Guards against a stale load resolving after the user already switched
  // sections (or closed) — only the newest request may commit its data.
  const requestId = useRef(0)

  // Derive the open section from the URL hash on mount and on every hashchange.
  // This is the single source of truth: opening the modal = setting the hash.
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
        // The section's server guard rejected (not signed in, not a manager for
        // Cobrança…). Close the modal and hand off to the full route, which
        // performs the real redirect.
        window.location.hash = ''
        router.push(toRoute(result.redirectTo))
        return
      }
      setLoaded(result.loaded)
      setLoading(false)
    },
    [router],
  )

  // Load whenever the active section changes. Clearing the section (closed modal)
  // drops the stale data so a reopen never flashes the previous section.
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
    // Rewrite the hash without stacking history (replaceState + manual sync):
    // the modal stays a single history entry, so closing always returns to the
    // background surface in one step.
    window.history.replaceState(null, '', settingsHash(next))
    setSection(next)
  }

  function onOpenChange(open: boolean) {
    if (open) return
    // Close = drop the hash. Use replaceState so the closed state doesn't add a
    // history entry the user would have to Back through.
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setSection(null)
  }

  if (!section) return null

  const meta = settingsSectionMeta(section)

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="grid h-[min(80vh,40rem)] max-w-3xl grid-cols-[12rem_1fr] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        // Keep focus on the dialog frame rather than the first field, so the
        // tablet on-screen keyboard doesn't pop on every (re)render.
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

        {/* Panel column: a fixed shadcn DialogHeader (the active section's title +
            description) over the scrollable body. The Dialog's own close button
            sits at the content's top-right, aligned with this header. */}
        <div className="flex min-h-0 flex-col">
          <DialogHeader className="gap-1 border-b p-6 pr-14">
            <DialogTitle>{meta.label}</DialogTitle>
            <DialogDescription>{meta.description}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="p-6">
              {/* Show the skeleton while loading, and also whenever the loaded
                  data is for a different section than the active one (a switch in
                  flight) — never render a panel whose header doesn't match. */}
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

// Body placeholder while a section loads — the header (title + description) is
// already shown from the section meta, so the skeleton only stands in for the
// content blocks.
function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}
