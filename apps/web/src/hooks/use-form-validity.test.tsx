import { Input } from '@cbrl/design'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { useFormValidity } from './use-form-validity'

// A minimal form whose validity is driven by one required text input, plus a
// sibling node the test mutates with COSMETIC attributes (mirroring a combobox
// toggling `aria-expanded`/`class` on a late debounced render). `onValidity`
// surfaces every `isValid` value so the test can assert what recomputed and what
// did not. The cosmetic node is a `role="status"` div (a spinner region) — no
// `data-testid`, queried by accessible role.
function Harness({ onValidity }: { onValidity: (v: boolean) => void }) {
  const { formRef, isValid } = useFormValidity()
  useEffect(() => {
    onValidity(isValid)
  }, [isValid, onValidity])
  return (
    <form ref={formRef} aria-label="harness">
      <Input name="name" required defaultValue="" aria-label="name" />
      <div role="status" aria-label="cosmetic" className="idle" />
    </form>
  )
}

// A two-field form with associated <label>s, so the test can assert that
// `firstInvalidLabel` reports the human label of the FIRST invalid field in DOM
// order (#1296 — a disabled submit must name the pending field).
function LabeledHarness({ onLabel }: { onLabel: (label: string | null) => void }) {
  const { formRef, firstInvalidLabel } = useFormValidity()
  useEffect(() => {
    onLabel(firstInvalidLabel)
  }, [firstInvalidLabel, onLabel])
  return (
    <form ref={formRef} aria-label="labeled">
      <label htmlFor="f-name">Nome</label>
      <input id="f-name" name="name" required defaultValue="ok" />
      <label htmlFor="f-number">Número</label>
      <input id="f-number" name="number" required defaultValue="" />
    </form>
  )
}

describe('useFormValidity', () => {
  it('starts invalid when a required field is empty', async () => {
    const seen: boolean[] = []
    render(<Harness onValidity={(v) => seen.push(v)} />)
    await waitFor(() => expect(seen.at(-1)).toBe(false))
  })

  it('recomputes validity when a CONSTRAINT attribute mutates (required toggled off)', async () => {
    const seen: boolean[] = []
    render(<Harness onValidity={(v) => seen.push(v)} />)
    const input = screen.getByLabelText('name')

    // Empty + required ⇒ invalid. Dropping `required` makes the form valid; the
    // observer must catch this attribute mutation and flip isValid to true.
    act(() => {
      input.removeAttribute('required')
    })
    await waitFor(() => expect(seen.at(-1)).toBe(true))
  })

  it('does NOT recompute validity on a COSMETIC attribute mutation (aria-expanded / class)', async () => {
    const seen: boolean[] = []
    render(<Harness onValidity={(v) => seen.push(v)} />)
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))
    const before = seen.length
    const cosmetic = screen.getByRole('status', { name: 'cosmetic' })

    // Toggle ONLY cosmetic attributes — exactly what a combobox does when its
    // debounced search resolves (spinner class, aria-expanded). With the observer
    // scoped to constraint attributes, none of this re-runs checkValidity, so no
    // new isValid value is emitted. This is the regression guard: an over-broad
    // observer would recompute the submit gate here and could flicker it mid-submit.
    act(() => {
      cosmetic.setAttribute('aria-expanded', 'true')
      cosmetic.setAttribute('class', 'searching')
      cosmetic.setAttribute('aria-busy', 'true')
    })
    // Give any (unwanted) observer callback a chance to fire before asserting none did.
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    expect(seen.length).toBe(before)
  })

  it('reports the label of the first invalid field, null once valid (#1296)', async () => {
    const seen: (string | null)[] = []
    render(<LabeledHarness onLabel={(l) => seen.push(l)} />)

    // `Nome` is pre-filled, `Número` is empty+required ⇒ the first (and only)
    // invalid field is Número, reported by its associated <label> text.
    await waitFor(() => expect(seen.at(-1)).toBe('Número'))

    const number = screen.getByLabelText('Número')
    if (!(number instanceof HTMLInputElement)) throw new Error('expected input')
    act(() => {
      // Fill it → form becomes valid → no pending field to name.
      number.value = 'wired'
      number.dispatchEvent(new Event('input', { bubbles: true }))
      number.setAttribute('value', 'wired')
    })
    await waitFor(() => expect(seen.at(-1)).toBeNull())
  })
})
