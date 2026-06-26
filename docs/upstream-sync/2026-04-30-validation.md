# 2026-04-30 — fresh-project validation pass

Re-ran the bootstrap → infra:up → App Hosting flow against a brand-new GCP project (`scheduling-development-3941`) to validate the documented path. Findings turned into PRs:

| Friction observed                                                                                                                                             | Resolution                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gcloud projects create` collides on global-unique IDs; bootstrap didn't help                                                                                 | [stack-starter#47](https://github.com/cbrl-dev/stack-starter/pull/47) — bootstrap auto-creates project + optional `--billing-account` flag                                      |
| Bootstrap step 3 referenced `firebase apphosting:repos:create` (non-existent) and the Developer Connect console (DEVELOPER_CONNECT app — App Hosting rejects) | stack-starter#47 — replaced with the working `firebase apphosting:backends:create` flow + warning to "create new" connection                                                    |
| Cloud Build preparer denied secret access during build                                                                                                        | [platform#16](https://github.com/cbrl-dev/platform/pull/16) — `FirebaseAppHostingSecret` defaults now grant the Cloud Build SA alongside the runtime SA                         |
| Pulumi-managed App Hosting backend never auto-rolled-out on push                                                                                              | [platform#18](https://github.com/cbrl-dev/platform/pull/18) — `FirebaseAppHostingBackend` now also creates `gcp.firebase.AppHostingTraffic` with `rolloutPolicy.codebaseBranch` |
| `cbrl-dev/scheduling` repo settings (incl. `allow_auto_merge`) weren't IaC-managed                                                                            | [platform#17](https://github.com/cbrl-dev/platform/pull/17) — added `StandardRepo('scheduling', ...)` to `stacks/github/index.ts`                                               |

Outstanding (not yet addressed):

- Pulumi `up` against a fresh project hits API propagation races (Firebase Rules API, Identity Toolkit) and needs 2-3 retries. Could be smoothed with more aggressive `dependsOn` or a wrapper retry.
- The Firebase CLI's "reuse existing connection" prompt offers DEVELOPER_CONNECT-app connections that App Hosting rejects. A bootstrap pre-flight could detect and warn.
