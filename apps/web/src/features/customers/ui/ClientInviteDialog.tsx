'use client'

import { isUnitPubliclyLive } from '@/domain'
import { useOrg } from '@/shared/org/org-context'
import { resolveBaseUrlClient } from '@/shared/site-url-client'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@oilio/design'
import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { ClientInviteForm } from './ClientInviteForm'

export function ClientInviteDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const { org, user, units, activeUnitId } = useOrg()

  const activeUnit = units.find((u) => u.id === activeUnitId) ?? null
  const canInvite = activeUnit !== null && isUnitPubliclyLive(activeUnit)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <UserPlus className="h-4 w-4" />
            Convidar cliente
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar cliente</DialogTitle>
          <DialogDescription>
            {canInvite
              ? `O convite é para a unidade ${activeUnit.name}. Informe o WhatsApp do cliente — ele faz o próprio cadastro pelo link, você não digita os dados dele.`
              : 'Para convidar clientes, ative o agendamento público desta unidade.'}
          </DialogDescription>
        </DialogHeader>
        {canInvite ? (
          <ClientInviteForm
            unitSlug={activeUnit.slug}
            baseUrl={resolveBaseUrlClient()}
            orgSlug={org.slug}
            orgName={org.name}
            actorId={user.uid}
          />
        ) : (
          <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
            A unidade {activeUnit?.name ?? 'ativa'} ainda não está com agendamento público ativo.
            Publique o agendamento dela pra poder convidar clientes — ou troque de unidade no
            seletor do topo.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
