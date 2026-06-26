// Guard: legacy catalog symbols are forbidden in @oilio/web (brief 0052 / B2,
// extended by brief 0053 / B3).
//
// The unified-catalog migration (#1004/#1005) left symbols that say `service`
// but operate on `catalog_items`. B2 (#1157) renamed them to the `catalog*`
// vocabulary; B3 (#1156) eliminated the legacy `Service`/`Product` form + the
// `catalogXToY` adapters entirely. This guard fails the `lint` script if any
// legacy name reappears, so a half-rename or an accidental reintroduction is
// caught in CI — the structural metric of the briefs ("0 legacy symbols").
//
// Banned (whole-word):
//   B2:
//   - serviceIds            → catalogServiceIds      (Professional field)
//   - canManageServices     → canManageCatalog       (RBAC permission)
//   - loadActiveService     → loadActiveCatalogService
//   - loadPublicServices    → (inlined; loadPublicCatalogServiceItems)
//   B3 — adapters/projections (unique whole-words, no collision):
//   - catalogServiceToService → (removed; use CatalogServiceItem directly)
//   - catalogProductToProduct → (removed; use CatalogProductItem directly)
//   - toPublicService         → toPublicCatalogItem
//   - resolveServiceForUnit   → resolveCatalogItemForUnit
//   B3 — legacy types in TYPE POSITION (anchored so compound names are safe):
//   - PublicService           → PublicCatalogItem
//   - : Service / Service[] / <Service> / Service> (the bare legacy type)
//   - : Product / Product[] / <Product> / Product>
//
// `serviceIds` is matched whole-word, so the camelCase derivatives that are NOT
// the legacy field (catalogServiceIds, selectedServiceIds, eligibleServiceIds,
// submittedServiceIds, nextCatalogServiceIds) do not trip it. The singular
// `serviceId` (an appointment/booking arg, a distinct concept) is also fine.
// The bare-type patterns are anchored to type positions (`:`/`[]`/`<>`), so
// compound identifiers (`CatalogServiceItem`, `OrderItemKind`, `ProductSource`,
// `ServicePriceVisibility`) never trip them.
//
// Walks the filesystem directly (NOT `git ls-files`): the test container copies
// the app without `.git`, so a git-based scan would crash there (and in any
// detached CI checkout). Run from apps/oilio/web (cwd of the lint script).
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Whole-word patterns. `\b` before a lowercase `serviceIds` won't match inside
// `catalogServiceIds` (the boundary sits before the capital `S`).
const BANNED = [
  { name: 'serviceIds', re: /\bserviceIds\b/ },
  { name: 'canManageServices', re: /\bcanManageServices\b/ },
  { name: 'loadActiveService', re: /\bloadActiveService\b/ },
  { name: 'loadPublicServices', re: /\bloadPublicServices\b/ },
  // B3 — removed adapters/projections (unique whole-words).
  { name: 'catalogServiceToService', re: /\bcatalogServiceToService\b/ },
  { name: 'catalogProductToProduct', re: /\bcatalogProductToProduct\b/ },
  { name: 'toPublicService', re: /\btoPublicService\b/ },
  { name: 'resolveServiceForUnit', re: /\bresolveServiceForUnit\b/ },
  // B3 — removed legacy `PublicService` type (whole-word; no compound collides).
  { name: 'PublicService', re: /\bPublicService\b/ },
  // B3 — removed legacy `Service`/`Product` types, matched ONLY in a TYPE
  // position so neither compound identifiers (CatalogServiceItem,
  // ProductOrderLine, ServiceUnitOverride…) nor prose ("the Service price")
  // trip the guard. A type position is a type-punctuation lead-in immediately
  // before the bare word — one of `:` `<` `,` `[` (with optional whitespace) —
  // or the `Service[]` array form:
  //   `: Service`  `: Service[]`            annotation
  //   `<Service>`  `<Service,`  `<Service[]`  generic arg (first)
  //   `Record<string, Service>`             generic arg (after comma)
  //   `[Service]`  `[Service, X]`           tuple element
  //   `Service[]`                            array type
  //   `Partial<Service>` / `Exclude<Service, …>` covered by the `<`/`,` forms
  // The trailing class forbids a following identifier char, so `Service` must
  // be the whole word (rules out `ServiceItem`, `ServiceUnitOverride`).
  {
    name: 'Service (legacy type)',
    re: /(?:[:<,[]\s*Service|\bService\[\])(?![A-Za-z0-9_])/,
  },
  {
    name: 'Product (legacy type)',
    re: /(?:[:<,[]\s*Product|\bProduct\[\])(?![A-Za-z0-9_])/,
  },
]

// Source roots to scan (relative to apps/oilio/web). The app-root config files
// (next/vitest/playwright/eslint/postcss) are scanned too (depth-0 walk via '.')
// so a legacy symbol reintroduced in test/build config — role fixtures, setup
// files — cannot slip past the gate.
const ROOTS = ['src', 'tests', 'scripts']
const EXTRA_FILES = []
const SCAN_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const SKIP_DIRS = new Set(['node_modules', '.next', 'coverage', 'dist', '.turbo'])

// This guard file necessarily names the banned symbols in its own docs — skip it.
const SELF = join('scripts', 'no-legacy-catalog-symbols.mjs')

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      yield* walk(full)
    } else if (SCAN_EXT.test(e.name)) {
      yield full
    }
  }
}

// App-root config/setup files (depth-0 only — the recursive roots above already
// cover subdirs). Catches a legacy symbol reintroduced in next/vitest/playwright
// config or a root-level setup file.
function rootLevelFiles() {
  let entries
  try {
    entries = readdirSync('.', { withFileTypes: true })
  } catch {
    return []
  }
  return entries.filter((e) => e.isFile() && SCAN_EXT.test(e.name)).map((e) => e.name)
}

const files = [...ROOTS.flatMap((r) => [...walk(r)]), ...rootLevelFiles(), ...EXTRA_FILES].filter(
  (f) => f !== SELF,
)

const hits = []
for (const file of files) {
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    for (const { name, re } of BANNED) {
      if (re.test(lines[i])) hits.push({ file, line: i + 1, name, text: lines[i].trim() })
    }
  }
}

if (hits.length > 0) {
  console.error('\n✖ Legacy catalog symbols found in @oilio/web (brief 0052 / B2 — AC-09).')
  console.error('  These names were renamed to the catalog* vocabulary. Fix the source:\n')
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  [${h.name}]  ${h.text}`)
  }
  console.error('')
  process.exit(1)
}
