/**
 * GS1 Standard Weight (modulo-10) check digit.
 *
 * Canonical GS1 form (General Specifications §7.9): counting FROM THE RIGHT,
 * starting at the data digit immediately left of the check-digit position,
 * multiply by alternating weights 3,1,3,1,…. Sum, then
 * `checkDigit = (10 − (sum mod 10)) mod 10`.
 *
 * Anchoring from the right makes this length-independent: the same routine works
 * for GTIN-8/12/13/14 (and after zero-padding to 14, since leading zeros
 * contribute 0 to the weighted sum and never change the result). We deliberately
 * do NOT use the "odd/even position from the left" phrasing — that bakes in a
 * fixed length and breaks across GTIN lengths.
 */

/** Compute the GS1 mod-10 check digit for a string of `data` digits (no check digit). */
export function computeCheckDigit(dataDigits: string): number {
  let sum = 0
  // Walk right→left over the data digits; rightmost data digit gets weight 3.
  for (let i = 0; i < dataDigits.length; i++) {
    // subtract 48 ('0') to turn the char code into its numeric value
    const digit = dataDigits.charCodeAt(dataDigits.length - 1 - i) - 48
    const weight = i % 2 === 0 ? 3 : 1
    sum += digit * weight
  }
  return (10 - (sum % 10)) % 10
}

/** True if `gtin` (all digits, check digit included as the last char) is GS1-valid. */
export function hasValidCheckDigit(gtin: string): boolean {
  const data = gtin.slice(0, -1)
  const check = gtin.charCodeAt(gtin.length - 1) - 48
  return computeCheckDigit(data) === check
}
