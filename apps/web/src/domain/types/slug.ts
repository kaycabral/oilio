export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

// Slugs reservados — usados por rotas top-level do app, não podem virar slug
// público de tenant (causaria conflito de rota no Next.js, com a rota
// estática vencendo da rota dinâmica `[slug]`). Lista mantida em sync com
// `apps/oilio/web/src/app/` (api, auth, invites, login, onboarding,
// page.tsx homepage) + tudo dentro de `(app)/`.
export const RESERVED_SLUGS = new Set<string>([
  'admin',
  'agenda',
  'api',
  'app',
  'auth',
  'blocks',
  'book',
  'booking',
  'cash',
  'orders',
  'company',
  'customers',
  'dashboard',
  'help',
  'home',
  'invites',
  'login',
  'logout',
  'new',
  'onboarding',
  'plans',
  'pricing',
  'products',
  'professionals',
  'public',
  'receivables',
  'services',
  'settings',
  'signup',
  'subscriptions',
  'support',
  'team',
  'units',
  'wizard',
])

export function isReservedSlug(value: string): boolean {
  return RESERVED_SLUGS.has(value)
}

const ACCENT_MAP: Record<string, string> = {
  á: 'a',
  à: 'a',
  ã: 'a',
  â: 'a',
  ä: 'a',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  í: 'i',
  ì: 'i',
  î: 'i',
  ï: 'i',
  ó: 'o',
  ò: 'o',
  õ: 'o',
  ô: 'o',
  ö: 'o',
  ú: 'u',
  ù: 'u',
  û: 'u',
  ü: 'u',
  ç: 'c',
  ñ: 'n',
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((ch) => ACCENT_MAP[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

export function isValidSlug(value: string): boolean {
  return (
    value.length >= 3 &&
    value.length <= 64 &&
    SLUG_PATTERN.test(value) &&
    !RESERVED_SLUGS.has(value)
  )
}
