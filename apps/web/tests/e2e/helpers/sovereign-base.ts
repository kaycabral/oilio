import { computeCheckDigit } from '@oilio/product'

const KNOWN_PREFIX_10 = '7891000100'
const UNSEEN_PREFIX_10 = '7893600029'

function ean13ForWorker(prefix10: string, workerIndex: number): string {
  const slot = String(workerIndex % 100).padStart(2, '0')
  const data12 = prefix10 + slot
  return data12 + String(computeCheckDigit(data12))
}

type SovereignBaseNamespace = {
  readonly knownGtin14: string
  readonly knownEan13: string
  readonly unseenGtin14: string
  readonly unseenEan13: string
  readonly knownName: string
  readonly knownSearchTerm: string
  readonly knownSearchTypo: string
  readonly contributedName: string
  readonly ownedGtins: readonly string[]
}

export function sovereignBaseNamespace(workerIndex: number): SovereignBaseNamespace {
  const tag = `w${workerIndex}`
  const knownEan13 = ean13ForWorker(KNOWN_PREFIX_10, workerIndex)
  const unseenEan13 = ean13ForWorker(UNSEEN_PREFIX_10, workerIndex)
  return {
    knownGtin14: `0${knownEan13}`,
    knownEan13,
    unseenGtin14: `0${unseenEan13}`,
    unseenEan13,
    knownName: `Leite Ninho 400g ${tag}`,
    knownSearchTerm: `ninho ${tag}`,
    knownSearchTypo: `leit ninho ${tag}`,
    contributedName: `Biscoito Recheado 140g ${tag}`,
    ownedGtins: [`0${knownEan13}`, `0${unseenEan13}`],
  }
}
