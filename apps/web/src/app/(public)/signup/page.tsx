import { OAuthSignInButtons } from '@/components/oauth-sign-in-buttons'
import { getPublicOrgBundle } from '@/features/self-book/adapters/public-org'
import type { Metadata } from 'next'
import Image from 'next/image'

// Platform-canonical signup (#840 + refator pós-revisão). The act of
// signing up is a Oilio event (global User in `users/{uid}`),
// not an establishment event — the org is *attribution* of intent,
// not the boundary of account creation. We accept an optional `?from=
// {org-slug}` to surface context ("you came here through Salão X")
// and to materialize a Customer shadow in that org on `/signup/done`.
//
// Without `?from`, the page still works as a platform signup — useful
// for direct marketing links into the SaaS without a specific org.
// Invalid/unpublished `?from` is silently ignored (falls back to
// platform-only) instead of 404 — the platform signup itself is valid.

type PageProps = { searchParams: Promise<{ from?: string }> }

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { from } = await searchParams
  if (from) {
    const bundle = await getPublicOrgBundle(from)
    if (bundle) return { title: `Cadastrar-se — ${bundle.org.name}` }
  }
  return { title: 'Cadastrar-se no Oilio' }
}

export default async function PublicSignupPage({ searchParams }: PageProps) {
  const { from } = await searchParams
  const bundle = from ? await getPublicOrgBundle(from) : null

  // Preserve a validated `from` through to the done page so the same
  // org context is used for the Customer shadow materialization.
  const next = bundle ? `/signup/done?from=${encodeURIComponent(from!)}` : '/signup/done'

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
