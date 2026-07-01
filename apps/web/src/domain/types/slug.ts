// Canonical slug rule, used at runtime via `.test()`. The JS engine compiles this
// literal with default flags (never `v`), so the trailing `-` in the class is
// valid and lint-clean here; see `SLUG_HTML_PATTERN` for the `v`-safe HTML form.
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

// The same rule as an HTML `pattern` attribute value: the `SLUG_PATTERN` source
// without the `^…$` anchors (the attribute is implicitly anchored to the whole
// value), with the class hyphen ESCAPED (`\-`). Modern engines (Safari/iOS)
// compile the `pattern` attribute with the `v` (unicodeSets) flag, under which an
// unescaped trailing `-` in a class is a SyntaxError that breaks form submission
// (#1295). `\-` matches an identical literal hyphen and is valid under `u` and
// `v`. Derived from `SLUG_PATTERN` so the two can never drift.
export const SLUG_HTML_PATTERN = SLUG_PATTERN.source
  .replace(/^\^/, '')
  .replace(/\$$/, '')
  .replace('[a-z0-9-]', '[a-z0-9\\-]')

// Slugs reservados — usados por rotas top-level do app, não podem virar slug
// público de org (causaria conflito de rota no Next.js, com a rota
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
  'member_operations',
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
