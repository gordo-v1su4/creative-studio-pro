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
Never commit or share that generated output.

Caching, decided 2026-11-23: Vercel's CDN stores nothing on any route. The
signed-in browser may keep derived media only: a take's 480p proxy (`?proxy=1`),
poster (`?poster=1`) and frame strip (`?strip=1`), and a picture's thumbnail
(`?variant=`), each on a project file. On those requests the gateway leaves the
origin's own `Cache-Control` in place (`private`, a day at most; an hour for
thumbnails); errors carry no such header and are not kept. Pages, project data and
original files stay `private, no-store`. Before this, every hover and every cut
reopen downloaded its media again at 0.2–1.6 s a file. The origin requires the proof on
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
| Origin `SPLITTER_APP_ACCESS_PIN` | existing `STACK_STRUCTURE_IMAGE_SPLITTER_ACCESS_CODE` |
| Origin `BODY_SIZE_LIMIT` | `CREATIVE_STUDIO_PRO_BODY_SIZE_LIMIT` |
| Origin/local `CSP_MEDIA_GATEWAY_URL` | existing `PROXMOX_HOME_MEDIA_API_PUBLIC_BASE_URL` |
| Origin/local `CSP_MEDIA_GATEWAY_TOKEN` | existing `PROXMOX_HOME_MEDIA_API_TOKEN` |
| Origin/local `CSP_MEDIA_GATEWAY_BUCKET` | `CREATIVE_STUDIO_PRO_MEDIA_GATEWAY_BUCKET` |

Reference uploads, attachments and generated Prep sheets use the existing RustFS
image pipeline. Character and location working sheets are PNG, downscaled to a
maximum long edge of 2048px without upscaling. Imported/generated source versions
remain intact. The optional existing-sheet migration keeps SHA-256-verified
backups under `files/prep/originals/` and updates only the working file and its
cache version: `bun scripts/normalize-reference-sheets.ts <project-id> <origin-url>`.
Run it before thumbnail warming for an existing project. For maintenance, capture
identities first with `bun scripts/snapshot-reference-sheets.ts <origin-url>`,
stop the hosted writer, then pass each saved JSON path as the normalizer's third
argument in a one-off container with the same data mount and private environment.
The normalizer also backs up Prep metadata before changing working-file pointers.

The existing RustFS Sharp `/process-image` service keeps the same layout as
Pindeck: `media-uploads/YYYY/MM_DD/<content-sha256>/original/`, `preview/`,
`low/` (320px WebP), and `high/` (1280px and 1920px WebP). Originals retain
their bytes. New versions use new content keys, never overwrite another project's
images, and do not change source take selections or Review Room ownership.

Compact views request `?variant=small|medium|large` through the authenticated
Studio file/reference route. Full-size preview and generation URLs stay original.
Existing references backfill on the first variant request. Manifests and downloaded
variants are a disposable cache beside the project root in `reference-variants/`;
the cache checks source size/mtime and shares in-flight conversions. A service
outage keeps an import but leaves variants pending for a later read to retry.
Local instances without gateway configuration retain original-image behavior.

To warm an existing project's current sheets, run inside the configured Studio
container: `bun scripts/warm-reference-thumbnails.ts <project-id> <origin-url>`.
Use that container's internal listener as the origin URL. This reads reference
files and prepares the disposable cache; it does not edit the project or its Prep
selections. The script reports original and medium-thumbnail byte totals.

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

## Releasing

Two halves, one commit. The gateway (Vercel) redeploys by itself on every push
to `main`. The app (the origin on App VM) is released by hand, on the operator's
word each time:

```bash
scripts/release-studio.sh <commit>
```

The commit must be on `origin/main`, so both halves run the same code. The
script archives it, copies it over Tailscale SSH (`gordo@app-vm`; override with
`CSP_RELEASE_HOST`), matches the checksum, builds the image on the VM, keeps the
running image as `rollback-<its commit>`, switches `:production`, and waits for
healthy and an anonymous 401. It never touches `data/`.

Afterwards: check the change in a signed-in browser on the custom domain, then
record both release identities in `proxmox-home/docs/creative-studio-pro-hosting.md`
(pull that repo first). A gateway-only push is recorded there too, as such.

Provider errors the origin answers with 502 reach the browser as the edge's own
HTML page, not the app's JSON; a screen that calls such a route must cope with
an answer that is not JSON.

## Project data is separate from a code release

The hosted App VM store is authoritative for production work. Git branches,
commits and Vercel deployments carry application code, not the ignored workstation
`data/projects/` directory. A local dev session writes a separate ledger and media
tree; it does not synchronize those changes to the hosted store. Use the hosted
app for production story, Board, shot, take and cut edits. Local development must
use disposable fixtures unless a specific local project workflow is requested.

Never report local creative work as available in production based on a Git push.
Before closing work that changes project content, compare the actual hosted
project ID, story revision, cards, assets, cuts and media availability with the
intended result, then open the public app and verify the story, populated Board
and real clip playback. A deployment check alone does not pass this gate.

For existing workstation-only work, compare ledger ancestry and hosted changes
first. Back up both stores; stop the hosted writer for activation. Copy and verify
each referenced media file before appending the reconciled project snapshot to
the hosted ledger. Refuse differing destination bytes or a changed target ledger.
Preserve hosted Prep and other independent files rather than replacing the whole
project directory. Keep the original local ledger and a migration receipt for
recovery. Preserve source-project media, picks, cuts and Review Room IDs.

On 2026-11-18, TR105's local version 60 was reconciled into hosted version 61:
story v2.3, 25 approved moments, 146 cards (including 61 retired planned cards),
85 video assets and five cuts. All 85 missing files (118,082,264 bytes) were
SHA-256 verified and their hosted HTTP media reads passed. The existing hosted
ledger was retained and the new snapshot appended; hosted Prep was unchanged.
The pre-migration backup and receipt are under the origin data directory at
`migration-backups/tr105-2026-11-18T21-45-33.225Z/`. The older hosted version 19
contained no cards or assets and the v2.1 story; it was not the current local work.

TR105 is `01a1df26-166b-7701-b799-3b43c3d1d318`; its Review Room root is
`kh7ayapj8a971qb8bb52m063798jbqs7` under Blood Rush. Preserve TR100's shots,
picks and cuts. Shot creation follows moment review, breakdown and board creation,
then Review Room folder sync. Deployment does not approve moments or generate media.
