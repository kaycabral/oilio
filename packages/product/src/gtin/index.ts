export { computeCheckDigit, hasValidCheckDigit } from './check-digit'
export { classifyPrefix, type PrefixClass } from './prefix'
export type {
  FallbackIdentity,
  GtinRejected,
  GtinRejectionReason,
  GtinResult,
  GtinValid,
} from './types'
export { resolveFallback, validateGtin } from './validate'
