import { getPublicOrgBundle } from '@/features/self-book/adapters/public-org'
import { getSessionUser } from '@/shared/auth/session'
import { ensureSelfSignupCustomer } from '@/shared/org/customer-upsert'
import { getUserDoc } from '@/shared/org/membership'
import { Button } from '@cbrl/design'
import { Check } from 'lucide-react'
import type { Metadata, Route } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'

type PageProps = { searchParams: Promise<{ from?: string }> }

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { from } = await searchParams
  if (from) {
    const bundle = await getPublicOrgBundle(from)
    if (bundle) return { title: `Cadastro registrado — ${bundle.org.name}` }
  }
  return { title: 'Cadastro registrado — Oilio' }
}

export default async function SignupDonePage({ searchParams }: PageProps) {
  const { from } = await searchParams

  const session = await getSessionUser()
  if (!session) redirect(buildSignupUrl(from))

  const user = await getUserDoc(session.uid)
  if (!user) redirect(buildSignupUrl(from))

  if (!user.completionCompleted) {
    redirect(`/onboarding/profile?next=${encodeURIComponent(buildDoneUrl(from))}`)
  }

  const bundle = from ? await getPublicOrgBundle(from) : null
  if (bundle) {
    await ensureSelfSignupCustomer(bundle.org.id, session.uid)
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-12">
      <header className="space-y-2 text-center">
        <div className="bg-primary/10 text-primary mx-auto flex h-14 w-14 items-center justify-center rounded-full">
          <Check className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold">Pronto, {user.displayName ?? 'você'}!</h1>
        {bundle ? (
          <p className="text-muted-foreground text-sm">
            Você está cadastrado em <strong className="text-foreground">{bundle.org.name}</strong>.
            A recepção entrará em contato pelo WhatsApp pra confirmar seu horário.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            Sua conta no Oilio foi criada. Você pode agendar em qualquer estabelecimento disponível
            na plataforma.
          </p>
        )}
      </header>
      {bundle ? (
        <div className="flex flex-col gap-2">
          <Button asChild variant="outline">
            <Link href={`/${from}`}>Voltar para {bundle.org.name}</Link>
          </Button>
        </div>
      ) : null}
    </main>
  )
}

function buildSignupUrl(from: string | undefined): Route {
  return from ? `/signup?from=${encodeURIComponent(from)}` : '/signup'
}

function buildDoneUrl(from: string | undefined): Route {
  return from ? `/signup/done?from=${encodeURIComponent(from)}` : '/signup/done'
}
