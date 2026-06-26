'use client'

import { getClientAuth } from '@/shared/firebase/client'
import { signOut } from 'firebase/auth'
import { useState } from 'react'

// Used when the OAuth identity email doesn't match the invite email.
// Drops the session cookie + Firebase client auth state and routes the
// user back to /login so they can pick the correct OAuth account.
export function LogoutAndRetryButton({ nextUrl }: { nextUrl: string }) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    if (loading) return
    setLoading(true)
    try {
      await fetch('/api/session', { method: 'DELETE' })
      await signOut(getClientAuth()).catch(() => {})
      window.location.replace(`/login?next=${encodeURIComponent(nextUrl)}`)
    } catch {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      className="text-sm underline"
      onClick={() => void handleClick()}
      disabled={loading}
    >
      {loading ? 'Saindo…' : 'Sair e relogar com a conta certa'}
    </button>
  )
}
