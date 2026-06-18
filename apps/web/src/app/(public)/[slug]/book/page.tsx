import { StoredUnit, isOperational } from '@/domain'
import { getPublicOrgBundle } from '@/features/self-book/adapters/public-org'
import { BookingForm } from '@/features/self-book/ui/BookingForm'
import { getAdminFirestore } from '@/shared/db'
import { fsConverter } from '@/shared/db/converter'
import { listProfessionalsForOrg } from '@/shared/org/professional-read'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

type PageProps = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const bundle = await getPublicOrgBundle(slug)
  if (!bundle) return { title: 'Página não encontrada' }
  return { title: `Agendar — ${bundle.org.name}` }
}

export default async function PublicBookingPage({ params }: PageProps) {
  const { slug } = await params
  const bundle = await getPublicOrgBundle(slug)
  if (!bundle) notFound()

  const { org, services } = bundle
  if (services.length === 0) notFound()

  const db = getAdminFirestore()
  const [unitsSnap, allProfessionals] = await Promise.all([
    db
      .collection('orgs')
      .doc(org.id)
      .collection('units')
      .orderBy('name')
      .withConverter(fsConverter(StoredUnit))
      .get(),
    listProfessionalsForOrg(org.id),
  ])

  const units = unitsSnap.docs.map((d) => d.data())
  const unitNameById = new Map(units.map((u) => [u.id, u.name]))
  const professionals = allProfessionals
    .filter((p) => p.unitIds.length > 0)
    .filter((p) => isOperational(p.operationalStatus))
    .map((p) => ({
      id: p.id,
      name: p.name,
      unitName: unitNameById.get(p.unitIds[0]!) ?? '—',
    }))

  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Agendar em {org.name}</h1>
        <p className="text-muted-foreground text-sm">
          Preencha seus dados e escolha um horário. Confirmaremos por WhatsApp.
        </p>
      </header>
      <BookingForm
        slug={slug}
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          durationMinutes: s.durationMinutes,
          priceCents: s.priceCents,
        }))}
        professionals={professionals}
        cancellationPolicy={org.cancellationPolicy}
      />
    </main>
  )
}
