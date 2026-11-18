'use client'

import { Button, Typography } from '@cbrl/design'
import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  const isNetworkError = error.message.includes('Failed to fetch')

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-6 px-4 py-16 text-center">
      <Typography variant="pageTitle">Algo deu errado</Typography>
      <Typography variant="p" className="text-muted-foreground">
        {isNetworkError
          ? 'Não foi possível carregar esta tela. Verifique sua conexão e tente novamente — sua última ação pode já ter sido salva.'
          : 'Ocorreu um erro inesperado ao carregar esta tela.'}
      </Typography>

      <Button onClick={reset}>Tentar novamente</Button>
    </main>
  )
}
