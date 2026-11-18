import { Input } from '@oilio/design'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { useFormValidity } from './use-form-validity'

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

    act(() => {
      cosmetic.setAttribute('aria-expanded', 'true')
      cosmetic.setAttribute('class', 'searching')
      cosmetic.setAttribute('aria-busy', 'true')
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    expect(seen.length).toBe(before)
  })

  it('reports the label of the first invalid field, null once valid (#1296)', async () => {
    const seen: (string | null)[] = []
    render(<LabeledHarness onLabel={(l) => seen.push(l)} />)

    await waitFor(() => expect(seen.at(-1)).toBe('Número'))

    const number = screen.getByLabelText('Número')
    if (!(number instanceof HTMLInputElement)) throw new Error('expected input')
    act(() => {
      number.value = 'wired'
      number.dispatchEvent(new Event('input', { bubbles: true }))
      number.setAttribute('value', 'wired')
    })
    await waitFor(() => expect(seen.at(-1)).toBeNull())
  })
})
