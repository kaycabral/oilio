// Typed FormData read boundary (typed-linting burndown, Wave 2b).
//
// `FormData.get(key)` returns `FormDataEntryValue | null` (`string | File |
// null`), so reads used to coerce it with `String(...) ?? ''` — which trips
// `no-base-to-string` (coercing a value that could be a `File`, stringifying
// to "[object File]"). These helpers centralize the extraction: a text-field
// read is a string or it is absent.

/** Read a text field as a string. `File`/absent → ''. */
export function formString(form: FormData, key: string): string {
  const value = form.get(key)
  return typeof value === 'string' ? value : ''
}
