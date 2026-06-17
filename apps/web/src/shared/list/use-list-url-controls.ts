'use client'

import { toRoute } from '@/shared/routes'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// Binds the design List's controlled search/filter callbacks to URL search
// params (the scheduling persistence choice: shareable, back-button-friendly,
// read server-side by the page's RSC re-query). This is the single place the
// "callback → URL" wire lives, so every list page stays a thin caller and a
// change to how filter state syncs happens here only. `null`/`''` deletes a
// param (the "no filter" / cleared-search case).
export function useListUrlControls(): {
  setParams: (updates: Record<string, string | null>) => void
} {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setParams(updates: Record<string, string | null>): void {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') params.delete(key)
      else params.set(key, value)
    }
    const queryString = params.toString()
    router.replace(toRoute(queryString ? `${pathname}?${queryString}` : pathname))
  }

  return { setParams }
}
