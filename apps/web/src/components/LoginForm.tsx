'use client'

import { OAuthSignInButtons } from '@/components/oauth-sign-in-buttons'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@cbrl/design'
import { useSearchParams } from 'next/navigation'

export function LoginForm() {
  const params = useSearchParams()
  const next = params.get('next') ?? '/dashboard'

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Use sua conta Google.</CardDescription>
      </CardHeader>
      <CardContent>
        <OAuthSignInButtons next={next} />
      </CardContent>
    </Card>
  )
}
