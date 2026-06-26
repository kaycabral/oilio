'use client'

import { getClientAuth } from '@/shared/firebase/client'
import { REDIRECT_NEXT_KEY } from '@/shared/firebase/session'
import { Button } from '@cbrl/design'
import { getRedirectResult, GoogleAuthProvider, signInWithRedirect } from 'firebase/auth'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export type OAuthSignInButtonsProps = {
  next: string
  googleLabel?: string
  pendingLabel?: string
}

function buildProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  return provider
}

export function OAuthSignInButtons({
  next,
  googleLabel = 'Continuar com Google',
  pendingLabel = 'Conectando…',
}: OAuthSignInButtonsProps) {
  const [pending, setPending] = useState(false)
  const started = useRef(false)

  useEffect(() => {
    let cancelled = false
    if (window.sessionStorage.getItem(REDIRECT_NEXT_KEY) !== null) {
      started.current = true
      setPending(true)
    }
    async function resumeRedirect() {
      try {
        const auth = getClientAuth()
        const credential = await getRedirectResult(auth)
        if (cancelled) return
        if (!credential) {
          window.sessionStorage.removeItem(REDIRECT_NEXT_KEY)
          started.current = false
          setPending(false)
          return
        }
        await createSession(await credential.user.getIdToken())
        const stored = window.sessionStorage.getItem(REDIRECT_NEXT_KEY)
        window.sessionStorage.removeItem(REDIRECT_NEXT_KEY)
        window.location.replace(stored ?? next)
      } catch (err) {
        if (cancelled) return
        started.current = false
        setPending(false)
        toast.error(err instanceof Error ? err.message : 'Não foi possível entrar.')
      }
    }
    void resumeRedirect()
    return () => {
      cancelled = true
    }
  }, [next])

  async function signIn() {
    if (started.current) return
    started.current = true
    setPending(true)
    try {
      const auth = getClientAuth()
      window.sessionStorage.setItem(REDIRECT_NEXT_KEY, next)
      await signInWithRedirect(auth, buildProvider())
    } catch (err) {
      started.current = false
      setPending(false)
      toast.error(err instanceof Error ? err.message : 'Não foi possível entrar.')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        className="h-10"
        onClick={() => void signIn()}
        disabled={pending}
      >
        <GoogleLogo />
        {pending ? pendingLabel : googleLabel}
      </Button>
    </div>
  )
}

async function createSession(idToken: string): Promise<void> {
  const res = await fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
  if (!res.ok) throw new Error(`Session creation failed: ${res.status}`)
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.614Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  )
}
