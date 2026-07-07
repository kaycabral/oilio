# Changelog

Notable user-facing changes to the oilio web app. Versions and Git tags
(`oilio-vX.Y.Z`) are produced automatically by semantic-release from the
Conventional Commits that touch `apps/oilio/web/`; this file records the intent
behind releases in prose. See the [GitLab Releases](https://gitlab.com/cbrl/cbrl/-/releases)
for the generated notes.

## 0.18.4

### Fixed

- **Sidebar account menu no longer disappears in the installed PWA (#1379).**
  On the installed PWA (WebView Android, standalone) the account button in the
  sidebar footer could vanish after a pull-to-refresh, staying gone until the app
  was reopened. Root cause was a layout defect in the shared design system
  (`@cbrl/design`): the fixed sidebar rail sized itself with `h-dvh`, and the
  WebView's dynamic viewport resolves taller than the actually-visible height when
  the system-bar geometry shifts on refresh/resume — pushing the footer below the
  fold, where it was clipped. The rail is now sized purely by `inset-y-0` (the real
  top→bottom of the viewport), immune to that divergence. The app consumes the
  design system from workspace source, so this release ships the fix to production.
