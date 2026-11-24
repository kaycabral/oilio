'use client'

import { BirthdayIndicator } from '@/components/BirthdayIndicator'
import { RowActions, type RowAction } from '@/components/RowActions'
import { IncompleteProfileBadge, StatusBadge, type StatusTone } from '@/components/StatusBadge'
import { WhatsappAction } from '@/components/WhatsappAction'
import { isOperational, roleLabel, type MembershipStatus, type OperationalStatus } from '@/domain'
import type { TeamEntry, TeamViewFilter } from '@/features/team/adapters/load-team'
import { isBirthdayToday } from '@/shared/birthday'
import { PAGINATION_LABELS_PTBR } from '@/shared/list/pagination-labels'
import { useClientPagination } from '@/shared/list/use-client-pagination'
import { useListUrlControls } from '@/shared/list/use-list-url-controls'
import { toRoute } from '@/shared/routes'
import { formatBrazilPhone } from '@cbrl/br/phone'
import { Avatar, AvatarFallback, List, type ListItemDescriptor } from '@cbrl/design'
import { MessageCircle } from 'lucide-react'
import type { ReactNode } from 'react'

const STATUS_LABEL: Record<MembershipStatus, string> = {
  active: 'Ativo',
  invited: 'Convidado',
  suspended: 'Suspenso',
  revoked: 'Revogado',
}

const STATUS_TONE: Record<MembershipStatus, StatusTone> = {
  active: 'success',
  invited: 'info',
  suspended: 'warning',
  revoked: 'danger',
}

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s@.]+/)
    .filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const second = parts[1]?.[0] ?? ''
  return (first + second).toUpperCase() || '?'
}

function memberBadges(
  status: MembershipStatus,
  showStatus: boolean,
  incompleteProfile: boolean,
): ReactNode {
  if (!showStatus && !incompleteProfile) return undefined
  return (
    <span className="flex items-center gap-1.5">
      {showStatus ? (
        <StatusBadge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</StatusBadge>
      ) : null}
      {incompleteProfile ? <IncompleteProfileBadge /> : null}
    </span>
  )
}

export function TeamList({
  entries,
  header,
  currentUserId,
  canManage,
  viewFilter,
  pendingCount,
  searchQuery,
  isFiltered,
  displayNameByUserId,
  mobileByUserId,
  birthDateByUserId,
  operationalByUserId,
}: {
  entries: TeamEntry[]
  header?: ReactNode
  currentUserId: string
  canManage: boolean
  viewFilter: TeamViewFilter
  pendingCount: number
  searchQuery: string
  isFiltered: boolean
  displayNameByUserId: Record<string, string>
  mobileByUserId: Record<string, string>
  birthDateByUserId: Record<string, string>
  operationalByUserId: Record<string, OperationalStatus>
}) {
  const { setParams } = useListUrlControls()
  const { page, pageCount, pageItems, onPageChange } = useClientPagination(entries, {
    resetKey: `${searchQuery}|${viewFilter}`,
  })

  const filteredEmptyTitle =
    viewFilter === 'pending' ? 'Nenhum convite pendente.' : 'Nenhum membro para este filtro.'

  return (
    <List
      items={pageItems}
      getKey={(entry) =>
        entry.kind === 'member' ? `member:${entry.member.id}` : `invite:${entry.invite.id}`
      }
      isFiltered={isFiltered}
      header={header}
      search={{
        value: searchQuery,
        onSearch: (value) => setParams({ q: value || null }),
        placeholder: 'Buscar por nome…',
      }}
      filters={
        canManage
          ? [
              {
                key: 'view',
                label: 'Status',
                allLabel: 'Todos',
                value: viewFilter,
                onChange: (value) => setParams({ view: value === 'all' ? null : value }),
                options: [
                  { value: 'active', label: 'Ativos' },
                  {
                    value: 'pending',
                    label: pendingCount > 0 ? `Pendentes (${pendingCount})` : 'Pendentes',
                  },
                ],
              },
            ]
          : undefined
      }
      pagination={{ page, pageCount, onPageChange, labels: PAGINATION_LABELS_PTBR }}
      empty={{ title: 'Nenhum membro.' }}
      filteredEmpty={{ title: filteredEmptyTitle }}
      renderItem={(entry): ListItemDescriptor => {
        if (entry.kind === 'invite') {
          const { invite } = entry
          return {
            icon: <MessageCircle />,
            title: formatBrazilPhone(invite.mobile),
            badge: <StatusBadge tone="info">Pendente</StatusBadge>,
            description: `${roleLabel(invite.role)} · expira em ${new Date(
              invite.expiresAt,
            ).toLocaleDateString('pt-BR')}`,
          }
        }

        const { member } = entry
        const label = displayNameByUserId[member.userId] || member.userId
        const isSelf = member.userId === currentUserId
        const isOwner = member.role === 'owner'
        const whatsapp = isSelf ? undefined : mobileByUserId[member.userId]
        const birthDate = birthDateByUserId[member.userId]
        const linkable = canManage && !isOwner
        const actions: RowAction[] = linkable
          ? [{ kind: 'link', label: 'Editar', href: toRoute(`/team/${member.userId}`) }]
          : []
        const showStatus = !isOwner && !isSelf
        const operationalStatus = operationalByUserId[member.userId]
        const incompleteProfile =
          member.role === 'member_operator' &&
          operationalStatus !== undefined &&
          !isOperational(operationalStatus)
        return {
          leading: (
            <Avatar>
              <AvatarFallback>{initials(label)}</AvatarFallback>
            </Avatar>
          ),
          title: (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{label}</span>
              {isSelf ? (
                <span className="text-muted-foreground shrink-0 text-xs font-normal">(você)</span>
              ) : null}
              {birthDate && isBirthdayToday(birthDate) ? <BirthdayIndicator /> : null}
            </span>
          ),
          badge: memberBadges(member.status, showStatus, incompleteProfile),
          description: roleLabel(member.role),
          actions: (
            <>
              {whatsapp ? <WhatsappAction phone={whatsapp} label={`WhatsApp de ${label}`} /> : null}
              <RowActions actions={actions} label={`Ações de ${label}`} />
            </>
          ),
        }
      }}
    />
  )
}
