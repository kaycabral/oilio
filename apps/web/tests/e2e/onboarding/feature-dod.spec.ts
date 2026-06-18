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
  // Regime vazio: org recém-criado, zero cadastros → Cenários 1 e 2.
  test.describe('org vazio (recém-signup)', () => {
    test.use({ orgInput: { unitCount: 0, professionalCount: 0 } })

    test('Cenário 1: app operável desde o signup, sem gate global', async ({ authedPage }) => {
      for (const route of INTERNAL_ROUTES) {
        await authedPage.goto(route)

        // Nenhuma tela de setup bloqueia o uso: sem bounce pra onboarding/login.
        await expect(authedPage).not.toHaveURL(/\/onboarding(\/|$)/)
        await expect(authedPage).not.toHaveURL(/\/login(\/|$)/)

        // A rota pedida renderizou de fato, com o shell autenticado presente.
        await expect(authedPage).toHaveURL(new RegExp(`${route}(/|\\?|$)`))
        // Agenda some pra org sem unidade de agendamento → ancora o shell
        // num item de nav agnóstico de vertical, sempre presente.
        await expect(authedPage.getByRole('link', { name: 'Vendas' }).first()).toBeVisible()
        await expect(authedPage.getByRole('link', { name: 'Agenda' })).toHaveCount(0)
      }

      // App multi-vertical: sem unidade de agendamento, `/agenda` redireciona
      // pra `/orders` (não é gate de onboarding — todas as outras rotas resolvem).
      await authedPage.goto('/agenda')
      await expect(authedPage).toHaveURL(/\/orders(\/|\?|$)/)
    })

    test('Cenário 2: empty-state leva ao cadastro real (round-trip pelo fluxo da UI)', async ({
      authedPage,
    }) => {
      authedPage.on('dialog', (d) => d.accept())
      // Stub do CEP lookup (brasilapi externo) → determinístico, sem rede; o fluxo
      // do form continua real (popula endereço + revela o campo número).
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

      // Área core vazia → empty-state acionável com CTA primário.
      await authedPage.goto('/units')
      await expect(authedPage.getByText(/nenhuma unidade/i)).toBeVisible()
      const cta = authedPage.getByRole('link', { name: 'Cadastrar unidade' })
      await expect(cta).toBeVisible()

      // CTA abre o fluxo de criação REAL (não um wizard) e cria a entidade.
      await cta.click()
      await expect(authedPage).toHaveURL(/\/units\/new$/)

      const ts = Date.now().toString()
      const name = `Unidade DoD ${ts}`
      await authedPage.locator('input[name="slug"]').fill(`un-${ts.slice(-9)}`)
      await fillStable(authedPage.locator('input[name="name"]'), name)
      await authedPage.locator('input[name="whatsapp"]').fill(`11${ts.slice(-9)}`)
      await authedPage.locator('input[name="postalCode"]').fill('01310100')
      await authedPage.locator('input[name="number"]').fill('123')
      await authedPage.getByRole('button', { name: 'Criar' }).click()

      // Ao criar, o registro aparece na listagem e o empty-state some. Escopa
      // pro item da lista (`@cbrl/design` List → role listitem): o nome também
      // aparece no unit/org switcher do header (a unidade recém-criada vira a
      // ativa), então `getByText` solto casaria 2 elementos.
      await expect(authedPage).toHaveURL(/\/units$/)
      await expect(listItem(authedPage, name)).toBeVisible({
        timeout: 5000,
      })
      await expect(authedPage.getByText(/nenhuma unidade/i)).toBeHidden()
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

// F2 / brief 0046 — Onboarding conta-first + auto-criação da matriz.
// Diferente do 0008 acima (que parte de um org já semeado), este cenário dirige
// o fluxo REAL de signup (`createOrg`) ponta a ponta e prova o invariante novo:
// o signup nunca deixa "empresa sem unidade" — a matriz nasce na mesma saga, e o
// dono cai operável sem o estado vazio de "selecione uma unidade".
test.describe('Feature 0046 — conta-first + matriz auto-criada', { tag: '@critical' }, () => {
  test('signup cria a matriz na mesma saga; app operável sem unidade vazia (AC-02/AC-03)', async ({
    context,
    page,
    baseURL,
  }) => {
    // Owner novo, perfil ainda incompleto (sem org, sem unidade) — o estado de
    // quem acabou de autenticar via OAuth.
    const owner = await seedAuthUser({ completionCompleted: false })
    await signInAndAttachSession(context, owner.email, owner.password, baseURL ?? undefined)

    // O gate de completude (#838) leva ao /onboarding/profile antes do org;
    // espelhamos o `next` que o /onboarding usaria.
    await page.goto('/onboarding/profile?next=/onboarding')
    await page.getByRole('textbox', { name: /nome/i }).fill('Dona Matriz')
    await page.getByRole('textbox', { name: /whatsapp/i }).fill('11944443333')
    await fillBirthDate(page, '15/03/1992')
    await page.getByRole('button', { name: /continuar/i }).click()

    // Cai no form de criação da empresa (conta-first: só nome + vertical, sem CNPJ).
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 10_000 })
    const orgName = `Barbearia Matriz ${Date.now()}`
    await fillStable(page.locator('input[name="name"]'), orgName)
    // Select do @cbrl/design: abrir pelo trigger e escolher a opção visível.
    await page.getByRole('combobox').click()
    await page.getByRole('option', { name: 'Barbearia' }).click()
    await page.getByRole('button', { name: 'Criar empresa' }).click()

    // createOrg redireciona pra '/' (app operável). NÃO pode parar num
    // /select-unit sem opção nem em /onboarding.
    await page.waitForURL(/\/(dashboard|orders|units|agenda)?$/, { timeout: 10_000 })
    await expect(page).not.toHaveURL(/\/onboarding(\/|$)/)
    await expect(page).not.toHaveURL(/\/select-unit(\/|$)/)

    // A matriz existe: a listagem de unidades mostra exatamente a unidade
    // (nome = nome da empresa) e o empty-state "nenhuma unidade" NÃO aparece.
    await page.goto('/units')
    await expect(page).toHaveURL(/\/units$/)
    await expect(listItem(page, orgName)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/nenhuma unidade/i)).toBeHidden()
  })
})
