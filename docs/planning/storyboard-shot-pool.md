# Storyboard shot pool (fold Pindeck's board layout into CSP)

Status: plan, not built. Written 2026-09-30 after the Blood Rush trailer grid runs.

## Why

A 3×3 grid run is rarely all good: one grid nails the interior, another nails Kai, a third has the only usable backflip. Today the good panels are stranded inside separate grid images. The operator wants to **pull shots out of any grid into one pool, drag them into a storyboard in any order, keep variations side by side, and fill the gaps with one-off generations** — then feed that storyboard forward (as a composed grid or ordered refs) into Seedance.

Pindeck already has this interaction; CSP should adopt its model rather than invent one.

## What Pindeck does (reference)

- `pindeck/convex/schema.ts:143` — `storyboards` table: `layoutState.frames[]` of `{ id, style: grid|hero|strip, gridSize: 2–5, collapsed, note, slots: (imageId|null)[] }`, plus a flattened `panels[]` `{imageId, layout, order}` and `sourceImageIds`.
- `pindeck/convex/storyboards.ts:79` — `saveBoardLayout`: validates every slot against the board's pool (unknown ids → `null`), truncates notes, upserts one storyboard per board.
- `pindeck/src/components/pd/BoardsView.tsx:349` — `BoardStoryboardWorkspace`: shot rail (the pool) + frames of slots. HTML5 drag-and-drop with a custom MIME type `application/x-pindeck-shot`, payload `{kind:'shot', imageId}` from the rail or `{kind:'slot', panelId, slotIndex, imageId}` when moving between slots. Changing a frame's style/size resizes its slots (`resizeSlots`); a shot already placed is refused with a toast; save state idle → saving → saved.

## Proposed CSP model

Keep CSP's shape (Zod in `src/lib/domain/schemas.ts`, file-backed project store, ledger events, `expected_version` optimistic concurrency).

```ts
shotSchema = {
  shot_id,                // "<grid asset id>/p<N>", "<video asset id>/c<NN>", or a uuid for one-offs
  kind: 'image' | 'video',
  asset_id,               // the cropped still or cut clip, a ProductionAsset
  thumb_asset_id: string | null,  // keyframe for video shots
  source: { kind: 'grid_panel', grid_asset_id, panel: 1..9 }
        | { kind: 'video_segment', video_asset_id, start_s, end_s, splitter_job_id }
        | { kind: 'one_off', job_id },
  beat: string | null,    // links to a story card beat / card_id when known
  prompt_ref: string | null,  // the prompt file/text that produced it
  model: string | null,   // nano_banana_pro | gpt_image_2_5 | …
  verdict: string | null, // operator note ("best interior", "Kai missing")
}

storyboardSchema = {
  storyboard_id, title,
  frames: [{ frame_id, style: 'grid'|'hero'|'strip', grid_size: 2..5, collapsed, note, slots: (shot_id|null)[] }],
  updated_at
}
```

`production.shots[]` and `production.storyboards[]` sit next to the existing `production.assets[]`. Save rules mirror Pindeck: slots must reference a pool shot, else `null`; a shot may appear once per storyboard; style/size changes resize slots without dropping filled ones.

## Slices

1. **Domain + store** — schemas, gateway commands `save_storyboard` / `add_shots`, ledger events, tests. No UI.
2. **Slice + import via splitter** — all cutting goes through the existing **splitter-pro2** service (`https://splitter.serving.cloud`, source `Github/splitter-pro2`, API in `backend/src/backend/app.py`), not app-local ffmpeg:
   - Grids → stills: `POST /api/image-split/fixed-grid` (`rows=3, cols=3, gutter_px`) or `/api/image-split/auto` (gutter detection).
   - Seedance drafts → clips: `POST /api/jobs` (`split_mode=scenes`, file upload) → poll `GET /api/jobs/{id}` → `GET /api/jobs/{id}/result` manifest → pull segments from `/api/jobs/{id}/assets/{path}`; thumbnails from `/segments/{i}/keyframe`; `/contact-sheet?segment_indices=…` doubles as "compose selected shots into a grid" for step 5.
   - Auth: splitter sits behind a PIN access gate (`POST /api/access-gate` → session cookie, SameSite=strict). CSP needs the access code as a server-side secret (`SPLITTER_ACCESS_CODE` in `.env.local`, real value from the homelab secrets store — see `proxmox-home/secrets/credentials.template.md` → Splitter) and a small adapter that unlocks once and reuses the cookie.
   - Store each result as ProductionAssets + shots; keep the splitter job id on the shot for traceability.
   - One-time import of the existing `files/trailer/pool/pool.json` (63 grid stills + 26 draft clips) and `storyboard-trailer-v1.json`.
   - Note: draft 03's strobe transitions register as many tiny scene cuts — merge segments under ~0.4 s into the previous shot (or tune splitter's scene threshold) so flicker doesn't become fake shots.
3. **Workspace UI** — storyboard route: shot rail filterable by beat / model / grid, frames with drop slots (DnD payload `application/x-csp-shot`, same `shot`/`slot` kinds as Pindeck), notes, collapse, save with `expected_version`, served images via the existing `/api/projects/[id]/files/...` route.
4. **Fill a gap** — "One-off" on an empty slot: pre-fills a single-shot prompt from the slot's beat + the prompt that produced its neighbours, sends it to the image model, and adds the result to the pool. Needs a generation adapter in the app (today generation runs through the Higgsfield MCP outside CSP) — decide Higgsfield API vs. keep it operator-driven and just import results.
5. **Feed forward** — compose a storyboard frame into a new 3×3 grid image (for the grid-first Seedance workflow) or export the ordered shots as `@Image_N` refs + a Seedance shot list.

## Already on disk (gitignored project data)

`data/projects/01a0f10b-…/files/trailer/`
- `pool/<grid>/p1..p9.jpg` — 7 grids sliced (the ones that followed references), 63 shots.
- `pool/clips/<draft>/cNN.mp4` + `cNN.jpg` — the 3 Seedance drafts cut into 26 shot clips with keyframes. **Stopgap:** cut locally with ffmpeg `scdet` (threshold 9, <0.4 s merged); splitter replaces this in step 2.
- `pool/pool.json` — manifest: every shot (`kind: image|video`) → file, grid/panel or source video + start/end, beat, model, prompt file, verdict.
- `pool/storyboard-trailer-v1.json` — a first storyboard in the proposed shape: best take per beat, `null` slots for the missing crack landing and keep-hopping wide, alternates listed.
- `prompts/` — every grid and Seedance prompt; the ones behind the pooled grids are referenced from `pool.json`.
- `NEXT.md` — trailer status and lessons.
