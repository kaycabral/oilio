import type { AgendaBlock } from '@/domain/types/agenda-block'

// AC-05 (brief 0025): projeção cobre o doc inteiro (discriminated union recurring
// /one_off + timestamps), derivada só de eventos. `AgendaBlockState` == `AgendaBlock`
// + `_version`.
export type AgendaBlockState = AgendaBlock & { readonly _version: number }

export const INITIAL_AGENDA_BLOCK_STATE: AgendaBlockState = {
  id: '',
  orgId: '',
  unitId: '',
  memberOperationId: null,
  reason: '',
  kind: 'one_off',
  weekday: null,
  open: null,
  close: null,
  startAt: '',
  endAt: '',
  createdAt: '',
  updatedAt: '',
  _version: 0,
}
