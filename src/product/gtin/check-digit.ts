export function computeCheckDigit(dataDigits: string): number {
  let sum = 0
  for (let i = 0; i < dataDigits.length; i++) {
    const digit = dataDigits.charCodeAt(dataDigits.length - 1 - i) - 48
    const weight = i % 2 === 0 ? 3 : 1
    sum += digit * weight
  }
  return (10 - (sum % 10)) % 10
}

export function hasValidCheckDigit(gtin: string): boolean {
  const data = gtin.slice(0, -1)
  const check = gtin.charCodeAt(gtin.length - 1) - 48
  return computeCheckDigit(data) === check
}
