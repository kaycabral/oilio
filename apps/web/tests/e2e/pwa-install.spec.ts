// E2E for the installable PWA: the web app manifest route, its icons, and the
// install-related <head> metadata. The route (`app/manifest.ts`) is new, so it
// gets a golden-path spec — a broken/missing manifest silently demotes the app
// from "installable" with no runtime error to catch it otherwise.

import { Schema } from 'effect'
import { expect, test } from './fixtures'
import { parseJson } from './helpers/firestore-rest'

// `APIResponse.text()` is the string boundary; decode runtime-validates the
// shape so the suite never asserts an unchecked `as T` (repo no-escape rule).
const ManifestIconSchema = Schema.Struct({
  src: Schema.String,
  sizes: Schema.String,
  purpose: Schema.String,
})
const ManifestSchema = Schema.Struct({
  name: Schema.String,
  display: Schema.String,
  start_url: Schema.String,
  icons: Schema.Array(ManifestIconSchema),
})
const decodeManifest = Schema.decodeUnknownSync(ManifestSchema)

test.describe('PWA — instalável (manifest + ícones + metadata)', () => {
  test('/manifest.webmanifest serve um manifest standalone válido @critical', async ({ page }) => {
    const res = await page.request.get('/manifest.webmanifest')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('manifest')

    const manifest = parseJson(await res.text(), decodeManifest)
    expect(manifest.name).toBe('Oilio')
    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.icons).toContainEqual(
      expect.objectContaining({ sizes: '512x512', purpose: 'maskable' }),
    )
  })

  test('os ícones referenciados pelo manifest existem @critical', async ({ page }) => {
    const res = await page.request.get('/manifest.webmanifest')
    const manifest = parseJson(await res.text(), decodeManifest)

    for (const icon of manifest.icons) {
      const iconRes = await page.request.get(icon.src)
      expect(iconRes.status(), `${icon.src} deve existir`).toBe(200)
      expect(iconRes.headers()['content-type']).toContain('image/png')
    }
  })

  test('o <head> liga o manifest + theme-color + apple touch icon @critical', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)
    // Next emits the light/dark themeColor pair from the `viewport` export.
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveCount(1)
    await expect(page.locator('link[rel="apple-touch-icon"]')).not.toHaveCount(0)
  })
})
