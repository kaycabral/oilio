import { loadTeamPage } from '@/features/team/adapters/load-team'
import { InviteDialog } from '@/features/team/ui/InviteDialog'
import { TeamList } from '@/features/team/ui/TeamList'
import { Main } from '@cbrl/design'

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>
}) {
  const {
    canManage,
    currentUserId,
    orgId,
    baseUrl,
    entries,
    displayNameByUserId,
    mobileByUserId,
    birthDateByUserId,
    operationalByUserId,
    viewFilter,
    pendingCount,
    searchQuery,
    state,
  } = await loadTeamPage(await searchParams)

  return (
    <Main width="default">
      <TeamList
        entries={entries}
        // AC-07: "Convidar" is the primary action at the top — members + pending
        // invites share one list, split by the view filter (no tabs).
        header={
          <header className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-semibold">Equipe</h1>
            {canManage ? <InviteDialog orgId={orgId} baseUrl={baseUrl} /> : null}
          </header>
        }
        currentUserId={currentUserId}
        canManage={canManage}
        viewFilter={viewFilter}
        pendingCount={pendingCount}
        searchQuery={searchQuery}
        isFiltered={state === 'filtered-empty'}
        displayNameByUserId={displayNameByUserId}
        mobileByUserId={mobileByUserId}
        birthDateByUserId={birthDateByUserId}
        operationalByUserId={operationalByUserId}
      />
    </Main>
  )
}
