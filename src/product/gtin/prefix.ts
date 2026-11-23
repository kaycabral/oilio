/**
 * GS1 prefix classification for the sovereign-base key decision.
 *
 * A GTIN is rejected as a CANONICAL product key when its GS1 prefix marks it as
 * a Restricted Circulation Number (RCN — company/region-internal, not globally
 * unique) or a coupon/receipt number (not a trade item at all). Everything else
 * — including Bookland EAN (ISSN 977, ISBN 978/979, ISMN 979-0) — is a legitimate
 * global GTIN and is accepted.
 *
 * CRITICAL: classify on the ORIGINAL-length number, BEFORE zero-padding to 14.
 * Padding prepends zeros, which masks the EAN-8 leading digit and shifts EAN-13
 * prefixes — so a GTIN-14-based check would misclassify. We evaluate:
 *   - GTIN-8  → leading digit of the 8-digit number (RCN-8: prefix 0 or 2).
 *   - GTIN-12 → treat as EAN-13 with an implicit leading 0 (UPC-A), so prefix 00x.
 *   - GTIN-13 → leading 3 digits.
 *   - GTIN-14 → strip the leading indicator digit, classify the embedded GTIN-13.
 *
 * Sources: GS1 General Specifications §2.1.6 (RCN), GSCN-23-006 (RCN), GS1 prefix
 * allocation list, EAN-8 RCN-8 (prefixes 0/2). The brief's candidate list
 * (02/04/2/05/98/99) is refined here to the precise GS1 ranges — notably matching
 * on 3 digits so the coupon band (980, 981–984, 990–999) does NOT swallow the
 * legitimate Bookland prefixes 977/978/979.
 */

/** Outcome of prefix classification. */
export type PrefixClass = 'accept' | 'restricted-circulation' | 'coupon-or-receipt'

/** Classify an 8-digit GTIN-8 by its RCN-8 leading digit. */
function classifyGtin8(digits: string): PrefixClass {
  const lead = digits[0]
  // GS1-8 prefixes 0 and 2 are RCN-8: company-internal distribution, not global.
  return lead === '0' || lead === '2' ? 'restricted-circulation' : 'accept'
}

/** Classify a 13-digit (or UPC-A-as-13) GTIN by its leading 3-digit prefix. */
function classifyGtin13(digits: string): PrefixClass {
  const prefix = Number(digits.slice(0, 3))

  // RCN ranges (region- or company-internal). Restricted circulation.
  // 020–029 region RCN / variable-measure
  if (prefix >= 20 && prefix <= 29) return 'restricted-circulation'
  // 040–049 company RCN; 050–059 reserved (conservative)
  if (prefix >= 40 && prefix <= 59) return 'restricted-circulation'
  // 200–299 region RCN / in-store
  if (prefix >= 200 && prefix <= 299) return 'restricted-circulation'

  // Coupon / refund-receipt numbers — not trade items.
  // 980 refund receipts
  if (prefix === 980) return 'coupon-or-receipt'
  // 981–984 GS1 coupon id (common currency)
  if (prefix >= 981 && prefix <= 984) return 'coupon-or-receipt'
  // 990–999 GS1 coupon id
  if (prefix >= 990 && prefix <= 999) return 'coupon-or-receipt'

  // Everything else is a legitimate global GTIN, including Bookland:
  //   977 ISSN · 978 ISBN · 979 ISBN/ISMN — accepted, normalized like any EAN-13.
  return 'accept'
}

/**
 * Classify `digits` (a check-digit-valid numeric string of length 8/12/13/14) by
 * its GS1 prefix. Length is assumed already validated by the caller.
 */
export function classifyPrefix(digits: string): PrefixClass {
  switch (digits.length) {
    case 8:
      return classifyGtin8(digits)
    case 12:
      // UPC-A: logically an EAN-13 with a leading 0.
      return classifyGtin13(`0${digits}`)
    case 13:
      return classifyGtin13(digits)
    case 14:
      // Strip the indicator digit → classify the embedded GTIN-13.
      return classifyGtin13(digits.slice(1))
    default:
      return 'accept'
  }
}
