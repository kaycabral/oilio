// Root ESLint config: picked up by lint-staged and by files outside a workspace
// (scripts/, root configs). Each workspace runs `eslint .` with its own config.
import baseConfig from '@oilio/eslint-config'

export default [
  ...baseConfig,
  {
    ignores: ['.husky/**'],
  },
]
