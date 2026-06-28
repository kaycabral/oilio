import type { StoredMemberOperation } from '@/domain/types/member-operation'

// Projeção event-sourced = o doc operacional `StoredMemberOperation` (sem PII —
// name/whatsapp/email lidos de `users/{userId}`, taxIdentity de
// `member_operations_pii`, materializados na leitura) + a versão do stream.

export type MemberOperationState = StoredMemberOperation & { readonly _version: number }

export const INITIAL_MEMBER_OPERATION_STATE: MemberOperationState = {
  id: '',
  orgId: '',
  userId: '',
  defaultCommission: null,
  unitIds: [],
  catalogServiceIds: [],
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
