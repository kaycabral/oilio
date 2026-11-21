import * as Sentry from '@sentry/nextjs'

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')

    const [{ initEventStore }, { initProductDb }] = await Promise.all([
      import('@/shared/db/pg'),
      import('@oilio/product'),
    ])
    initEventStore()
    initProductDb()
    return
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
