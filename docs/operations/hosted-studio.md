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
| Origin `CSP_OPERATOR_ID` | `CREATIVE_STUDIO_PRO_OPERATOR_ID` |
| Origin `KIMI_API_BASE` | `CREATIVE_STUDIO_PRO_KIMI_API_BASE` |
| Origin `KIMI_MODEL` | `CREATIVE_STUDIO_PRO_KIMI_MODEL` |
| Origin `CSP_REVIEW_ROOM_URL` | `CREATIVE_STUDIO_PRO_REVIEW_ROOM_URL` |
| Origin `CSP_SPLITTER_URL` | `CREATIVE_STUDIO_PRO_SPLITTER_URL` |
| Origin `BODY_SIZE_LIMIT` | `CREATIVE_STUDIO_PRO_BODY_SIZE_LIMIT` |

Build an exact commit with `infra/studio/Dockerfile`; exclude secrets and data.
Do not set `VERCEL` or `CSP_PUBLIC_SITE=1` on the origin. Local behavior is
unchanged when `CSP_REQUIRE_GATEWAY` is unset.

App VM owns `/opt/creative-studio-pro/compose.yaml`, mode-600 `private.env`, and
the dedicated `data/` bind mount. Compose project `creative-studio-pro` binds
loopback port 18110. The Caddy edge routes the origin to that listener. This is
a Compose-owned Docker workload, visible through the existing Hawser environment;
do not call it a Dockhand Internal stack until it has been explicitly adopted.
The healthcheck expects anonymous API denial, not an unprotected library.

Before activation, verify copied file SHA-256, project version, Prep selections,
anonymous origin read/write denial, custom-domain sign-in, authenticated reads,
a reversible write and a real browser session. Stop the hosted writer before
restoring data; never overwrite a newer hosted ledger with a workstation copy.
Roll back the image without replacing its persistent data volume.

TR105 is `01a1df26-166b-7701-b799-3b43c3d1d318`; its Review Room root is
`kh7ayapj8a971qb8bb52m063798jbqs7` under Blood Rush. Preserve TR100's shots,
picks and cuts. Shot creation follows moment review, breakdown and board creation,
then Review Room folder sync. Deployment does not approve moments or generate media.
