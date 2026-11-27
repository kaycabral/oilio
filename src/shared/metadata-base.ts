export function metadataBase(
  siteUrl = process.env.NEXT_PUBLIC_SITE_URL,
  vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL,
): URL {
  if (siteUrl) return new URL(siteUrl)
  if (vercelHost) return new URL(`https://${vercelHost}`)
  return new URL('http://localhost:3005')
}
