'use client'

import { Button, Typography } from '@cbrl/design'

// Error boundary for the authenticated app shell. Without it, an exception in
// any client component during a client-side navigation unmounts the whole shell
// subtree permanently — the sidebar footer / UserMenu vanish and only a full
// restart brings them back (the reported "menu some e só volta fechando o app").
// This CONTAINS the error (the shell recovers via `reset()`), and — because a
// standalone PWA gives no console — it RENDERS the message + stack on screen so
// the failure is diagnosable straight from the device.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 py-16 text-center">
      <Typography variant="pageTitle">Algo deu errado</Typography>
      <Typography variant="p" className="text-muted-foreground">
        Ocorreu um erro inesperado ao carregar esta tela.
      </Typography>

      <Button onClick={reset}>Tentar novamente</Button>

      {/* Diagnostic surface (temporary): the standalone PWA has no console, so
          show the error text on screen to capture the real cause from the device.
          Selectable/scrollable so it can be read or copied. */}
      <pre className="border-border bg-muted text-muted-foreground max-h-64 w-full overflow-auto rounded-md border p-3 text-left font-mono text-xs whitespace-pre-wrap select-all">
        {error.name}: {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        {error.stack ? `\n\n${error.stack}` : ''}
      </pre>
    </main>
  )
}
