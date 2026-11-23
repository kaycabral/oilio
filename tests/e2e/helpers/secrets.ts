export const CRON_SECRET = 'e2e-cron-secret'

export const STRIPE_SECRET_KEY = 'sk_test_e2eStripeMock'
export const STRIPE_WEBHOOK_SECRET = 'whsec_e2eStripeMock'

export const STRIPE_MOCK_SUBSCRIPTION_FIXTURE_PRICE = 'price_1PgafmB7WZ01zgkW6dKueIc5'

export const STRIPE_PRICES = {
  STRIPE_PRICE_PRO_MONTHLY: STRIPE_MOCK_SUBSCRIPTION_FIXTURE_PRICE,
  STRIPE_PRICE_PRO_ANNUAL: 'price_e2e_pro_annual',
  STRIPE_PRICE_ADVANCED_MONTHLY: 'price_e2e_advanced_monthly',
  STRIPE_PRICE_ADVANCED_ANNUAL: 'price_e2e_advanced_annual',
} as const
