import { describe, expect, it } from 'vitest'
import {
  checkCategoryCoverage,
  checkTimeScope,
  checkUnitAllowlist,
} from './subscription-scope-rules'

const TZ = 'America/Sao_Paulo'
const TODAY = '2026-06-10'

describe('checkUnitAllowlist', () => {
  it('passes when no allowlist is set', () => {
    expect(checkUnitAllowlist({ unitAllowlist: null }, 'unit_1')).toBeNull()
  })

  it('passes when the unit is allowed', () => {
    expect(checkUnitAllowlist({ unitAllowlist: new Set(['unit_1']) }, 'unit_1')).toBeNull()
  })

  it('blocks a unit outside the allowlist', () => {
    expect(checkUnitAllowlist({ unitAllowlist: new Set(['unit_2']) }, 'unit_1')).toEqual({
      ok: false,
      rule: 'unitAllowlist',
      error: 'Unidade fora das permitidas pelo plano do cliente.',
    })
  })
})

describe('checkCategoryCoverage', () => {
  it('passes when the plan is unrestricted (null)', () => {
    expect(checkCategoryCoverage({ includedCategoryIds: null }, 'cat_1')).toBeNull()
  })

  it('passes when the service category is covered', () => {
    expect(checkCategoryCoverage({ includedCategoryIds: new Set(['cat_1']) }, 'cat_1')).toBeNull()
  })

  it('blocks an uncategorized service under a restricted plan', () => {
    expect(checkCategoryCoverage({ includedCategoryIds: new Set(['cat_1']) }, null)?.rule).toBe(
      'includedCategoryIds',
    )
  })

  it('blocks a service whose category is not covered', () => {
    expect(checkCategoryCoverage({ includedCategoryIds: new Set(['cat_1']) }, 'cat_2')?.rule).toBe(
      'includedCategoryIds',
    )
  })
})

describe('checkTimeScope', () => {
  it('passes when no time scope is set', () => {
    expect(
      checkTimeScope({ allowedTimeScope: null }, '2026-06-11T10:00:00.000Z', TZ, TODAY),
    ).toBeNull()
  })
})
