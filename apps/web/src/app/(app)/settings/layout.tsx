import { Main } from '@cbrl/design'

// Frame for the FULL-PAGE settings routes only (deep link / refresh / LGPD
// e-mails). The four /settings/* pages render just their <SettingsSection>
// content; this layout wraps them in the app's page frame (<Main width="narrow">)
// so they line up with every other screen.
//
// The Configurações modal does NOT pass through here: it renders the same pages
// via the `@modal/(.)settings` intercepting route, which has its own layout
// (the RouteModal dialog). So there is exactly one <main> on a full page and
// none nested inside the dialog.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <Main width="narrow">{children}</Main>
}
