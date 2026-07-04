// The `@modal` parallel-route slot renders nothing on a normal (non-settings)
// navigation and on a full-page load / refresh of any route (brief 0090). Only
// a client-side navigation to `/settings/*` fills the slot via the intercepting
// routes below it; a direct load of the same URL renders the full page instead.
export default function ModalDefault() {
  return null
}
