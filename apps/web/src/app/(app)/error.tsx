'use client'

import { Button, Typography } from '@cbrl/design'

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

      <pre className="border-border bg-muted text-muted-foreground max-h-64 w-full overflow-auto rounded-md border p-3 text-left font-mono text-xs whitespace-pre-wrap select-all">
        {error.name}: {error.message}
        {error.digest ? `\n\ndigest: ${error.digest}` : ''}
        {error.stack ? `\n\n${error.stack}` : ''}
      </pre>
    </main>
  )
}
