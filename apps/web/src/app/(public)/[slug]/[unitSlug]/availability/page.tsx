import { groupAvailabilityByLocalTime } from '@/domain'
import { resolveScopeForSessionBySlug } from '@/features/booking/adapters/subscription-scope.repo'
import { getPublicAvailability } from '@/features/self-book/adapters/availability'
import { getPublicOrgSummary } from '@/features/self-book/adapters/public-org'
import { PlanCoverageBanner } from '@/features/self-book/ui/PlanCoverageBanner'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const revalidate = 60

type PageProps = {
  params: Promise<{ slug: string; unitSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readQuery(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const raw = sp[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && v.length > 0 ? v : null
}

function todayInOrgTz(tz: string): string {
  // Render-side ISO date in the org tz. We don't have the org tz until
  // after the loader, so the page falls back to a sentinel and the loader
  // returns the validated date.
  const now = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(now)
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, unitSlug } = await params
  return { title: `Disponibilidade — ${unitSlug} — ${slug}` }
}

export default async function PublicAvailabilityPage({ params, searchParams }: PageProps) {
  const { slug, unitSlug } = await params
  const sp = await searchParams
  const serviceId = readQuery(sp, 'service')
  const professionalId = readQuery(sp, 'professional')
  // Single-day endpoint for V0.1 (issue #842 "Out of scope: month view").
  // Range view (`from` + `to`) ships when the booking wizard (#844) drives it.
  const dateQuery = readQuery(sp, 'from') ?? readQuery(sp, 'date')

  if (!serviceId) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-12">
        <h1 className="text-xl font-semibold">Disponibilidade</h1>
        <p className="text-muted-foreground text-sm">
          Selecione um serviço no catálogo para ver os horários disponíveis.
        </p>
        <Link className="text-primary text-sm underline" href={`/${slug}/${unitSlug}`}>
          Voltar para o catálogo
        </Link>
      </main>
    )
  }

  // Fast date fallback: today in the org tz once we have the bundle.
  // We need the org tz before computing — temporary pass through a
  // probe call with a sentinel and trust the loader's validation.
  const probeDate = dateQuery ?? todayInOrgTz('America/Sao_Paulo')

  // Resolve the visitor's subscription scope (brief 0019, Group B — AC-07).
  // The loader filters slots by `allowedTimeScope` and the unit-slug page
  // already enforces the spatial axis. We keep the full scope around so
  // the AC-16 coverage banner can render alongside.
  const scope = await resolveScopeForSessionBySlug(slug)

  const bundle = await getPublicAvailability(slug, unitSlug, {
    serviceId,
    date: probeDate,
    professionalId,
    timeScope: scope?.allowedTimeScope ?? null,
  })
  if (!bundle) notFound()

  const date = bundle.date
  const rows = groupAvailabilityByLocalTime(bundle.slots, bundle.unit.timezone)
  const proNameById = new Map(bundle.professionals.map((p) => [p.id, p.name]))

  const dateFmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: bundle.unit.timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  })
  const dateLabel = dateFmt.format(new Date(`${date}T12:00:00.000Z`))

  // Brief 0019 Group D — AC-16. Resolve unit names for the banner only
  // when the customer's allowlist actually constrains rendering — an
  // empty Set means "no axis to display", so we skip the extra read.
  // Cheap fallback to `[bundle.unit]`.
  const summaryUnits =
    scope?.unitAllowlist && scope.unitAllowlist.size > 0
      ? ((await getPublicOrgSummary(slug))?.units ?? [bundle.unit])
      : [bundle.unit]

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Disponibilidade</h1>
        <p className="text-muted-foreground text-sm">
          {bundle.service.name} — {bundle.unit.name} — {dateLabel}
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

      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          Sem horários disponíveis para este dia.
        </p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-md border">
          {rows.map((r) => (
            <li key={r.localHHmm} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="text-sm font-medium tabular-nums">{r.localHHmm}</div>
              <ul className="flex flex-wrap items-center justify-end gap-2">
                {r.slots.map((s) => (
                  <li key={`${s.professionalId}-${s.startAt}`}>
                    <Link
                      href={`/${slug}/${unitSlug}/book?service=${encodeURIComponent(bundle.service.id)}&professional=${encodeURIComponent(s.professionalId)}&start=${encodeURIComponent(s.startAt)}`}
                      className="border-border hover:bg-muted/40 rounded-md border px-2 py-1 text-xs"
                    >
                      {proNameById.get(s.professionalId) ?? 'Profissional'}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
