'use client'

import * as React from 'react'

const DEFAULT_PAGE_SIZE = 10

// Client-side pagination over an already-loaded (and already filtered) set: the
// page's RSC loads the filtered slice, this hook cuts it into pages in the
// browser — right for the current volumes (hundreds, not thousands). `resetKey`
// is the active query signature (search + filters); when it changes the page
// snaps back to 1 so a new search never lands the user on a stale page number.
// The current page is also clamped to the available count, so shrinking the set
// can't strand the view on an empty page.
export function useClientPagination<T>(
  items: readonly T[],
  options: { pageSize?: number; resetKey?: string } = {},
): {
  page: number
  pageCount: number
  pageItems: readonly T[]
  onPageChange: (page: number) => void
} {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const [page, setPage] = React.useState(1)

  React.useEffect(() => {
    setPage(1)
  }, [options.resetKey])

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(page, pageCount)
  const start = (current - 1) * pageSize
  const pageItems = items.slice(start, start + pageSize)

  return { page: current, pageCount, pageItems, onPageChange: setPage }
}
