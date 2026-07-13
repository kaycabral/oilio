export type FeatureFlag = 'finance' | 'copilot' | 'notifications'

function coerce(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase()
  return v === 'true' || v === '1'
}

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  switch (flag) {
    case 'finance':
      return coerce(process.env.NEXT_PUBLIC_FF_FINANCE)
    case 'copilot':
      return coerce(process.env.NEXT_PUBLIC_FF_COPILOT)
    case 'notifications':
      return coerce(process.env.NEXT_PUBLIC_FF_NOTIFICATIONS)
  }
}
