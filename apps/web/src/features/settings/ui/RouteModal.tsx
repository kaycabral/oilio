'use client'

import {
  type SettingsSectionKey,
  visibleSettingsSections,
} from '@/features/settings/ui/settings-sections'
import { useOrg } from '@/shared/org/org-context'
import { toRoute } from '@/shared/routes'
import { cn, Dialog, DialogContent, DialogTitle, ScrollArea } from '@cbrl/design'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// The Configurações modal shell (brief 0090, AC-05): a 2-column dialog with a
// flat section nav on the left and the intercepted settings page on the right.
// It is mounted once by the slot's `layout.tsx` and PERSISTS across section
// switches — the router swaps only `children` (the right panel). Mounting once
// is what keeps switching sections smooth: no overlay re-animation (flicker), no
// box resize, no focus-steal back into a field (tablet keyboard).
//
// The dialog box has a FIXED size (fixed height + width); only the panel
// scrolls. So every section shows in the same frame — the box never grows or
// shrinks as content changes.
//
// The nav is trimmed to the sections the member may see: Cobrança and
// Notificações disappear for a non-manager (mirrors the sidebar hide posture,
// brief 0088). The route pages keep their own server guard regardless.
//
// Telemetry (`settings_section_viewed`) is emitted server-side in each section's
// page — `track()` reaches the server logger (node:async_hooks) and can't run in
// this client component (brief 0090 § "Eventos").
export function RouteModal({
  activeSection,
  children,
}: {
  activeSection: SettingsSectionKey | null
  children: React.ReactNode
}) {
  const router = useRouter()
  const { membership } = useOrg()
  const sections = visibleSettingsSections(membership.role)

  // Radix closes on Esc / overlay click / X — route the close through the
  // router so the URL returns to the background surface (the intercepting route
  // is popped), instead of leaving a dangling /settings/* URL behind the modal.
  function onOpenChange(open: boolean) {
    if (!open) router.back()
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        className="grid h-[min(80vh,40rem)] max-w-3xl grid-cols-[12rem_1fr] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        aria-describedby={undefined}
        // Keep focus on the dialog frame instead of auto-focusing the first
        // field: a form input grabbing focus pops the tablet's on-screen
        // keyboard every time the modal (re)renders. The user still tabs into
        // fields deliberately.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {/* Accessible dialog name for screen readers; the visible section title
            lives inside the intercepted page's own header. */}
        <DialogTitle className="sr-only">Configurações</DialogTitle>

        <nav
          aria-label="Seções de configuração"
          className="bg-muted/40 flex flex-col gap-0.5 border-r p-2"
        >
          {sections.map((section) => (
            <Link
              key={section.key}
              href={toRoute(section.href)}
              // Replace (not push) so switching sections doesn't stack history:
              // the modal stays a single entry, so Esc/back always returns to the
              // background surface in one step regardless of how many sections
              // were visited (brief 0090 — Esc/X restore the background route).
              replace
              aria-current={section.key === activeSection ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-2 text-sm transition-colors',
                section.key === activeSection
                  ? 'bg-background font-medium'
                  : 'text-muted-foreground hover:bg-background/60',
              )}
            >
              {section.label}
            </Link>
          ))}
        </nav>

        <ScrollArea className="h-full">
          <div className="p-6">{children}</div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
