export { buildReactor, type EventReaction } from './_shared/reactions'
export {
  AggregateVersion,
  Money,
  MoneySchema,
  NonEmptyString,
  OrgId,
  OrgIdSchema,
} from './_shared/value-objects'

export { SubscriptionConfig } from './subscription/config'
export { ChargeThresholdExceededError, SubscriptionNotActiveError } from './subscription/errors'
export type { SubscriptionEvent } from './subscription/events'
export { applySubscriptionEvent } from './subscription/reducer'
export { INITIAL_SUBSCRIPTION_STATE } from './subscription/types'
export type { SubscriptionState, SubscriptionStatus } from './subscription/types'

export { OrderConfig } from './order/config'
export { OrderAlreadyClosedError } from './order/errors'
export type { OrderEvent } from './order/events'
export { applyOrderEvent } from './order/reducer'
export { INITIAL_ORDER_STATE } from './order/types'
export type { OrderState, OrderStatus } from './order/types'

export { OrgConfig } from './org/config'
export type { OrgEvent } from './org/events'

export { OrgBillingConfig } from './org-billing/config'
export type { OrgBillingEvent } from './org-billing/events'
export type { OrgState } from './org/types'

export { UnitConfig } from './unit/config'
export type { UnitEvent } from './unit/events'
export type { UnitState } from './unit/types'

export { MemberOperationConfig } from './member-operation/config'
export {
  deriveOperationalStatus,
  type OperationalInputs,
} from './member-operation/derive-operational'
export type { MemberOperationEvent } from './member-operation/events'
export type { MemberOperationState } from './member-operation/types'

export { CustomerConfig } from './customer/config'
export type { CustomerEvent } from './customer/events'
export type { CustomerState } from './customer/types'

export { GoalConfig } from './goal/config'
export type { GoalEvent } from './goal/events'
export { applyGoalEvent } from './goal/reducer'
export { INITIAL_GOAL_STATE } from './goal/types'
export type { GoalState } from './goal/types'

export { CatalogItemConfig } from './catalog-item/config'
export { CatalogItemNotFoundError } from './catalog-item/errors'
export type { CatalogItemEvent } from './catalog-item/events'
export { applyCatalogItemEvent } from './catalog-item/reducer'
export { INITIAL_CATALOG_ITEM_STATE } from './catalog-item/types'
export type { CatalogItemState } from './catalog-item/types'

export { CategoryConfig } from './category/config'
export { CategoryInUseError, CategoryNotFoundError } from './category/errors'
export type { CategoryEvent } from './category/events'
export { applyCategoryEvent } from './category/reducer'
export { INITIAL_CATEGORY_STATE } from './category/types'
export type { CategoryState } from './category/types'

export { SubscriptionPlanConfig } from './subscription-plan/config'
export type { SubscriptionPlanEvent } from './subscription-plan/events'
export type { SubscriptionPlanState } from './subscription-plan/types'

export { ChargeConfig } from './charge/config'
export type { ChargeEvent } from './charge/events'
export type { ChargeState } from './charge/types'

export { AppointmentConfig } from './appointment/config'
export type { AppointmentEvent } from './appointment/events'
export type { AppointmentState } from './appointment/types'

export { AgendaBlockConfig } from './agenda-block/config'
export type { AgendaBlockEvent } from './agenda-block/events'
export type { AgendaBlockState } from './agenda-block/types'

export { CashMovementConfig } from './cash-movement/config'
export type { CashMovementEvent } from './cash-movement/events'
export type { CashMovementState } from './cash-movement/types'

export { CommissionConfig } from './commission/config'
export type { CommissionEvent } from './commission/events'
export type { CommissionState } from './commission/types'

export { InviteConfig } from './invite/config'
export type { InviteEvent } from './invite/events'
export type { InviteState } from './invite/types'

export { MembershipConfig } from './membership/config'
export type { MembershipEvent } from './membership/events'
export type { MembershipState } from './membership/types'

export { NotificationConfig } from './notification/config'
export type { NotificationEvent } from './notification/events'
export { createNotification, notificationExists } from './notification/helpers'
export type { CreateNotificationInput } from './notification/helpers'
export { notificationReactions } from './notification/reactions'
export { applyNotificationEvent } from './notification/reducer'
export { INITIAL_NOTIFICATION_STATE } from './notification/types'
export type { NotificationSource, NotificationState, NotificationType } from './notification/types'
