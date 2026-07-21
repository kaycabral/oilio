'use client'

import { OAuthSignInButtons } from '@/components/oauth-sign-in-buttons'
import { Typography } from '@cbrl/design'
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
        {/*
          Two deliberate copies, not one truncated by CSS: the narrow screen gets
          the short line, the wide screen the full pitch. Both stay in the DOM so
          the swap costs no JS and cannot flash after hydration.
        */}
        <Typography variant="muted" className="md:hidden">
          Sua agenda, assinaturas e caixa num lugar só.
        </Typography>
        <Typography variant="muted" className="hidden md:block">
          Agenda, assinatura e comissão trabalham juntas num só lugar. Entre para continuar de onde
          parou.
        </Typography>
      </div>
      <OAuthSignInButtons next={next} />
    </div>
  )
}
