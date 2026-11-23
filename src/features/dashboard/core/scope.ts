type UnitScopable<Q> = { where(field: 'unitId', op: '==', value: string): Q }

export function scopeByUnit<Q extends UnitScopable<Q>>(query: Q, unitId: string | null): Q {
  return unitId ? query.where('unitId', '==', unitId) : query
}
