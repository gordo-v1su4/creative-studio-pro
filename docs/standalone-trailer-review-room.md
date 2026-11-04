# Standalone trailers in Review Room

A trailer built directly in Creative Studio Pro can use Review Room without being imported as a Notion episode. Shared show references stay under the show's `_References`; the trailer lives in a sibling folder such as `TR100 — Teaser Trailer`.

First connect the empty trailer folder to the Creative Studio Pro owner credential in Review Room. Then POST to `/api/projects/<local-project-id>/review-room`:

```json
{
  "action": "connect_trailer",
  "expected_version": 1,
  "project_id": "review-room-project-id",
  "folder_id": "connected-trailer-folder-id",
  "show_code": "BLR",
  "code": "TR100",
  "reference_series_id": "local-series-id"
}
```

The connection is saved in the project's ledger. Every board shot gets a child folder and a stable code (`BLR_TR100_SHT_0010`), including shots awaiting media. Reordering does not change codes. Repeat connection with the latest project version to register new shots; an existing connection cannot be redirected.

Use the same endpoint with `{"action":"push_all"}` to upload pending image/video takes, or `{"action":"push","take_id":"..."}` for one. Takes become versions of their shot; the picked take becomes current. Audio stays in the sound stage. The upload uses the existing Review Room environment configuration and credentials. Use `{"action":"pull"}` to import Review Room versions and follow its current picks. No Notion refresh or write is needed.

The API returns individual upload failures; retry failed takes after resolving them. Original project files remain local caches. Shared reference images use the show's existing reference upload flow and stable reference codes.

On Shots, expand **review & exclude** to set the shot's review status (**Awaiting review**, **In progress**, **Needs revision**, **Approved**) or **Exclude** one take. Status is shared across a shot's versions; exclusion belongs to a specific take. Excluded takes stay stored and can be restored, but are skipped by picks and new cuts. Saved cuts keep their original entries.

**Sync reviews** pulls statuses, per-take exclusions/restores and current picks from Review Room, including decisions on takes already stored here. Local review controls send decisions to Review Room immediately; they report a failed write instead of silently claiming a sync. Save pending shot edits before syncing. The existing board Reject/Restore controls use the same version exclusion. API clients can POST `{"action":"review","expected_version":42,"take_id":"...","status":"needs_changes","excluded":true}` (either decision may be omitted).
