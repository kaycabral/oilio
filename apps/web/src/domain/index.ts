export {
  InviteStatus,
  MembershipStatus,
  OPERATIONAL_STATUSES,
  OperationalStatus,
  ROLES,
  Role,
  VERTICALS,
  Vertical,
  canInviteMembers,
  canManageTenant,
  isOperational,
} from './types/enums'

export {
  TaxIdentity,
  isCompany,
  isValidCompanyTaxId,
  isValidIndividualTaxId,
  normalizeTaxId,
} from './types/tax'

export {
  summarizeCommissions,
  summarizeCommissionsByMember,
  summarizeCoveredAttendances,
} from './utils/commission-report'
export type {
  CommissionReportSummary,
  CommissionStatusSummary,
  CoveredAttendanceReport,
  CoveredAttendanceSummary,
  MemberCommissionSummary,
} from './utils/commission-report'

export { RESERVED_SLUGS, SLUG_PATTERN, isReservedSlug, isValidSlug, slugify } from './types/slug'

export {
  BirthDateParseResult,
  Customer,
  StoredCustomer,
  formatBirthDate,
  parseBirthDate,
} from './types/customer'
export {
  INVITE_TTL_MS,
  Invite,
  InvitePii,
  StoredInvite,
  inviteEmailsMatch,
  normalizeInviteEmail,
} from './types/invite'
export {
  Membership,
  MembershipPermissions,
  defaultPermissionsForRole,
  membershipDocId,
  operatesCrossUnit,
  roleDescription,
} from './types/membership'
export {
  DEFAULT_NOTIFICATION_TEMPLATES,
  DISPATCHABLE_NOTIFICATION_TYPES,
  MessageTemplate,
  NOTIFICATION_TEMPLATE_PLACEHOLDERS,
  NotificationTemplateVars,
  defaultTemplateBody,
  isDispatchableType,
  renderNotificationTemplate,
} from './types/message-template'
export type { DispatchableNotificationType } from './types/message-template'
export {
  MANAGER_ONLY_NOTIFICATION_TYPES,
  allowedNotificationTypesForRole,
  canRoleSeeNotificationType,
} from './types/notification-permissions'
export {
  CommissionRule,
  Professional,
  ProfessionalPii,
  StoredProfessional,
  professionalsForService,
} from './types/professional'
export {
  CancellationPolicy,
  DEFAULT_CANCELLATION_POLICY,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_TENANT_BRANDING,
  DEFAULT_TENANT_TIMEZONE,
  MAX_CANCELLATION_NOTICE_MINUTES,
  MIN_CANCELLATION_NOTICE_MINUTES,
  SLOT_MINUTES_OPTIONS,
  SlotMinutes,
  StoredTenant,
  TENANT_DESCRIPTION_MAX,
  Tenant,
  TenantBranding,
  isValidCancellationNoticeMinutes,
  isValidPublicHttpUrl,
  isValidSlotMinutes,
  normalizeCancellationPolicy,
  normalizeTenantBranding,
} from './types/tenant'
export { TenantLink, tenantLinkDocPath } from './types/tenant-link'
export {
  Address,
  BusinessHours,
  DayHours,
  HoursRange,
  RESERVED_UNIT_SLUGS,
  StoredUnit,
  UNIT_HOURS_MODES,
  Unit,
  UnitHoursMode,
  UnitPii,
  dayHoursToRanges,
  isReservedUnitSlug,
  isUnitBookable,
  isValidUnitSlug,
  slugifyUnitName,
  unitUsesAgenda,
} from './types/unit'
export { User } from './types/user'
export {
  ROLE_SUBJECT_NOUN,
  anonymizedLabel,
  anonymizedSubjectCode,
  buildUserAnonymizationScrub,
  isAnonymized,
  resolveSubjectAvatar,
  resolveSubjectName,
} from './utils/anonymization'
export type {
  BlockedSubject,
  ResolveSubjectNameOpts,
  UserAnonymizationScrub,
} from './utils/anonymization'

export { SuggestedService, VERTICAL_DEFAULTS, VerticalDefaults } from './types/vertical-defaults'

export {
  AGENDA_BLOCK_KINDS,
  AgendaBlock,
  AgendaBlockKind,
  OneOffAgendaBlock,
  RecurringAgendaBlock,
} from './types/agenda-block'
export {
  APPOINTMENT_STATUSES,
  Appointment,
  AppointmentActorRole,
  AppointmentStatus,
  computeNoticeMinutes,
} from './types/appointment'
export {
  CATALOG_ITEM_KINDS,
  CatalogItem,
  CatalogItemKind,
  CatalogItemUnitOverride,
  CatalogProductItem,
  CatalogServiceItem,
  PublicCatalogItem,
  catalogProductToProduct,
  catalogServiceToService,
  isCatalogProduct,
  isCatalogService,
  normalizeCatalogItemKind,
  resolveCatalogItemForUnit,
  toPublicCatalogItem,
} from './types/catalog-item'
export { CATEGORY_NAME_MAX, CATEGORY_NAME_MIN, Category } from './types/category'
export { CHARGE_STATUSES, Charge, ChargeStatus } from './types/charge'
export {
  Commission,
  LIQUIDATION_STATUSES,
  LiquidationStatus,
  liquidationStatusOf,
} from './types/commission'
export {
  GOAL_PERIOD_PATTERN,
  GOAL_TARGET_MIN_CENTS,
  Goal,
  GoalType,
  goalDocId,
  isValidGoalPeriod,
} from './types/goal'
export {
  ORDER_COVERAGES,
  ORDER_ITEM_KINDS,
  ORDER_STATUSES,
  Order,
  OrderCoverage,
  OrderItem,
  OrderItemKind,
  OrderStatus,
  PAYMENT_METHODS,
  PaymentMethod,
  coverageOf,
} from './types/order'
export { Product } from './types/product'
export {
  PublicService,
  SERVICE_PRICE_VISIBILITIES,
  Service,
  ServicePriceVisibility,
  ServiceUnitOverride,
  normalizeServicePriceVisibility,
  normalizeServicePublicVisible,
  resolveServiceForUnit,
  toPublicService,
} from './types/service'
export {
  SUBSCRIPTION_STATUSES,
  Subscription,
  SubscriptionPeriod,
  SubscriptionPlanSnapshot,
  SubscriptionStatus,
} from './types/subscription'
export {
  AllowedTimeScope,
  BILLING_CYCLES,
  BillingCycle,
  BookingLimits,
  SubscriptionPlan,
  UsageLimit,
} from './types/subscription-plan'

export {
  CASH_MOVEMENT_KINDS,
  CashMovement,
  CashMovementDirection,
  CashMovementKind,
} from './types/cash-movement'
export {
  EXPENSE_CATEGORY_NAME_MAX,
  EXPENSE_CATEGORY_NAME_MIN,
  ExpenseCategory,
} from './types/expense-category'
export { buildCashMovementsCsv } from './utils/cash-movement-csv'
export {
  computeMovementTotals,
  getMovementDirection,
  isCashPaymentMethod,
} from './utils/cash-register'
export type { CashMovementTotals } from './utils/cash-register'

export {
  assertValidTimezone,
  fromTenantTime,
  getTenantDayBoundsUtc,
  getTodayInTenantTz,
  isValidTimezone,
  shiftDateInTenantTz,
  toTenantTime,
} from './utils/timezone'
export type { TenantTime } from './utils/timezone'

export {
  UF_TO_TZ,
  inferTimezoneFromAddress,
  resolveTenantTimezoneFromAddress,
} from './utils/timezone-br'

export { getBlockSegmentsForDay } from './utils/agenda-blocks'
export type { BlockSegment } from './utils/agenda-blocks'

export { computeAvailabilityForDay, groupAvailabilityByLocalTime } from './utils/availability'
export type {
  AvailabilityRow,
  AvailabilitySlot,
  ComputeAvailabilityInput,
} from './utils/availability'

export { canCustomerCancelAppointment } from './utils/self-cancel'
export type { SelfCancelCheck } from './utils/self-cancel'

export {
  isAdvanceBookingAllowed,
  isDayOfWeekAllowed,
  isHourRangeAllowed,
  isInstantWithinTimeScope,
  isValidTimeScopeHHmm,
  mergeAllowedTimeScopes,
} from './utils/time-scope'

export { isBookingLimitsUnrestricted, mergeBookingLimits } from './utils/booking-limits'

export {
  accrueCommissionForItem,
  computeCommissionAmountCents,
  computeItemLineTotal,
  computeOrderTotals,
  coveredItemQuantity,
  coveredProducts,
  coveredServiceQuantity,
  hasSaleItem,
  isOrderEditable,
} from './utils/order'
export type { CommissionAccrual, OrderTotals } from './utils/order'

export { findAppointmentConflicts, intervalsOverlap } from './utils/appointment-overlap'
export type { AppointmentConflict, AppointmentInterval } from './utils/appointment-overlap'

export { isItemCoveredBySubscription } from './utils/subscription-coverage'

export {
  DEFAULT_WHATSAPP_TEMPLATES,
  buildWhatsappLink,
  formatBrazilPhone,
  maskBrazilPhone,
  normalizeBrazilPhone,
  renderWhatsappTemplate,
  resolveWhatsappTemplates,
} from './utils/whatsapp'
export type {
  WhatsappTemplateKind,
  WhatsappTemplateVars,
  WhatsappTemplates,
} from './utils/whatsapp'

export {
  addMonthsUtc,
  computeBillingPeriod,
  computeNextChargeDate,
  isUsageLimitReached,
  remainingUsage,
} from './utils/billing'

export * from './subscription-self-cancel'
export {
  WEEKDAYS,
  getBusinessHoursForDay,
  getWeekdayInTenantTz,
  hhmmToMinutes,
  isBusinessHoursConfigured,
  isValidHHmm,
  minutesToHHmm,
  validateHoursRange,
} from './utils/business-hours'
export type { Weekday } from './utils/business-hours'

export { buildPlanSnapshot } from './utils/plan-snapshot'

export { lawfulPriceCents } from './utils/lawful-price'

export {
  isActiveMembershipStatus,
  isActiveOrderStatus,
  isActiveSubscriptionStatus,
  isFutureScheduledAppointment,
} from './utils/active-reference'
