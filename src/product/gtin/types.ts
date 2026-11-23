export type GtinRejectionReason =
  | 'empty'
  | 'non-numeric'
  | 'invalid-length'
  | 'check-digit'
  | 'restricted-circulation'
  | 'coupon-or-receipt'

export interface GtinValid {
  readonly kind: 'valid'
  readonly gtin14: string
}

export interface GtinRejected {
  readonly kind: 'rejected'
  readonly reason: GtinRejectionReason
}

export type GtinResult = GtinValid | GtinRejected

export interface FallbackIdentity {
  readonly kind: 'fallback'
  readonly brand: string
  readonly mpn: string
  readonly key: string
}
