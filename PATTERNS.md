# Patterns

Padrões de código canônicos do monorepo cbrl. Diferente de `CONTRIBUTING.md` (processo: PRs, commits, labels) e `TESTING.md` (filosofia de testes), este documento descreve **como código é escrito** quando o pattern não é óbvio do framework — por que essa escolha, como aplicar, o que NÃO fazer.

Quando adicionar um pattern aqui:

- O pattern foi validado em produção (não é especulação).
- Pelo menos 2 apps adotaram OU se aplica a todo app novo via template.
- Existe um anti-pattern conhecido a banir junto.

Patterns específicos de 1 só app ficam no `CLAUDE.md` daquele app, não aqui.

---

## Feature slices (functional core / imperative shell)

**Aplica a**: todo app Next.js do monorepo via template. Adoção: `scheduling/web` (fatia `agenda` migrada; demais em burndown).

**Regra**: código de feature vive em `features/<slice>/` partido em 3 anéis, dependência **só desce**:

```
app/<rota>/page.tsx  →  features/<slice>/ui  →  adapters  →  core
```

- **core/** — decisão pura: parse, regras de negócio, máquina de status, view-models. Zero React/Next/DB/I/O. Unit-testável sem banco → é onde cobertura + mutation têm dente.
- **adapters/** — casca de I/O: lê dado, emite evento, delega a decisão ao core. Testado por integration/E2E.
- **ui/** — componente humilde: consome contrato tipado, mínimo de lógica. Testado por render test + E2E.
- **app/<rota>/** — casca-fina de roteamento: chama o loader do adapter + renderiza o componente da ui.

**Vocabulário de arquivo** (o sufixo declara a camada — o lint e o AST se ancoram nele):

| marcador                    | camada      | é                                           |
| --------------------------- | ----------- | ------------------------------------------- |
| `use-*` (prefixo)           | ui/adapters | hook                                        |
| `*.repo.ts`                 | adapters    | acesso a dado de 1 aggregate                |
| `*.actions.ts`              | adapters    | server actions (`'use server'`)             |
| `*.schema.ts`               | core/shared | validação runtime (Zod)                     |
| _(sem sufixo, substantivo)_ | core        | módulo puro (a ausência já sinaliza "puro") |
| PascalCase `.tsx`           | ui          | componente                                  |

Banidos: `*.util.ts`, `*.helper.ts`, `*.service.ts`, `*.manager.ts` — substantivos vagos que viram grab-bag.

### Por quê

A fronteira não é estética: é o que torna a lógica testável sem harness e impede o I/O de vazar pra apresentação. core puro ⇒ unit cobre o caro; ui fina ⇒ E2E cobre o fluxo. E a separação **revela** onde regra está fundida com I/O (sinal pra extrair pro core).

### Enforcement

Não é convenção em prosa — é parede de lint em `@cbrl/eslint-config/configs/layering.mjs`, chaveada na pasta `features/*/<ring>/` (no-op em app sem slices):

- **pureza** (`no-restricted-imports`): `core/**` (e `domain/**`) não importa react/next/`pg`/`drizzle-orm`/`@supabase/*`/`stripe`/`@cbrl/pg`/`@cbrl/supabase`/`server-only`.
- **direção** (`boundaries/element-types`): `ui→adapters→core`, nunca o contrário.

Violar = pipeline vermelho, não code review.

### Anti-patterns

- Lógica de negócio dentro de `.tsx` ou de server action → extrair pro `core/`.
- Organizar por tipo técnico global (`/components`, `/hooks`, `/utils`) em vez de por slice.
- `core/` importando adapter/ui — vaza pureza por transitividade (a parede pega).
- Empurrar cobertura de regra pura só pro E2E quando ela deveria ser unit no `core/`.

---

## Forms + Server Actions (progressive enhancement)

**Aplica a**: todos os apps Next.js do monorepo (`cbrl.dev`, `focusely`, `scheduling/web`, `imovil`, `saas-manager`, `gabar/web`, e `templates/web`).

**Regra**: toda mutation server-side é disparada por `<form action={serverAction}>` com `<button type="submit">`. Nunca `<button onClick={async () => { await action(); router.push() }}>`.

### Por quê

1. **Funciona sem JS hidratado.** O browser submete o form nativamente assim que o HTML chega. Clicks em produção continuam funcionando enquanto o React ainda está montando. Elimina a classe de bug "click engolido por hydration race" (incidente #763 e flakes que motivaram esta doc).
2. **Acessibilidade grátis.** Submit via Enter no input, navegação por teclado, autofill nativo, anti-double-submit do form — tudo já vem do browser.
3. **Best practice oficial.** [Next.js docs sobre server actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations#forms) e [React 19 form actions](https://react.dev/reference/react-dom/components/form#using-actions) documentam isso como o caminho principal.
4. **Resilência real.** Cliente em conexão ruim com JS ainda baixando continua agendando — não só o E2E suite.

### Pattern A — mutation que redireciona em sucesso

Exemplo: "Iniciar atendimento" navega pra `/orders/{id}`.

```ts
// 'use server'
export async function startAttendanceFormAction(formData: FormData): Promise<void> {
  const id = formData.get('appointmentId')
  if (typeof id !== 'string') throw new Error('appointment not informed')
  const res = await startAttendance(id)
  if (!res.ok) throw new Error(res.error)
  redirect(`/orders/${res.comandaId}` as Route)
}
```

```tsx
// Componente client — plain <form>, useFormStatus pro pending
function StartAttendanceForm({ appointmentId }: { appointmentId: string }) {
  return (
    <form action={startAttendanceFormAction}>
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <SubmitButton>Iniciar atendimento</SubmitButton>
    </form>
  )
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {children}
    </Button>
  )
}
```

**Não envolva ações que `redirect()` em `useActionState`** — o `NEXT_REDIRECT` interno não atravessa o boundary de state limpo e aparece como "A server error occurred" no overlay. Plain `<form action>` deixa o framework processar o redirect.

### Pattern B — mutation que NÃO redireciona (revalidate-only)

Exemplo: cancel / mark no-show — atualiza estado e fica na mesma rota.

```ts
// 'use server' — wrapper que useActionState consome
export type AppointmentFormActionState = { ok: boolean; error?: string }

export async function cancelAppointmentFormAction(
  _prev: AppointmentFormActionState,
  formData: FormData,
): Promise<AppointmentFormActionState> {
  const id = formData.get('appointmentId')
  if (typeof id !== 'string') return { ok: false, error: 'invalid' }
  const res = await cancelAppointment(id) // imperativo original; chama revalidatePath() no fim
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}
```

```tsx
function CancelForm({ appointmentId, onSuccess }: Props) {
  // Constante de estado inicial definida no client component — 'use server'
  // files só exportam async functions.
  const [state, formAction, pending] = useActionState(cancelAppointmentFormAction, { ok: false })
  useEffect(() => {
    if (state.ok) onSuccess()
  }, [state.ok, onSuccess])
  return (
    <form action={formAction}>
      <input type="hidden" name="appointmentId" value={appointmentId} />
      <Button type="submit" disabled={pending}>
        Sim
      </Button>
      {state.error ? <p className="text-destructive">{state.error}</p> : null}
    </form>
  )
}
```

### Regras práticas

- **Forms não aninham.** Se um Dialog tem múltiplas ações (Save + Cancel + Mark No-Show + Start Attendance), cada uma vai em form próprio **irmão**, não dentro do form principal. Pra ligar um button que ficou fora do form ao form: `<Button type="submit" form="form-id">` (HTML standard — submete um form pelo `id` de qualquer posição do DOM).
- **Identifique entidades por hidden input** (`<input type="hidden" name="appointmentId" value={id} />`), não por bind. O `action.bind(null, id)` funciona mas confunde o leitor; o hidden input é auto-documentável e bate com o que aparece no DevTools.
- **`'use server'` files só exportam async functions.** Tipos (`export type`) viajam — type-only que some no build. Mas `export const FOO = {...}` quebra o loader com "A 'use server' file can only export async functions, found object". Defina constants no client component que consome.
- **Idempotência server-side.** Toda mutation deve ser idempotente OU validar estado antes de mutar (`existing.status === 'cancelled' → return error`). Browser pode tentar re-submeter (offline → online, F5, double-click escapando o `disabled`).
- **`revalidatePath()` ou `redirect()` server-side**, não `router.refresh()`/`router.push()` client. Mantém o caminho server-only viável (a feature funciona sem JS).
- **`useFormStatus()` pra pending UI** — vive em react-dom, lê o status do form pai. Evita prop drilling de `pending` do `useActionState`.

### Design system

Tanto o Button local de cada app (`@/components/ui/button`) quanto o `Button` do `@cbrl/design` espalham `React.ComponentProps<"button">`. Isso significa que `type="submit"`, `form="..."`, `disabled` etc. funcionam sem nada especial. `useFormStatus()` lê o form pai via React internals — qualquer componente derivado funciona.

### Anti-patterns banidos

- `<button onClick={async () => { await action(); router.push() }}>` — depende de hydration. Use form action.
- `useActionState` com action que `redirect()` em sucesso — o redirect throw não atravessa o state boundary. Use plain `<form action>` (Pattern A).
- `expect.toPass({ retries })` ou `--retries=2` no Playwright pra mascarar flake de click — flake é sintoma; conserte a fonte (geralmente é onClick async sem form action).
- `waitForLoadState('networkidle')` antes de cada click como rotina — sinal de que a interação tem hydration race. Form action elimina isso na raiz.

### Por que isto não está em CLAUDE.md

Este é um pattern de **arquitetura de código** que vale pra todo apps Next.js do monorepo. `CLAUDE.md` é instrução pra Claude (idioma, estilo de resposta, ferramentas) — não documenta padrões de produto. Se mover este pattern pra cada `CLAUDE.md` local, dois apps divergem em 6 meses.

---

## TypedRoutes + dynamic `<Link>`

**Aplica a**: todos os apps Next.js com `typedRoutes: true` no `next.config.ts`.

Quando `typedRoutes: true` está habilitado, `<Link href={...}>` exige um tipo `Route` (gerado pelo Next.js). Rotas estáticas literais (`href="/about"`) funcionam direto; rotas dinâmicas interpoladas via template string precisam de cast:

```ts
import type { Route } from 'next'

<Link href={`/users/${id}` as Route}>...</Link>

// E em redirects server-side:
redirect(`/users/${id}` as Route)

// Helpers que retornam URL:
function userPath(id: string): Route {
  return `/users/${id}` as Route
}
```

**Anti-pattern: desabilitar `typedRoutes` pra evitar o cast.** O cast custa 1 linha por uso e pega real typos (`/uesrs/${id}`). Desabilitar perde type safety em troca de zero benefício.

**Sintoma de manutenção que pegamos**: no scheduling/web o `typedRoutes` estava habilitado mas o build de produção nunca era validado (repo sem CI) — ~25 sites com `<Link href={template}>` quebravam o build silenciosamente. Detectado quando E2E mudou pra usar production build (#935).

---

<!-- Próximos patterns aqui — adicionar usando o mesmo formato:
     ## Nome do Pattern
     **Aplica a**: ...
     **Regra**: ...
     ### Por quê
     ### Exemplo
     ### Anti-patterns banidos
-->
