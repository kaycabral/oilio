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
]
