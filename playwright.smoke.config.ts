import { defineSmokeConfig } from '@cbrl/testing/playwright'
import { defineConfig } from '@playwright/test'

import { SMOKE_STORAGE_STATE } from './tests/smoke/storage-state'

const smoke = defineSmokeConfig({ testDir: './tests/smoke' })

export default defineConfig({
  ...smoke,
  globalSetup: './tests/smoke/global-setup.ts',
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: { ...smoke.use, storageState: SMOKE_STORAGE_STATE },
})
