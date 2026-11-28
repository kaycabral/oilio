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
import { connection } from 'next/server'

export const instant = false

type PageProps = {
  params: Promise<{ slug: string; unitSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readQuery(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const raw = sp[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && v.length > 0 ? v : null
}

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
  await connection()
  const { slug, unitSlug } = await params
  const sp = await searchParams
  const serviceId = readQuery(sp, 'service')
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

  const probe = await getPublicAvailability(slug, unitSlug, {
    serviceId,
    date: getTodayInOrgTz('America/Sao_Paulo'),
  })
  if (!probe) notFound()

  const tz = probe.unit.timezone
  const today = getTodayInOrgTz(tz)
  const isValidDate = dateQuery !== null && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)
  const startDate =
    isValidDate && dateQuery >= today
      ? dateQuery
      : firstOpenDay(unitBusinessHours(probe.unit.agenda), today, tz)

  const scope = await resolveScopeForSessionBySlug(slug)
  const summaryUnits =
    scope?.unitAllowlist && scope.unitAllowlist.size > 0
      ? ((await getPublicOrgSummary(slug))?.units ?? [probe.unit])
      : [probe.unit]

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
