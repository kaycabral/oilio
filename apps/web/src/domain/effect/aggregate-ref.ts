export type AggregateType =
  | 'agenda_block'
  | 'appointment'
  | 'cash_movement'
  | 'catalog_item'
  | 'category'
  | 'charge'
  | 'commission'
  | 'customer'
  | 'fixed_cost'
  | 'fixed_cost_override'
  | 'goal'
  | 'invite'
  | 'membership'
  | 'notification'
  | 'order'
  | 'org'
  | 'org_billing'
  | 'member_operation'
  | 'subscription'
  | 'subscription_plan'
  | 'unit'

export type AggregateRef = {
  readonly type: AggregateType
  readonly orgId: string
  readonly id: string
}

export type CollectionRef = {
  readonly type: AggregateType
  readonly orgId: string
}

type ConfigWithType = { readonly type: AggregateType }

export function aggregateRef(config: ConfigWithType, orgId: string, id: string): AggregateRef {
  return { type: config.type, orgId, id }
}

export function collectionRef(config: ConfigWithType, orgId: string): CollectionRef {
  return { type: config.type, orgId }
}

export function aggregateRefEquals(a: AggregateRef, b: AggregateRef): boolean {
  return a.type === b.type && a.orgId === b.orgId && a.id === b.id
}
