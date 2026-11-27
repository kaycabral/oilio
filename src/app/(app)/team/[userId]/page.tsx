import { Breadcrumbs } from '@/components/breadcrumbs'
import { roleLabel, type Membership, type Role } from '@/domain'
import { BlocksSection } from '@/features/agenda/ui/BlocksSection'
import {
  loadMemberDetailPage,
  type MemberOperationEditContext,
} from '@/features/team/adapters/load-member-detail'
import { MemberDetailForm } from '@/features/team/ui/MemberDetailForm'
import { MemberStatusToggle } from '@/features/team/ui/MemberStatusToggle'
import { RemoveMemberButton } from '@/features/team/ui/RemoveMemberButton'
import { formatBrazilPhone } from '@cbrl/br/phone'
import { Main } from '@cbrl/design'

export const instant = false

const STATUS_LABELS: Record<Membership['status'], string> = {
  active: 'Ativo',
  invited: 'Convidado',
  suspended: 'Suspenso',
  revoked: 'Revogado',
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ userId: string }>
}) {
  const { userId } = await params
  const {
    member,
    displayName,
    memberEmail,
    memberWhatsapp,
    isMemberOperator,
    isReadOnly,
    canToggleStatus,
    canRemove,
    memberOperationEdit,
    memberOperationBlocks,
    memberOperationUnits,
    orgTimezone,
  } = await loadMemberDetailPage(userId)

  return (
    <Main width="narrow" className="space-y-6">
      <Breadcrumbs
        crumbs={[
          { label: 'Equipe', href: '/team' },
          { label: displayName, href: null },
        ]}
      />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{displayName}</h1>
        <dl className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <div className="flex items-center gap-1" role="group" aria-label="Email">
            <dt>Email:</dt>
            <dd>{memberEmail || '—'}</dd>
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="WhatsApp">
            <dt>WhatsApp:</dt>
            <dd>{memberWhatsapp ? formatBrazilPhone(memberWhatsapp) : '—'}</dd>
          </div>
        </dl>
      </header>

      {isReadOnly ? (
        <section className="border-border flex flex-wrap gap-x-8 gap-y-2 rounded-md border p-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">Papel</span>
            <span className="text-sm" role="group" aria-label="Papel">
              {roleLabel(member.role)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">Status</span>
            <span className="text-sm" role="group" aria-label="Status">
              {STATUS_LABELS[member.status]}
            </span>
          </div>
        </section>
      ) : null}

      {renderEditableSurface({
        isReadOnly,
        isMemberOperator,
        memberOperationEdit,
        targetUserId: member.userId,
        currentRole: member.role,
        statusLabel: STATUS_LABELS[member.status],
      })}

      {isMemberOperator && memberOperationEdit && memberOperationUnits.length > 0 ? (
        <BlocksSection
          owner={{
            scope: 'member_operator',
            memberOperationId: memberOperationEdit.memberOperation.id,
            units: memberOperationUnits,
          }}
          blocks={memberOperationBlocks}
          orgTimezone={orgTimezone}
          canManage={!isReadOnly}
          title="Bloqueios do profissional"
          description="Ausências recorrentes (folga) ou pontuais deste profissional. Bloqueiam só a coluna dele na agenda."
        />
      ) : null}

      {canToggleStatus && (member.status === 'active' || member.status === 'suspended') ? (
        <section className="border-border rounded-md border p-4">
          <MemberStatusToggle targetUserId={member.userId} status={member.status} />
        </section>
      ) : null}

      {canRemove ? (
        <section className="border-destructive/40 rounded-md border p-4">
          <RemoveMemberButton targetUserId={member.userId} />
        </section>
      ) : null}
    </Main>
  )
}

const NOT_MATERIALIZED = (
  <p className="text-muted-foreground text-sm">
    Este membro é profissional, mas a projeção operacional ainda não foi materializada.
  </p>
)

function renderEditableSurface({
  isReadOnly,
  isMemberOperator,
  memberOperationEdit,
  targetUserId,
  currentRole,
  statusLabel,
}: {
  isReadOnly: boolean
  isMemberOperator: boolean
  memberOperationEdit: MemberOperationEditContext | null
  targetUserId: string
  currentRole: Role
  statusLabel: string
}) {
  if (isReadOnly) {
    return isMemberOperator && !memberOperationEdit ? NOT_MATERIALIZED : null
  }
  if (isMemberOperator && !memberOperationEdit) {
    return (
      <>
        {NOT_MATERIALIZED}
        <MemberDetailForm
          targetUserId={targetUserId}
          currentRole={currentRole}
          statusLabel={statusLabel}
          memberOperation={null}
          units={[]}
        />
      </>
    )
  }
  return (
    <MemberDetailForm
      targetUserId={targetUserId}
      currentRole={currentRole}
      statusLabel={statusLabel}
      memberOperation={memberOperationEdit?.memberOperation ?? null}
      units={memberOperationEdit?.units ?? []}
      services={memberOperationEdit?.services ?? []}
    />
  )
}
