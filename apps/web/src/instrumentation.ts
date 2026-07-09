export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const [{ initEventStore }, { initProductDb }] = await Promise.all([
    import('@/shared/db/pg'),
    import('@cbrl/product'),
  ])
  await Promise.all([initEventStore(), initProductDb()])
}
