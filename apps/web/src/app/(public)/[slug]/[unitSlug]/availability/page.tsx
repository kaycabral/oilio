import {
  getBusinessHoursForDay,
  getTodayInOrgTz,
  groupAvailabilityByLocalTime,
  shiftDateInOrgTz,
  unitBusinessHours,
} from '@/domain'
import { resolveScopeForSessionBySlug } from '@/features/booking/adapters/subscription-scope.repo'
import { getPublicAvailability } from '@/features/self-book/adapters/availability'
import { getPublicOrgSummary } from '@/features/self-book/adapters/public-org'
import { AvailabilityWizard } from '@/features/self-book/ui/AvailabilityWizard'
import { PlanCoverageBanner } from '@/features/self-book/ui/PlanCoverageBanner'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

// Dynamic: availability depends on the visitor's session (subscription scope) and
// the current day, so it can't be statically cached.
export const dynamic = 'force-dynamic'

type PageProps = {
  params: Promise<{ slug: string; unitSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readQuery(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const raw = sp[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && v.length > 0 ? v : null
}

// First bookable calendar day on/after `today`: scan up to 2 weeks for a weekday
// the unit declares open (cheap — business-hours only, no slot compute). The
// wizard then computes the real grid for whatever day the customer lands on /
// picks. Falls back to today if the unit declares no open weekday (the grid will
// just render empty, with the "pick another day" hint).
function firstOpenDay(
  businessHours: ReturnType<typeof unitBusinessHours>,
  today: string,
  tz: string,
): string {
  for (let i = 0; i < 14; i++) {
    const day = shiftDateInOrgTz(today, i, tz)
    if (getBusinessHoursForDay(businessHours, day, tz).length > 0) return day
  }
  return today
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, unitSlug } = await params
  return { title: `Agendar — ${unitSlug} — ${slug}` }
}

export default async function PublicAvailabilityPage({ params, searchParams }: PageProps) {
  const { slug, unitSlug } = await params
  const sp = await searchParams
  const serviceId = readQuery(sp, 'service')
  // Deep-link to a specific day: `?from=` (range view, when the wizard drives it)
  // or `?date=`. Honored when valid + not in the past; otherwise we fall back to
  // the first open day below.
  const dateQuery = readQuery(sp, 'from') ?? readQuery(sp, 'date')

  if (!serviceId) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-12">
        <h1 className="text-xl font-semibold">Agendar</h1>
        <p className="text-muted-foreground text-sm">
          Selecione um serviço no catálogo para ver os horários disponíveis.
        </p>
        <Link className="text-primary text-sm underline" href={`/${slug}/${unitSlug}`}>
          Voltar para o catálogo
        </Link>
      </main>
    )
  }

  // Probe once to resolve the unit (tz + business hours) and validate the
  // service/unit. Use today only to fetch the bundle; the real starting day is
  // the first OPEN day (so the customer never lands trapped on a closed today).
  const probe = await getPublicAvailability(slug, unitSlug, {
    serviceId,
    date: getTodayInOrgTz('America/Sao_Paulo'),
  })
  if (!probe) notFound()

  const tz = probe.unit.timezone
  const today = getTodayInOrgTz(tz)
  // A valid, non-past `?from=`/`?date=` wins (deep-link / E2E determinism);
  // otherwise start on the first open day so a closed today never traps anyone.
  const isValidDate = dateQuery !== null && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)
  const startDate =
    isValidDate && dateQuery >= today
      ? dateQuery
      : firstOpenDay(unitBusinessHours(probe.unit.agenda), today, tz)

  // Subscription scope (brief 0019): the time-scope filters the slot grid (AC-07)
  // and the allowlist drives the coverage banner (AC-16). Resolved here so the
  // INITIAL grid is already filtered — the action applies the same scope on
  // subsequent date/pro changes.
  const scope = await resolveScopeForSessionBySlug(slug)
  const summaryUnits =
    scope?.unitAllowlist && scope.unitAllowlist.size > 0
      ? ((await getPublicOrgSummary(slug))?.units ?? [probe.unit])
      : [probe.unit]

  // Load the grid for the starting day WITH the time-scope (the probe was
  // scope-less, only used to resolve tz/agenda — never reuse it as the grid).
  const initialBundle =
    (await getPublicAvailability(slug, unitSlug, {
      serviceId,
      date: startDate,
      timeScope: scope?.allowedTimeScope ?? null,
    })) ?? probe

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Escolha data e horário</h1>
        <p className="text-muted-foreground text-sm">
          {probe.service.name} — {probe.unit.name}
        </p>
        <Link
          className="text-primary text-sm underline-offset-2 hover:underline"
          href={`/${slug}/${unitSlug}`}
        >
          ← Catálogo
        </Link>
      </header>

      {scope ? (
        <PlanCoverageBanner
          unitAllowlist={scope.unitAllowlist}
          allowedTimeScope={scope.allowedTimeScope}
          bookingLimits={scope.bookingLimits}
          units={summaryUnits}
        />
      ) : null}

      <AvailabilityWizard
        slug={slug}
        unitSlug={unitSlug}
        serviceId={serviceId}
        serviceName={probe.service.name}
        unitName={probe.unit.name}
        timezone={tz}
        minDate={today}
        initial={{
          date: initialBundle.date,
          rows: groupAvailabilityByLocalTime(initialBundle.slots, tz),
          memberOperations: initialBundle.memberOperations,
        }}
      />
    </main>
  )
}
