// Lawful price at use-time (brief 0033 AC-09).
//
// When the price a consumer/operator was SHOWN diverges from the price LIVE at
// commit, Brazilian consumer law binds the offer (CDC art. 30 — the displayed
// price obliges) and, on divergence, the LOWER prevails (Decreto 5.903/2006
// art. 5º). So the committed price is `min(displayed, current)` — never more
// than what was displayed; when the live price dropped, the consumer benefits.
//
// `displayed === null` means the caller didn't thread a displayed price
// (e.g. progressive-enhancement without JS) — there's no offer ceiling to
// honor, so the current (live, transactionally-read) price is used as-is.
//
// 🟡 The manifest-error exception (CDC jurisprudence can relieve an obviously
// wrong price) is intentionally NOT automated here — out of scope for #1112.
export function lawfulPriceCents(
  displayedPriceCents: number | null,
  currentPriceCents: number,
): number {
  if (displayedPriceCents === null) return currentPriceCents
  return Math.min(displayedPriceCents, currentPriceCents)
}
