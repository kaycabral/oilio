export function lawfulPriceCents(
  displayedPriceCents: number | null,
  currentPriceCents: number,
): number {
  if (displayedPriceCents === null) return currentPriceCents
  return Math.min(displayedPriceCents, currentPriceCents)
}
