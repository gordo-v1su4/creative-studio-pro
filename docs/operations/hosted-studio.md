# Hosted editable studio

Vercel project `creative-studio-pro` in `gordo-v1su4s-projects` owns
`studio.v1su4.com`. Production is a gateway, not the read-only watch-site build.
Vercel Authentication must protect **all deployments**, including the production
domain. The operator uses the existing GitHub-backed Vercel team account.

The persistent adapter-node studio runs on App VM. Its ledger, Prep state,
series cache and working files live outside the container image. Review Room
remains the media upload destination and owns its RustFS bucket. Hosting does
not automatically publish existing Prep files to Review Room. Workstation
originals are preserved during migration.

`scripts/build-studio-gateway.ts` reads protected build settings and emits private
routing output: external rewrite, overwritten proof header, disabled caching.
Never commit or share that generated output. The origin requires the proof on
**every** request, including media and writes. Missing credentials fail closed.
Provider, Notion and Review Room keys belong only on the origin.

| Consumer setting | Canonical BWS record in hermes_keys |
| --- | --- |
| Vercel `CSP_STUDIO_ORIGIN` | `CREATIVE_STUDIO_PRO_STUDIO_ORIGIN` |
| Vercel/origin `CSP_OPERATOR_TOKEN` | existing `CREATIVE_STUDIO_PRO_OPERATOR_TOKEN` |
| Origin `CSP_REQUIRE_GATEWAY` | `CREATIVE_STUDIO_PRO_REQUIRE_GATEWAY` |
| Origin `CSP_PROJECT_ROOT` | `CREATIVE_STUDIO_PRO_HOSTED_PROJECT_ROOT` |
| Adapter-node `ORIGIN` | `CREATIVE_STUDIO_PRO_HOSTED_ORIGIN` |

Build an exact commit with `infra/studio/Dockerfile`; exclude secrets and data.
Do not set `VERCEL` or `CSP_PUBLIC_SITE=1` on the origin. Local behavior is
unchanged when `CSP_REQUIRE_GATEWAY` is unset.

Before activation, verify copied file SHA-256, project version, Prep selections,
anonymous origin read/write denial, custom-domain sign-in, authenticated reads,
a reversible write and a real browser session. Stop the hosted writer before
restoring data; never overwrite a newer hosted ledger with a workstation copy.
Roll back the image without replacing its persistent data volume.

TR105 is `01a1df26-166b-7701-b799-3b43c3d1d318`; its Review Room root is
`kh7ayapj8a971qb8bb52m063798jbqs7` under Blood Rush. Preserve TR100's shots,
picks and cuts. Shot creation follows moment review, breakdown and board creation,
then Review Room folder sync. Deployment does not approve moments or generate media.
