// Lightweight email syntax check for the self-book contact step. The email
// is optional on a public booking — a falsey/invalid value is simply dropped
// (no Customer email), so this only needs to reject clearly-malformed input,
// not enforce RFC 5322.
export function isValidEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
