# Agenda timezone — invariant

Referenciado de `apps/oilio/web/CLAUDE.md` § Agenda. Consulte ao mexer em código de agenda, comanda, ou qualquer coisa que envolva instantes de tempo.

## Princípio

**Storage sempre UTC, display sempre em tenant timezone.** Toda mutação de `Appointment.startAt`/`endAt` (e qualquer outro instante) grava ISO UTC no Firestore. Toda renderização de horário/dia converte UTC → `tenant.timezone` (IANA, ex.: `America/Sao_Paulo`).

## Como aplicar

- **Campo**: `Tenant.timezone` é obrigatório no tipo. Default `DEFAULT_TENANT_TIMEZONE` (`America/Sao_Paulo`) é gravado no `createTenant`. `getTenant()` normaliza docs antigos sem o campo pro default — a fronteira de leitura é o único lugar onde o fallback aparece.
- **Helpers (`@oilio/shared/utils/timezone`)**: `toTenantTime`, `fromTenantTime`, `getTodayInTenantTz`, `getTenantDayBoundsUtc`, `shiftDateInTenantTz`, `isValidTimezone`. Tudo zero-dep via `Intl.DateTimeFormat` — testado com cobertura de virada de dia BR e DST `America/New_York`.
- **Nunca use `getUTCHours()`/`getHours()` diretamente em código de agenda/comanda.** Sempre passe pela conversão. `new Date(iso).getHours()` usa fuso do browser do owner, não o do tenant — bug latente.
- **Query de dia**: a janela `[dayStart, dayEnd]` do Firestore vem de `getTenantDayBoundsUtc(date, tenant.timezone)` — appointment salvo às 23:30 BR (= 02:30 UTC do dia seguinte) precisa cair dentro da query do dia BR correto.

## Limitações conhecidas

- **Per-unit timezone**: fora de escopo do V0 (ver #719). Quando entrar, o invariant continua: storage UTC, display tz-aware.
- **Edição de timezone via UI**: fora de escopo do V0 (mesmo #719). Hoje só programaticamente.
