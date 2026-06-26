'use client'

import { getClientAuth } from '@/shared/firebase/client'
import { isFirebaseConfigured } from '@/shared/firebase/config'
import { REDIRECT_NEXT_KEY } from '@/shared/firebase/session'
import { getRedirectResult } from 'firebase/auth'
import { Suspense, useEffect, useState } from 'react'

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<CallbackShell>Concluindo seu login…</CallbackShell>}>
      <CallbackInner />
    </Suspense>
  )
}

function CallbackInner() {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      window.location.replace('/')
      return
    }

    let cancelled = false

    async function finishSignIn() {
      try {
        const auth = getClientAuth()
        const credential = await getRedirectResult(auth)
        if (!credential) {
          // No redirect in flight — user hit /auth/callback directly.
          window.location.replace('/login')
          return
        }
        const idToken = await credential.user.getIdToken()
        const res = await fetch('/api/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        })
        if (!res.ok) throw new Error(`Session creation failed: ${res.status}`)
        const next = window.sessionStorage.getItem(REDIRECT_NEXT_KEY)
        window.sessionStorage.removeItem(REDIRECT_NEXT_KEY)
        window.location.replace(next ?? '/dashboard')
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'Sign-in failed.')
      }
    }

    void finishSignIn()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <CallbackShell>
      {error ? (
        <>
          <p className="text-destructive font-medium">{error}</p>
          <a href="/login" className="text-sm underline">
            Voltar pro login
          </a>
        </>
      ) : (
        <p className="text-muted-foreground">Concluindo seu login…</p>
      )}
    </CallbackShell>
  )
}

function CallbackShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 p-8 text-center">
      {children}
    </main>
  )
}
