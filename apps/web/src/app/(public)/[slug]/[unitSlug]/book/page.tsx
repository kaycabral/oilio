import {
  DEFAULT_CANCELLATION_POLICY,
  appointmentAgenda,
  isCatalogService,
  isOperational,
  toPublicCatalogItem,
} from '@/domain'
import { resolveScopeForSession } from '@/features/booking/adapters/subscription-scope.repo'
import { getPublicUnitBundle } from '@/features/self-book/adapters/public-org'
import { ConfirmBookingForm } from '@/features/self-book/ui/ConfirmBookingForm'
import { PlanCoverageBanner } from '@/features/self-book/ui/PlanCoverageBanner'
import { getCatalogItemById } from '@/shared/db/effect/catalog-item-read'
import { getSessionUser } from '@/shared/firebase/admin'
import { getMemberOperationById } from '@/shared/org/member-operation-read'
import { getUserDoc } from '@/shared/org/membership'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

type PageProps = {
  params: Promise<{ slug: string; unitSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function readQuery(sp: Record<string, string | string[] | undefined>, key: string): string | null {
  const raw = sp[key]
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && v.length > 0 ? v : null
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, unitSlug } = await params
  const bundle = await getPublicUnitBundle(slug, unitSlug)
  if (!bundle) return { title: 'Página não encontrada' }
  return { title: `Agendar — ${bundle.unit.name} — ${bundle.org.name}` }
}

// Load + validate the wizard's bundle, chosen service and memberOperation. Every
// invalid combination is a `notFound()` (the URL was tampered or the data
// changed). Returns the validated trio for rendering.
async function loadWizardPageEntities(
  slug: string,
  unitSlug: string,
  serviceQ: string,
  memberOperationQ: string,
) {
  const bundle = await getPublicUnitBundle(slug, unitSlug)
  if (!bundle) notFound()

  const [rawService, memberOperation] = await Promise.all([
    getCatalogItemById(bundle.org.id, serviceQ),
    getMemberOperationById(bundle.org.id, memberOperationQ),
  ])
  // Unified catalog (brief 0023, #1004 → 0053/B3): re-sanitize through
  // `toPublicCatalogItem` so the rendered labels match the wire projection
  // (no commission leak).
  if (!rawService || !memberOperation) notFound()
  if (!isCatalogService(rawService)) notFound()
  if (!rawService.active || !rawService.publicVisible) notFound()
  if (!rawService.unitIds.includes(bundle.unit.id)) notFound()
  const publicService = toPublicCatalogItem(rawService, bundle.unit.id)

  if (!memberOperation.unitIds.includes(bundle.unit.id)) notFound()
  if (
    !Array.isArray(memberOperation.catalogServiceIds) ||
    !memberOperation.catalogServiceIds.includes(rawService.id)
  ) {
    notFound()
  }
  if (!isOperational(memberOperation.operationalStatus)) notFound()

  return { bundle, publicService, memberOperation, rawService }
}

export default async function WizardBookPage({ params, searchParams }: PageProps) {
  const { slug, unitSlug } = await params
  const sp = await searchParams
  const serviceQ = readQuery(sp, 'service')
  const startQ = readQuery(sp, 'start')
  const memberOperationQ = readQuery(sp, 'memberOperation')

  // Step 1 fallback: no service in URL → bounce to the unit catalog (the
  // canonical "pick a service" surface — #841). Keeps a single source of
  // truth for the service list and avoids a half-empty wizard.
  if (!serviceQ) {
    redirect(`/${slug}/${unitSlug}`)
  }

  // Step 2 fallback: no slot → bounce to availability for that service.
  if (!startQ) {
    redirect(`/${slug}/${unitSlug}/availability?service=${encodeURIComponent(serviceQ)}`)
  }

  if (!memberOperationQ) {
    // The availability calendar always assigns a pro; if the URL is missing
    // one, the user manipulated the link — kick them back to slot picking.
    redirect(`/${slug}/${unitSlug}/availability?service=${encodeURIComponent(serviceQ)}`)
  }

  const { bundle, publicService, memberOperation, rawService } = await loadWizardPageEntities(
    slug,
    unitSlug,
    serviceQ,
    memberOperationQ,
  )

  // Render the human-readable start label in org timezone — pre-formatted
  // server-side so the client doesn't need to know the tz for display.
  const startAt = new Date(startQ)
  if (Number.isNaN(startAt.getTime())) {
    redirect(`/${slug}/${unitSlug}/availability?service=${encodeURIComponent(serviceQ)}`)
  }
  if (startAt.getTime() <= Date.now()) {
    redirect(`/${slug}/${unitSlug}/availability?service=${encodeURIComponent(serviceQ)}`)
  }

  // Session detection (#1275). Login is required to confirm; the confirm step
  // carries no PII (the Customer is derived from the uid). We resolve only the
  // display name of a signed-in + completed viewer so the screen reads
  // "Agendando como <nome>". A visitor who isn't logged in (or hasn't completed)
  // still sees the confirm screen — the action routes them to login/cadastro.
  const session = await getSessionUser()
  const sessionUser = session ? await getUserDoc(session.uid) : null
  const viewerName =
    sessionUser && sessionUser.completionCompleted
      ? (sessionUser.displayName ?? sessionUser.email ?? 'cliente')
      : null

  // Brief 0019 Group D — AC-16. Same scope resolution path as the unit
  // catalog/availability pages — keeps the banner consistent across all
  // 3 wizard steps for subscribed customers.
  const scope = await resolveScopeForSession(bundle.org.id)

  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: bundle.unit.timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
  const startAtLabel = fmt.format(startAt)
  const priceLabel =
    publicService.priceCents === null
      ? 'Sob consulta'
      : (publicService.priceCents / 100).toLocaleString('pt-BR', {
          style: 'currency',
          currency: 'BRL',
        })
  const durationLabel =
    publicService.durationMinutes !== null
      ? `${formatDuration(publicService.durationMinutes)} · `
      : ''
  const serviceLabel = `${publicService.name} · ${durationLabel}${priceLabel}`
  const changeSlotHref = `/${slug}/${unitSlug}/availability?service=${encodeURIComponent(rawService.id)}`

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Confirmar agendamento</h1>
        <p className="text-muted-foreground text-sm">
          {bundle.unit.name} — {bundle.org.name}
        </p>
        <ol className="text-muted-foreground flex items-center gap-2 pt-1 text-xs">
          <li>
            <Link className="underline-offset-2 hover:underline" href={`/${slug}/${unitSlug}`}>
              1. Serviço
            </Link>
          </li>
          <li>›</li>
          <li>
            <Link
              className="underline-offset-2 hover:underline"
              href={`/${slug}/${unitSlug}/availability?service=${encodeURIComponent(rawService.id)}`}
            >
              2. Horário
            </Link>
          </li>
          <li>›</li>
          <li className="text-foreground font-medium">3. Confirmar</li>
        </ol>
      </header>

      {scope ? (
        <PlanCoverageBanner
          unitAllowlist={scope.unitAllowlist}
          allowedTimeScope={scope.allowedTimeScope}
          bookingLimits={scope.bookingLimits}
          units={bundle.units}
        />
      ) : null}

      <ConfirmBookingForm
        slug={slug}
        unitSlug={unitSlug}
        serviceId={rawService.id}
        memberOperationId={memberOperation.id}
        startAtIso={startAt.toISOString()}
        serviceLabel={serviceLabel}
        memberOperationLabel={memberOperation.name}
        startAtLabel={startAtLabel}
        cancellationPolicy={
          appointmentAgenda(bundle.unit.agenda)?.cancellationPolicy ?? DEFAULT_CANCELLATION_POLICY
        }
        changeSlotHref={changeSlotHref}
        viewerName={viewerName}
        unitWhatsapp={bundle.unit.whatsapp}
        unitName={bundle.unit.name}
      />
    </main>
  )
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}
