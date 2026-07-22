'use client'

import { OAuthSignInButtons } from '@/components/oauth-sign-in-buttons'
import { Typography } from '@oilio/design'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'

export function SignupBusinessForm() {
  const params = useSearchParams()
  const intent = params.get('intent')
  const next = intent ? `/onboarding?intent=${encodeURIComponent(intent)}` : '/onboarding'
  const loginHref = intent ? `/login?next=${encodeURIComponent(next)}` : '/login'

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 text-center">
        <span className="text-lg font-semibold tracking-tight">Oilio</span>
        <Typography as="h1" variant="h1" className="text-3xl text-balance">
          Crie seu negócio no Oilio
        </Typography>
        <Typography variant="muted" className="md:hidden" data-slot="subtitle-narrow">
          Agenda, assinaturas e caixa prontos pra configurar.
        </Typography>
        <Typography variant="muted" className="hidden md:block" data-slot="subtitle-wide">
          Sua conta abre um negócio na plataforma — agenda, assinaturas e caixa trabalham juntos
          desde o primeiro dia.
        </Typography>
      </div>
      <OAuthSignInButtons next={next} />
      <Typography variant="muted" className="text-center text-sm">
        Já tem conta?{' '}
        <Link href={loginHref} className="text-foreground font-medium underline underline-offset-4">
          Entrar
        </Link>
      </Typography>
    </div>
  )
}
