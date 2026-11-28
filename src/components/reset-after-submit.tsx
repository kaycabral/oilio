'use client'

import { Fragment, useLayoutEffect, useRef, useState } from 'react'

export function RemountOnReturn({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0)

  useLayoutEffect(() => () => setVersion((v) => v + 1), [])

  return <Fragment key={version}>{children}</Fragment>
}

export function ResetAfterSubmit({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0)
  const submitted = useRef(false)

  useLayoutEffect(
    () => () => {
      if (!submitted.current) return
      submitted.current = false
      setVersion((v) => v + 1)
    },
    [],
  )

  return (
    <div
      key={version}
      className="contents"
      onSubmitCapture={() => {
        submitted.current = true
      }}
    >
      {children}
    </div>
  )
}
