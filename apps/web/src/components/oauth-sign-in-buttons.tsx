'use client'

import { Button, GoogleIcon } from '@cbrl/design'
import { safeNext } from '@cbrl/next'
import { useGoogleSignIn } from '@cbrl/supabase/react'
import { toast } from 'sonner'

export type OAuthSignInButtonsProps = {
  next: string
  googleLabel?: string
  pendingLabel?: string
}

function notifyFailure(): void {
  toast.error('Não foi possível entrar. Tente novamente.')
}

export function OAuthSignInButtons({
  next,
  googleLabel = 'Continuar com Google',
  pendingLabel = 'Conectando…',
}: OAuthSignInButtonsProps) {
  const { signIn, pending } = useGoogleSignIn({
    next: safeNext(next, '/dashboard'),
    onError: notifyFailure,
  })

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        className="h-11"
        onClick={() => void signIn()}
        disabled={pending}
      >
        <GoogleIcon />
        {pending ? pendingLabel : googleLabel}
      </Button>
    </div>
  )
}
