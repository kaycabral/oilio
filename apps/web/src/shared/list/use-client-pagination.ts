'use client'

import * as React from 'react'

const DEFAULT_PAGE_SIZE = 10

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
