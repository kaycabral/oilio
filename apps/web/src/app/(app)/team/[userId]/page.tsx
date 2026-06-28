import { Breadcrumbs } from '@/components/breadcrumbs'
import { formatBrazilPhone, type Membership, type Role } from '@/domain'
import { BlocksSection } from '@/features/agenda/ui/BlocksSection'
import {
  loadMemberDetailPage,
  type MemberOperationEditContext,
} from '@/features/team/adapters/load-member-detail'
import { MemberDetailForm } from '@/features/team/ui/MemberDetailForm'
import { MemberStatusToggle } from '@/features/team/ui/MemberStatusToggle'
import { RemoveMemberButton } from '@/features/team/ui/RemoveMemberButton'
import { Main } from '@cbrl/design'

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Dono',
  manager: 'Gerente',
  member_operator: 'Profissional',
  receptionist: 'Recepção',
}

const STATUS_LABELS: Record<Membership['status'], string> = {
  active: 'Ativo',
  invited: 'Convidado',
  suspended: 'Suspenso',
  revoked: 'Revogado',
}

// Member detail (brief 0037 #1085/#1086 + refino review 2026-06-02): the single
// surface to view/edit a person. Keyed by the membership's `userId`. Personal
// identity (name/whatsapp/email) is always read-only at the top, sourced from
// the global `User` (brief 0028 #1046) — never repeated in the editable form.
//
// For an authorized user (owner/manager) editing a NON-owner member, there is
// no "Editar" gate and no separate "Trocar papel" button: a single editable
// `MemberDetailForm` shows the role select (top) + operational fields (when
// memberOperation), persisted with ONE Salvar that runs the role lifecycle (#1086)
// and the operational update (#1085) together.
//
// The owner is NOT editable (refino): no role select, no Salvar — the detail is
// read-only. The viewer's own membership is likewise read-only (can't change
// your own role).
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
    professionalUnits,
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

      {/* Read-only members (owner / the viewer's own membership): role + status,
          no editable surface. Editable members get the role select + status
          inside the form (the select sits where this "Papel" box would be). */}
      {isReadOnly ? (
        <section className="border-border flex flex-wrap gap-x-8 gap-y-2 rounded-md border p-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-muted-foreground text-xs">Papel</span>
            <span className="text-sm" role="group" aria-label="Papel">
              {ROLE_LABELS[member.role]}
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

      {/* Per-memberOperation agenda blocks (brief 0036 #1082) — the memberOperation's
          own blocks live here, next to the operational config. Needs a
          materialized memberOperation with at least one unit to attach the block
          to. */}
      {isMemberOperator && memberOperationEdit && professionalUnits.length > 0 ? (
        <BlocksSection
          owner={{
            scope: 'member_operator',
            memberOperationId: memberOperationEdit.memberOperation.id,
            units: professionalUnits,
          }}
          blocks={memberOperationBlocks}
          orgTimezone={orgTimezone}
          canManage={!isReadOnly}
          title="Bloqueios do profissional"
          description="Ausências recorrentes (folga) ou pontuais deste profissional. Bloqueiam só a coluna dele na agenda."
        />
      ) : null}

      {/* Member-level deactivate/reactivate (AC-10) — distinct from the role
          select above and from the memberOperation approval status. Suspends
          effective access; reversible. */}
      {canToggleStatus && (member.status === 'active' || member.status === 'suspended') ? (
        <section className="border-border rounded-md border p-4">
          <MemberStatusToggle targetUserId={member.userId} status={member.status} />
        </section>
      ) : null}

      {/* Offboarding (brief 0041 #1103, AC-01/AC-10) — terminal "remover do
          time" severance, distinct from the reversible deactivate above. */}
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

// The editable surface below the read-only identity/status (refino). Owner / the
// viewer's own membership are read-only (no role select, no Salvar). Everyone
// else gets the single `MemberDetailForm` (role select + operational fields when
// memberOperation + one Salvar).
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
    // No edit affordance. A memberOperation whose projection isn't materialized
    // still surfaces that operational state.
    return isMemberOperator && !memberOperationEdit ? NOT_MATERIALIZED : null
  }
  if (isMemberOperator && !memberOperationEdit) {
    // Editable (role select + Salvar) but no operational fields to show yet.
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
