import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_TOP_LEVEL_SEGMENTS,
  isPublicPageNotFound,
  type PublicOrgVisibility,
  publicPageFromPath,
} from './public-page-gate'

const APP_DIR = path.resolve(import.meta.dirname, '../../../app')
const NOT_ROUTES = /^(layout|page|error|global-error|not-found|loading|template|default)\.tsx?$/

function topLevelSegments(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      if (/^\(.+\)$/.test(entry.name)) return topLevelSegments(path.join(dir, entry.name))
      if (entry.name.startsWith('[') || entry.name.startsWith('_')) return []
      return [entry.name]
    }
    if (NOT_ROUTES.test(entry.name) || entry.name.includes('.test.')) return []
    const route = /^(opengraph-image|twitter-image|icon|apple-icon|sitemap|robots)\.tsx?$/.exec(
      entry.name,
    )
    return route?.[1] ? [route[1]] : []
  })
}

describe('APP_TOP_LEVEL_SEGMENTS', () => {
  it('lists every first segment that src/app serves besides [slug]', () => {
    const expected = [...topLevelSegments(APP_DIR), 'monitoring-tunnel'].sort()
    expect([...APP_TOP_LEVEL_SEGMENTS].sort()).toEqual(expected)
  })
})

describe('publicPageFromPath', () => {
  it('reads the org and unit of a landing page', () => {
    expect(publicPageFromPath('/barbearia')).toEqual({ slug: 'barbearia', unitSlug: null })
    expect(publicPageFromPath('/barbearia/')).toEqual({ slug: 'barbearia', unitSlug: null })
    expect(publicPageFromPath('/barbearia/centro')).toEqual({
      slug: 'barbearia',
      unitSlug: 'centro',
    })
  })

  it('ignores app routes, reserved or invalid slugs and deeper flows', () => {
    expect(publicPageFromPath('/')).toBeNull()
    expect(publicPageFromPath('/agenda')).toBeNull()
    expect(publicPageFromPath('/copilot')).toBeNull()
    expect(publicPageFromPath('/opengraph-image')).toBeNull()
    expect(publicPageFromPath('/plans')).toBeNull()
    expect(publicPageFromPath('/Barbearia')).toBeNull()
    expect(publicPageFromPath('/manifest.webmanifest')).toBeNull()
    expect(publicPageFromPath('/barbearia/new')).toBeNull()
    expect(publicPageFromPath('/barbearia/centro/book')).toBeNull()
    expect(publicPageFromPath('/%E0%A4%A')).toBeNull()
    expect(publicPageFromPath('/barbearia/%E0%A4%A')).toBeNull()
  })
})

const org = (units: { slug: string; live: boolean }[]) => () =>
  Promise.resolve<PublicOrgVisibility>({ units })

describe('isPublicPageNotFound', () => {
  it('is 404 for an unknown org', async () => {
    const lookup = () => Promise.resolve<PublicOrgVisibility>(null)
    expect(await isPublicPageNotFound({ slug: 'x', unitSlug: null }, { lookup })).toBe(true)
  })

  it('needs one live unit for the org page', async () => {
    const target = { slug: 'x', unitSlug: null }
    expect(await isPublicPageNotFound(target, { lookup: org([]) })).toBe(true)
    expect(await isPublicPageNotFound(target, { lookup: org([{ slug: 'a', live: false }]) })).toBe(
      true,
    )
    expect(
      await isPublicPageNotFound(target, {
        lookup: org([
          { slug: 'a', live: false },
          { slug: 'b', live: true },
        ]),
      }),
    ).toBe(false)
  })

  it('needs that unit to exist and be live for the unit page', async () => {
    const target = { slug: 'x', unitSlug: 'a' }
    const units = [
      { slug: 'a', live: false },
      { slug: 'b', live: true },
    ]
    expect(await isPublicPageNotFound(target, { lookup: org(units) })).toBe(true)
    expect(await isPublicPageNotFound({ slug: 'x', unitSlug: 'c' }, { lookup: org(units) })).toBe(
      true,
    )
    expect(await isPublicPageNotFound({ slug: 'x', unitSlug: 'b' }, { lookup: org(units) })).toBe(
      false,
    )
  })

  it('falls through when the lookup fails or hangs', async () => {
    const target = { slug: 'x', unitSlug: null }
    const failing = () => Promise.reject(new Error('down'))
    expect(await isPublicPageNotFound(target, { lookup: failing })).toBe(false)
    const hanging = () => new Promise<PublicOrgVisibility>(() => {})
    expect(await isPublicPageNotFound(target, { lookup: hanging, timeoutMs: 5 })).toBe(false)
  })
})
