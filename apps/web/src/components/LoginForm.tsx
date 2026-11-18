'use client'

import { OAuthSignInButtons } from '@/components/oauth-sign-in-buttons'
import { Typography } from '@oilio/design'
import { useSearchParams } from 'next/navigation'

export function LoginForm() {
  const params = useSearchParams()
  const next = params.get('next') ?? '/dashboard'

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 text-center">
        <span className="text-lg font-semibold tracking-tight">Oilio</span>
        <Typography as="h1" variant="h1" className="text-3xl text-balance">
          Entre na sua conta
        </Typography>
        <Typography variant="muted" className="md:hidden" data-slot="subtitle-narrow">
          Sua agenda, assinaturas e caixa num lugar só.
        </Typography>
        <Typography variant="muted" className="hidden md:block" data-slot="subtitle-wide">
          Agenda, assinatura e comissão trabalham juntas num só lugar. Entre para continuar de onde
          parou.
        </Typography>
      </div>
      <OAuthSignInButtons next={next} />
    </div>
  )
}
