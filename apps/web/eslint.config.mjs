import cbrlBase from '@cbrl/eslint-base'
import checkFile from 'eslint-plugin-check-file'

export default [
  ...cbrlBase,
  // app = shell. `app/` holds only routing shells (page/layout/route + Next
  // special files). Visual lives in features/*/ui or components/; logic in
  // adapters/core. Ban private folders (`_components`, `_lib`, …) under app/ —
  // that's where non-routable code would re-accrete. Oilio-only: the other
  // apps use Next's colocation (`_components`) by design; scheduling is stricter
  // because of feature slices. Inverts the fragile "allowlist Next's files"
  // approach (which would drift on every Next version) — we ban OUR pattern.
  {
    files: ['src/app/**/*.{ts,tsx}'],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-blocklist': [
        'error',
        {
          '**/app/**/_*/**':
            'app/ é só casca de rota — sem pasta privada. Visual → features/*/ui ou components/; lógica → adapters/core.',
        },
      ],
    },
  },
  // Structured logging is canonical (brief 0086 / Onda 3·C): production code logs
  // through `@/shared/lib/logger` (severity + correlation-id, PII-safe), never raw
  // `console.*` — a raw console line is unstructured and correlation-less, and the
  // fragmentation this ban prevents is exactly what the wave consolidated.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    rules: {
      'no-console': 'error',
    },
  },
  // The logger IS the console sink — it's the one place allowed to call console.
  {
    files: ['src/shared/lib/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
]
