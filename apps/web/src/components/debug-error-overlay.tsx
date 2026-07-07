'use client'

import { useEffect, useState } from 'react'

// TEMPORARY diagnostic overlay (remove after the UserMenu-disappears bug is
// root-caused). A standalone PWA gives no console, and the reported failure —
// the sidebar-footer UserMenu vanishes and stays gone until the app is killed —
// looks like a client-side exception that a nested boundary swallows (the rest
// of the app keeps working, so it is NOT the top-level error.tsx). To catch it
// wherever it originates, this listens to the GLOBAL error channels
// (`window.onerror` for render/sync throws, `unhandledrejection` for async) and
// paints the message + stack in a fixed banner, readable straight from the phone.
// Render any thrown value (Error or not) to a readable string without touching
// the DOM lib's `any`-typed `reason`.
function describe(value: unknown): string {
  return value instanceof Error
    ? `${value.name}: ${value.message}\n${value.stack ?? ''}`
    : String(value)
}

export function DebugErrorOverlay() {
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    const push = (label: string, detail: string) =>
      setErrors((prev) => [...prev, `[${label}] ${detail}`].slice(-8))

    const onError = (event: ErrorEvent) => {
      const stack =
        event.error instanceof Error && event.error.stack ? `\n${event.error.stack}` : ''
      push('error', `${event.message}${stack}`)
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      // `event.reason` is typed `any` by the DOM lib; `describe` narrows via
      // `unknown` so no `any` leaks into the call.
      push('unhandledrejection', describe(event.reason))
    }

    // Resource-load failures (e.g. the Google avatar image returning 403/429)
    // do NOT bubble to `window.onerror` — they only fire on the element in the
    // CAPTURE phase. Listen in capture so a broken <img> is visible too, since a
    // failing AvatarImage is a prime suspect for the vanishing footer content.
    const onCapture = (event: Event) => {
      const t = event.target
      if (t instanceof HTMLImageElement) push('img-error', `<img> falhou: ${t.src}`)
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onCapture, true)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onCapture, true)
    }
  }, [])

  if (errors.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        insetInline: 0,
        bottom: 0,
        zIndex: 2147483647,
        maxHeight: '45vh',
        overflow: 'auto',
        background: '#7f1d1d',
        color: '#fff',
        font: '11px/1.4 monospace',
        padding: '8px 10px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <strong>DEBUG — {errors.length} erro(s) capturado(s)</strong>
        <button
          type="button"
          onClick={() => setErrors([])}
          style={{
            background: '#fff',
            color: '#7f1d1d',
            border: 0,
            borderRadius: 4,
            padding: '2px 8px',
          }}
        >
          limpar
        </button>
      </div>
      {errors.map((e, i) => (
        <div
          key={i}
          style={{ borderTop: '1px solid rgba(255,255,255,.3)', paddingTop: 6, marginTop: 6 }}
        >
          {e}
        </div>
      ))}
    </div>
  )
}
