// Feature-level E2E — brief 0008 § Definition of Done (parent #985).
//
// 1 test por cenário do DoD, validando o contrato da feature "Onboarding sem
// fricção (empty-state just-in-time)" como gate do parent — escopo cross-component
// do parent, não das sub-issues isoladas (#986/#987/#988/#1027/#1028):
// - Cenário 1: App operável desde o signup [critical]
// - Cenário 2: Empty-state leva ao cadastro real [critical]
// - Cenário 3: Publicar self-booking exige o mínimo (e só isso bloqueia) [critical]
// - Cenário 4: Publicação ao completar o mínimo [critical]
//
// Cada cenário exige um regime de seed distinto (vazio / degenerado / mínimo
// completo); como `test.use({ orgInput })` é por-describe, agrupamos os
// cenários em describes aninhados por regime.
//
// Roda contra emulator + build de produção (modo canônico do playwright.config).

import { expect, test } from '../fixtures'
import { fillBirthDate } from '../helpers/forms'
import { checkStable, fillStable } from '../helpers/hydration'
import { listItem } from '../helpers/list'
import { chooseOption } from '../helpers/select'
import {
  linkProfessionalToServices,
  seedAuthUser,
  seedService,
  signInAndAttachSession,
} from '../helpers/session'
import { PublicBookingPage, orgSlug } from '../pages'

// Toda rota interna autenticada — o org vazio tem que alcançar todas sem
// nenhum gate de onboarding bouncear (o wizard foi deletado no #1028).
// `/professionals` removida (brief 0037 #1085) — gestão de gente vive em `/team`.
// `/agenda` está fora: o app é multi-vertical e a Agenda é escondida/
// redirecionada quando nenhuma unidade usa o modo de horários por agendamento.
// O org vazio (sem unidade) não tem unidade de agendamento, então `/agenda`
// redireciona pra `/orders` e o nav esconde o item — asserido à parte no Cenário 1.
const INTERNAL_ROUTES = [
  '/dashboard',
  '/units',
  '/catalog',
  '/team',
  '/customers',
  '/plans',
] as const

test.describe('Feature 0008 — Definition of Done (onboarding just-in-time)', () => {
  // Regime mínimo: org com a 1ª unidade já criada (o piso que o fluxo guiado da
  // v2 exige) mas SEM serviço/profissional → ainda sem gate de setup → Cenários 1
  // e 2. Um dono com ZERO unidade não fica aqui: o layout (app) o leva ao
  // empty-state guiado `/onboarding/first-unit` (asserido em Feature 0046).
  test.describe('org mínimo (1ª unidade criada, sem mais cadastros)', () => {
    test.use({ orgInput: { unitCount: 1, professionalCount: 0 } })

    test('Cenário 1: app operável sem gate global de setup', async ({ authedPage }) => {
      for (const route of INTERNAL_ROUTES) {
        await authedPage.goto(route)

        // Nenhuma tela de setup bloqueia o uso: sem bounce pra onboarding/login.
        await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
        await expect(authedPage).not.toHaveURL(/\/login(\/|$)/)

        // A rota pedida renderizou de fato, com o shell autenticado presente.
        await expect(authedPage).toHaveURL(new RegExp(`${route}(/|\\?|$)`))
        await expect(authedPage.getByRole('link', { name: 'Vendas' }).first()).toBeVisible()
      }

      // Com uma unidade em modo agendamento, a Agenda fica visível e resolve
      // (não é gate de onboarding) — sem nenhum serviço/profissional configurado.
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/agenda(\/|\?|$)/)
    })

    test('Cenário 2: empty-state leva ao cadastro real (round-trip pelo fluxo da UI)', async ({
      authedPage,
    }) => {
      // Área core vazia (Clientes — nenhum cliente semeado) → empty-state
      // acionável com CTA primário que abre o fluxo de criação REAL.
      await authedPage.goto('/customers')
      await expect(authedPage.getByText(/nenhum cliente/i)).toBeVisible()
      const cta = authedPage.getByRole('link', { name: 'Cadastrar cliente' })
      await expect(cta).toBeVisible()

      // CTA abre o fluxo de criação REAL (não um wizard).
      await cta.click()
      await expect(authedPage).toHaveURL(/\/customers\/new$/)

      const ts = Date.now().toString()
      const name = `Cliente DoD ${ts}`
      await fillStable(authedPage.locator('input[name="name"]'), name)
      await authedPage.locator('input[name="whatsapp"]').fill(`11${ts.slice(-9)}`)
      await authedPage.getByRole('button', { name: 'Criar' }).click()

      // Ao criar, o registro aparece na listagem e o empty-state some.
      await expect(authedPage).toHaveURL(/\/customers$/)
      await expect(listItem(authedPage, name)).toBeVisible({
        timeout: 5000,
      })
      await expect(authedPage.getByText(/nenhum cliente/i)).toBeHidden()
    })
  })

  // Regime degenerado: unidade em modo agendamento sem horário/endereço, sem
  // serviço público, sem profissional → não publicável (não bookable) → Cenário 3.
  //
  // Modelo novo (spike, inferred availability): não há botão "Publicar". Uma
  // unidade fica pública sozinha ao virar bookable (modo agendamento + horário).
  // O card por-unidade (UnitPublishCard) é só FEEDBACK do que falta.
  test.describe('org incompleto (não publicável)', () => {
    test.use({
      orgInput: { hasBusinessHours: false, professionalCount: 0 },
    })

    test('Cenário 3: unidade fica fora do público até atender o mínimo (sem horário → 404)', async ({
      org,
      authedPage,
      page,
    }) => {
      await authedPage.goto(`/units/${org.unitIds[0]!}`)

      // O card por-unidade renderiza e lista o que falta (agenda ainda não no ar).
      await expect(authedPage.getByText('Agendamento público desta unidade')).toBeVisible()
      await expect(authedPage.getByText(/fica visível automaticamente/i)).toBeVisible()
      const checklist = authedPage.locator('[data-slot="unit-agenda-readiness"]')
      await expect(
        checklist.getByText('Endereço e horário de funcionamento preenchidos'),
      ).toBeVisible()
      await expect(checklist.getByText('1 serviço público oferecido nesta unidade')).toBeVisible()

      // O resto do app segue acessível (sem gate global); a página pública, por
      // sua vez, não resolve enquanto a unidade não for bookable.
      await authedPage.goto('/catalog')
      await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
      const res = await page.goto(`/${orgSlug(org.orgId)}`)
      expect(res?.status()).toBe(404)
    })
  })

  // Regime a um passo do público: unidade sem horário, com profissional aprovado
  // e serviço público → completar o horário a torna bookable → Cenário 4.
  test.describe('org pronto pra publicar', () => {
    test.use({
      orgInput: {
        hasBusinessHours: false,
        unitCount: 1,
        professionalCount: 1,
        professionalOperationalStatus: 'operational',
      },
    })

    test('Cenário 4: completar o mínimo da unidade → página pública no ar', async ({
      org,
      authedPage,
      page,
    }) => {
      const slug = orgSlug(org.orgId)
      const unitId = org.unitIds[0]!

      // Serviço público + profissional aprovado: ao virar bookable, há catálogo.
      const serviceId = seedService(org.orgId, {
        name: 'Corte DoD',
        priceCents: 5000,
        publicVisible: true,
        unitIds: [unitId],
      })
      linkProfessionalToServices(org.orgId, org.professionalIds[0]!, [serviceId])

      // Antes: unidade sem horário não é bookable → página pública não resolve.
      const before = await page.goto(`/${slug}/unidade-1`)
      expect(before?.status()).toBe(404)

      // Stub do CEP lookup (brasilapi externo) → determinístico, sem rede.
      await authedPage.route('**/api/postal-code/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            postalCode: '01310100',
            state: 'SP',
            city: 'São Paulo',
            neighborhood: 'Bela Vista',
            street: 'Avenida Paulista',
          }),
        }),
      )

      // Completa o mínimo pelo fluxo REAL: endereço + um dia de horário no modo
      // agendamento (default), e salva. Não há botão de publicar.
      await authedPage.goto(`/units/${unitId}`)
      await fillStable(authedPage.locator('input[name="postalCode"]'), '01310100')
      await authedPage.locator('input[name="number"]').fill('123')
      await checkStable(authedPage.locator('#bh_monday'))
      await authedPage.getByRole('button', { name: 'Salvar' }).click()

      // Card por-unidade vira o estado "No ar".
      await authedPage.goto(`/units/${unitId}`)
      await expect(authedPage.getByText(/no ar — clientes já podem agendar/i)).toBeVisible({
        timeout: 5000,
      })

      // Depois: a página pública entra no ar e lista o serviço pelo slug.
      const booking = new PublicBookingPage(page, slug)
      const after = await page.goto(`/${slug}/unidade-1`)
      expect(after?.status()).toBe(200)
      await expect(booking.serviceCard('Corte DoD')).toBeVisible()
    })
  })
})

// F2 / brief 0046 (PRD Identidade v2) — Onboarding ultra-light, SEM auto-matriz.
// Diferente do 0008 acima (que parte de um org já semeado), este cenário dirige
// o fluxo REAL de signup (`createOrg`) ponta a ponta e prova o invariante novo:
// o signup cria o Negócio (a pasta) SEM unidade. Um dono com 0 unidades é então
// levado AUTOMATICAMENTE pro empty-state guiado `/onboarding/first-unit` (heading
// "Crie sua primeira unidade"), onde confirma o mínimo (nome já prefilled =
// nome do Negócio, endereço + WhatsApp; horário Seg–Sáb 09–18 prefilled) e o app
// passa a operar. A auto-matriz da v1 foi removida.
test.describe(
  'Feature 0046 — onboarding ultra-light (sem auto-matriz)',
  { tag: '@critical' },
  () => {
    test('signup cria o Negócio sem unidade; dono é guiado à 1ª unidade (AC-02/AC-03)', async ({
      context,
      page,
      baseURL,
    }) => {
      // Owner novo, perfil ainda incompleto (sem org, sem unidade) — o estado de
      // quem acabou de autenticar via OAuth.
      const owner = await seedAuthUser({ completionCompleted: false })
      await signInAndAttachSession(context, owner.email, owner.password, baseURL ?? undefined)

      // Stub do CEP lookup (brasilapi externo) → determinístico, sem rede; o fluxo
      // do form da 1ª unidade continua real (popula endereço + revela o número).
      await page.route('**/api/postal-code/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            postalCode: '01310100',
            state: 'SP',
            city: 'São Paulo',
            neighborhood: 'Bela Vista',
            street: 'Avenida Paulista',
          }),
        }),
      )

      // O gate de completude (#838) leva ao /onboarding/profile antes do org;
      // espelhamos o `next` que o /onboarding usaria.
      await page.goto('/onboarding/profile?next=/onboarding')
      await page.getByRole('textbox', { name: /nome/i }).fill('Dona Negócio')
      await page.getByRole('textbox', { name: /whatsapp/i }).fill('11944443333')
      await fillBirthDate(page, '15/03/1992')
      await page.getByRole('button', { name: /continuar/i }).click()

      // Cai no form de criação do Negócio (ultra-light: só nome + segmento, sem CNPJ).
      await expect(page).toHaveURL(/\/onboarding$/, { timeout: 10_000 })
      const orgName = `Barbearia Negócio ${Date.now()}`
      // Segmento primeiro (Select Radix, via helper canônico), depois o nome: o
      // `onInput` do nome — evento confiável — dispara o refresh do `useFormValidity`
      // lendo o valor do Select já setado, habilitando o submit sem depender da
      // propagação do change do portal Radix sob hydration.
      await chooseOption(page, 'Segmento', 'Barbearia')
      await fillStable(page.locator('input[name="name"]'), orgName)
      await expect(page.getByRole('button', { name: 'Criar negócio' })).toBeEnabled()
      await page.getByRole('button', { name: 'Criar negócio' }).click()

      // createOrg cria SÓ o Negócio (sem unidade) e redireciona pra '/'. O layout
      // (app) detecta 0 unidades + dono cross-unit e leva ao empty-state guiado
      // da 1ª unidade — NÃO pode haver auto-matriz nem parar na criação do Negócio.
      await page.waitForURL(/\/onboarding\/first-unit$/, { timeout: 10_000 })
      await expect(page.getByRole('heading', { name: 'Crie sua primeira unidade' })).toBeVisible()

      // O form da 1ª unidade vem com o nome PREFILLED = nome do Negócio; o dono só
      // confirma endereço + WhatsApp (horário Seg–Sáb 09–18 já prefilled).
      await expect(page.locator('input[name="name"]')).toHaveValue(orgName)
      await page.locator('input[name="whatsapp"]').fill('11944443333')
      await page.locator('input[name="postalCode"]').fill('01310100')
      await page.locator('input[name="number"]').fill('123')
      await page.getByRole('button', { name: 'Criar' }).click()

      // Com a 1ª unidade criada, o app passa a operar: o layout não bounceia mais
      // pro first-unit; a unidade aparece na listagem com o nome do Negócio.
      await page.waitForURL(/\/(dashboard|orders|units|agenda|select-unit)(\/|\?|$)/, {
        timeout: 10_000,
      })
      await expect(page).not.toHaveURL(/\/onboarding(\/|$)/)
      await page.goto('/units')
      await expect(page).toHaveURL(/\/units$/)
      await expect(listItem(page, orgName)).toBeVisible({ timeout: 5000 })
    })
  },
)
