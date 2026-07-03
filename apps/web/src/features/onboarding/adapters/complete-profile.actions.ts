'use server'

import { parseProfileForm } from '@/features/onboarding/core/profile-form'
import { resolveSignupOrgContext } from '@/features/onboarding/core/signup-context'
import { isUniqueViolation, USERS_MOBILE_UNIQUE } from '@/shared/db/pg/unique-violation'
import { getUserById, patchUser } from '@/shared/db/pg/users-store'
import { getSessionUser } from '@/shared/firebase/admin'
import { formString } from '@/shared/form-data'
import { logger } from '@/shared/lib/logger'
import { withActionContext } from '@/shared/lib/request-context'
import { ensureSelfSignupCustomer } from '@/shared/org/customer-upsert'
import { getOrgBySlug } from '@/shared/org/org'
import { emitClientFunnelEvent } from '@/shared/product'
import { toRoute } from '@/shared/routes'
import type { Route } from 'next'
import { redirect } from 'next/navigation'

export type CompleteProfileResult = { ok: true } | { ok: false; error: string }

// Server action backing the post-OAuth completion step (#838). Captures
// what the OAuth identity doesn't give us (mobile, birthDate) plus a
// name override. Idempotent: if the user already finished completion, the
// action refuses to overwrite — that gate also lives in the page render
// path, but server actions must defend themselves (don't trust the UI).
export const completeProfile = withActionContext(
  async (formData: FormData): Promise<CompleteProfileResult> => {
    const session = await getSessionUser()
    if (!session) return { ok: false, error: 'Sessão expirada' }

    const user = await getUserById(session.uid)
    if (!user) return { ok: false, error: 'Usuário não encontrado' }
    if (user.completionCompleted) {
      // Idempotent — already done. Don't error; just fall through to the
      // redirect so a stale tab doesn't trap the user.
      redirect(safeNext(formData.get('next')))
    }

    const parsed = parseProfileForm(formData)
    if (typeof parsed === 'string') return { ok: false, error: parsed }
    const { name, mobile, birthDate } = parsed

    const now = new Date().toISOString()

    // No stub dedupe (brief 0077, Grupo C — #1276). The recepcionista no longer
    // creates stub Users by typing PII (the convite-contextual flow #1279 hands
    // out a link instead), so there is no stub to fold in. Folding-by-mobile was
    // the SOURCE of the wrong-number breach the brief kills: a mistyped number on a
    // stub could silently capture a real login. Each login is its own user — no
    // merge. (Removed `findClaimableStubByWhatsapp` + `mergeStubUserIntoClaimer`.)

    try {
      await patchUser(
        session.uid,
        {
          display_name: name,
          mobile,
          birth_date: birthDate,
          completion_completed: true,
        },
        now,
      )
    } catch (err) {
      // The mobile number is globally unique (one owner per number). If this
      // number already backs another account, the DB refuses the write — surface
      // a handled business error instead of a raw 500. No OTP yet (#1276): we
      // can't verify ownership, so we ask the person to use their own number /
      // get in touch.
      if (isUniqueViolation(err, USERS_MOBILE_UNIQUE)) {
        return {
          ok: false,
          error:
            'Esse número de WhatsApp já está em uso por outra conta. Use o seu próprio número ou fale com o estabelecimento.',
        }
      }
      throw err
    }

    // No approval event to emit (#1226 AC-02): `operationalStatus` is derived on
    // read from real facts. Setting `User.mobile` above can complete a
    // memberOperation's profile, but readiness is recomputed on the next enriched
    // read — there is nothing to materialize there.

    // Materialize the Customer at completion (brief 0077 Grupo E / Cenário 3 —
    // #1278). The visitor becomes a Customer of the establishment the moment they
    // finish their profile, even before booking — satisfying intent=signup. This
    // revises [[0001]]'s deferred materialization (which only created on the 1st
    // booking). Best-effort + idempotent: a missing/unpublished org or a returning
    // customer never blocks completion. The funnel touch is PII-zero throughout.
    await materializeSelfSignupCustomer(formData, session.uid)

    redirect(safeNext(formData.get('next')))
  },
)

// Resolve the establishment from the forwarded `context` query string and create
// (idempotently) the Customer shadow + emit the funnel events. Swallows its own
// failures — completion already succeeded and must not be rolled back by an
// optional org link or a telemetry write.
async function materializeSelfSignupCustomer(formData: FormData, uid: string): Promise<void> {
  const context = formString(formData, 'context').trim()
  if (context.length === 0) return
  // `context` is a query string (`from={slug}&cbrl_*`); resolve via the same
  // pure helper the page uses by presenting it as a relative path.
  const ctx = resolveSignupOrgContext(`/?${context}`)
  if (!ctx) return

  try {
    const org = await getOrgBySlug(ctx.orgSlug)
    if (!org) return
    const attribution = ctx.attribution
    const { customerId } = await ensureSelfSignupCustomer(org.id, uid, attribution)

    // Funnel: signed-in (came through an invite) + profile-completed (AC-12).
    // PII-zero — only ids + the field NAMES filled, never their values.
    await emitClientFunnelEvent({
      event: 'client_signed_in',
      orgId: org.id,
      fromInvite: attribution.actorId !== null,
    })
    await emitClientFunnelEvent({
      event: 'client_profile_completed',
      orgId: org.id,
      customerId,
      fieldsFilled: ['name', 'mobile', 'birthDate'],
    })
  } catch (err) {
    logger.error('self-signup customer materialization failed', { scope: 'completeProfile', err })
  }
}

// Only accept same-origin paths so a tampered `next=` can't bounce the
// user off the app. Reject anything that isn't a leading-slash path.
function safeNext(raw: FormDataEntryValue | null): Route {
  if (typeof raw !== 'string') return '/dashboard'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
  return toRoute(raw)
}
