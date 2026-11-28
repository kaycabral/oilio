import { OAuthSignInButtons } from '@/components/oauth-sign-in-buttons'
import {
  attributionFromParams,
  attributionToSearchParams,
  isReservedUnitSlug,
  isValidUnitSlug,
} from '@/domain'
import { buildSignupNext } from '@/features/onboarding/core/signup-context'
import { getPublicOrgBundle } from '@/features/self-book/adapters/public-org'
import type { Metadata } from 'next'
import Image from 'next/image'
import { connection } from 'next/server'

export const instant = false

type PageProps = { searchParams: Promise<Record<string, string | undefined>> }

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { from } = await searchParams
  if (from) {
    const bundle = await getPublicOrgBundle(from)
    if (bundle) return { title: `Cadastrar-se — ${bundle.org.name}` }
  }
  return { title: 'Cadastrar-se no Oilio' }
}

export default async function PublicSignupPage({ searchParams }: PageProps) {
  await connection()
  const params = await searchParams
  const from = params.from
  const bundle = from ? await getPublicOrgBundle(from) : null

  const next = buildSignupNext(resolveBookingTarget(from, bundle != null, params))

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <header className="space-y-3 text-center">
        {bundle?.org.branding.logoUrl ? (
          <div className="bg-background relative mx-auto h-16 w-16 overflow-hidden rounded-full border shadow-sm">
            <Image
              src={bundle.org.branding.logoUrl}
              alt={`Logo de ${bundle.org.name}`}
              fill
              className="object-cover"
              sizes="64px"
              unoptimized
            />
          </div>
        ) : null}
        <h1 className="text-2xl font-semibold">Cadastrar-se no Oilio</h1>
        {bundle ? (
          <p className="text-muted-foreground text-sm">
            Você está sendo encaminhado por{' '}
            <strong className="text-foreground">{bundle.org.name}</strong> pra agendar com eles. Sua
            conta funciona em qualquer estabelecimento da plataforma.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">Use sua conta Google.</p>
        )}
      </header>
      <OAuthSignInButtons next={next} />
      <p className="text-muted-foreground text-center text-xs">
        Ao continuar, você concorda com nossos Termos e a Política de Privacidade.
      </p>
    </main>
  )
}

function resolveBookingTarget(
  orgSlug: string | undefined,
  hasOrg: boolean,
  params: Record<string, string | undefined>,
): string | null {
  if (!hasOrg || !orgSlug) return null
  const unitSlug = params.unit
  const hasUnit = !!unitSlug && isValidUnitSlug(unitSlug) && !isReservedUnitSlug(unitSlug)
  const path = hasUnit ? `/${orgSlug}/${unitSlug}` : `/${orgSlug}`
  return `${path}${attributionSuffix(params)}`
}

function attributionSuffix(params: Record<string, string | undefined>): string {
  const attribution = attributionFromParams((key) => params[key] ?? null)
  const query = attributionToSearchParams(attribution).toString()
  return query ? `?${query}` : ''
}
