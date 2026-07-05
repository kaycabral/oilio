import { Main } from '@cbrl/design'

// Frame for the FULL-PAGE settings routes only (deep link / refresh / LGPD
// e-mails). The four /settings/* pages render just their <SettingsSection>
// content; this layout wraps them in the app's page frame (<Main width="narrow">)
// so they line up with every other screen.
//
// The Configurações modal does NOT pass through here: it is a client dialog
// (SettingsModal) anchored to the `#settings/X` URL hash that renders the section
// panels directly, so nothing is nested inside a second <main>.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <Main width="narrow">{children}</Main>
}
