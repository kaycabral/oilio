// Guard: ESLint bulk-suppressions are forbidden in @oilio/web.
//
// `eslint .` auto-loads `eslint-suppressions.json` if present, silently hiding
// violations. This app is kept at ZERO suppressions on purpose — a real lint
// error must be FIXED, never suppressed (inline `eslint-disable` is already
// banned via `noInlineConfig` + `oilio/no-eslint-disable`). This guard fails the
// `lint` script if the ledger ever reappears (e.g. someone ran `--suppress-all`).
import { existsSync } from 'node:fs'

if (existsSync('eslint-suppressions.json')) {
  console.error(
    '\n✖ eslint-suppressions.json is forbidden in @oilio/web.\n' +
      '  Fix the lint violation instead of suppressing it (delete this file).\n',
  )
  process.exit(1)
}
