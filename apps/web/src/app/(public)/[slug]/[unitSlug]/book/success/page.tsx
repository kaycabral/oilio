import { Appointment, CatalogItem } from '@/domain'
import { getPublicTenantSummary } from '@/features/self-book/adapters/public-tenant'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { getProfessionalById } from '@/shared/tenant/professional-read'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

type PageProps = {
  params: Promise<{ slug: string; unitSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  return { title: `Agendamento confirmado — ${slug}` }
}

export default async function WizardSuccessPage({ params, searchParams }: PageProps) {
  const { slug, unitSlug } = await params
  const sp = await searchParams
  const apptId = typeof sp.appt === 'string' ? sp.appt : null
  if (!apptId) notFound()

  const summary = await getPublicTenantSummary(slug)
  if (!summary) notFound()
  const unit = summary.units.find((u) => u.slug === unitSlug)
  if (!unit) notFound()

  // Read the appointment + service + professional + unit snapshot. We don't
  // expose other customers' PII; we render only the booker's own appointment.
  // The page is reachable by anyone with the booking id, which is acceptable
  // since the id is server-generated and not enumerable — same trust model
  // as a magic link.
  const tenantRef = getAdminFirestore().collection('tenants').doc(summary.tenant.id)
  const apptSnap = await tenantRef
    .collection('appointments')
    .withConverter(fsConverter(Appointment))
    .doc(apptId)
    .get()
  const appointment = apptSnap.data()
  if (!appointment) notFound()
  if (appointment.unitId !== unit.id) notFound()

  const [serviceSnap, professional] = await Promise.all([
    tenantRef
      .collection('catalog_items')
      .withConverter(fsConverter(CatalogItem))
      .doc(appointment.serviceId)
      .get(),
    // PII (name) merged from `professionals_pii` on read (#1036).
    getProfessionalById(summary.tenant.id, appointment.professionalId),
  ])
  // Unified catalog (brief 0023, #1004): only the name is rendered.
  const service = serviceSnap.data() ?? null
  // `unit` comes from the enriched `summary.units` (whatsapp/email merged from
  // `units_pii` on read, #1036) — no raw re-read needed.
  const unitDoc = unit

  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: summary.tenant.timezone,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  })
  const startLabel = fmt.format(new Date(appointment.startAt))
  const priceLabel = (appointment.servicePriceCentsSnapshot / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })

  return (
    <main className="mx-auto max-w-md space-y-5 px-4 py-10">
      <div className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-700 dark:bg-emerald-950/40">
        <h1 className="text-base font-semibold">Agendamento confirmado!</h1>
        <p className="text-muted-foreground text-sm">
          O estabelecimento receberá sua reserva. Você pode fechar esta página.
        </p>
        <p className="text-muted-foreground text-xs">
          Código: <code>{apptId.slice(0, 8)}</code>
        </p>
      </div>

      <dl className="grid grid-cols-[max-content,1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Serviço</dt>
        <dd>
          {service?.name ?? 'Serviço'} · {appointment.serviceDurationMinutesSnapshot} min ·{' '}
          {priceLabel}
        </dd>
        <dt className="text-muted-foreground">Profissional</dt>
        <dd>{professional?.name ?? '—'}</dd>
        <dt className="text-muted-foreground">Quando</dt>
        <dd>{startLabel}</dd>
        <dt className="text-muted-foreground">Onde</dt>
        <dd>
          {unitDoc.name}
          {unitDoc.whatsapp ? (
            <>
              {' · '}
              <a
                className="underline-offset-2 hover:underline"
                href={`https://wa.me/${unitDoc.whatsapp}`}
                target="_blank"
                rel="noreferrer"
              >
                WhatsApp
              </a>
            </>
          ) : null}
        </dd>
      </dl>

      <div>
        <Link href={`/${slug}/${unitSlug}`} className="text-primary text-sm underline">
          Voltar ao catálogo
        </Link>
      </div>
    </main>
  )
}
