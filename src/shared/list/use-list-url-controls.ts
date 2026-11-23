'use client'

import { toRoute } from '@/shared/routes'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

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
