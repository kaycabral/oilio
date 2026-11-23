export type PrefixClass = 'accept' | 'restricted-circulation' | 'coupon-or-receipt'

function classifyGtin8(digits: string): PrefixClass {
  const lead = digits[0]
  return lead === '0' || lead === '2' ? 'restricted-circulation' : 'accept'
}

function classifyGtin13(digits: string): PrefixClass {
  const prefix = Number(digits.slice(0, 3))

  if (prefix >= 20 && prefix <= 29) return 'restricted-circulation'
  if (prefix >= 40 && prefix <= 59) return 'restricted-circulation'
  if (prefix >= 200 && prefix <= 299) return 'restricted-circulation'

  if (prefix === 980) return 'coupon-or-receipt'
  if (prefix >= 981 && prefix <= 984) return 'coupon-or-receipt'
  if (prefix >= 990 && prefix <= 999) return 'coupon-or-receipt'

  return 'accept'
}

export function classifyPrefix(digits: string): PrefixClass {
  switch (digits.length) {
    case 8:
      return classifyGtin8(digits)
    case 12:
      return classifyGtin13(`0${digits}`)
    case 13:
      return classifyGtin13(digits)
    case 14:
      return classifyGtin13(digits.slice(1))
    default:
      return 'accept'
  }
}
