# Trailer moments and Joey reference creation

Implemented November 15, 2026. New projects can start from no idea, an idea, or an existing story. The existing-story path accepts pasted text or a connected Notion series/root link. Notion remains the story master; the project stores a dated Bible snapshot and named reference catalogue. A verified public Notion template download/duplicate link is still pending.

Story plans propose dramatic moments before camera coverage. Each moment requires explicit approval before the Agent can break it into shots. Editing its event, cast, location or time budget clears its approval and breakdown. Adding approved coverage to the Board appends stable, benched draft cards in act groups; it preserves existing cards, picks, assets and cuts. Model proposals must fit the requested runtime. The older Rebuild Story action is blocked for projects using this plan.

Prep derives requirements from moment cast/location declarations, even before shots exist. The owner can add named characters, locations and props. An optional reference project supplies read-only previews; reusing a reference copies a source into the new project. Generated references for a standalone trailer stay local instead of replacing show references in Notion or Review Room. Existing episode workflows retain their previous behavior.

New story-plan characters use Joey's **Castkit v1** for face locks, outfits from an approved face, and reference sheets. Locations use Joey's **Scenecraft v1**: environment master, then matching coverage from an approved master. This UI currently exposes these core stations; Castkit additions/outfit replacement and Scenecraft people plates are not separate controls yet. Face locks, outfits and locations require saved facts; sheets use the explicit template inputs described below. All require a pre-prompt confirmation and the existing separate generation price approval. Source/fact changes invalidate confirmation. These workflows use their own QC instead of ONE SHOT's incompatible white-background/left-face sheet rules. Props and older projects retain their existing workflow.

Character sheets now use the versioned `agent-skills/castkit-v1/references/character-sheet.txt` directly. This replaces the sheet-writing model call; face-lock and outfit creation retain their existing writers. Only the subject selector, one of two fixed reference-role sentences, and the owner's literal direction are substituted. The first reference governs identity; an optional second governs body and wardrobe, regardless of upload order. Scene photos, portraits and existing sheets use the same template. Missing body/outfit information needs owner-supplied details or another reference and a completeness confirmation. Sheets do not require generated facts. Sheet prompt previews are read-only; pricing and sending reject prompts that differ from the filled template. The app and installed Castkit copies carry identical template files. Deterministic prompt assembly does not promise identical image output.

App-owned skill copies came unchanged from `C:/Users/Gordo/.agents/skills/` on November 15, 2026:

| Skill | Creator | SHA-256 of SKILL.md |
| --- | --- | --- |
| castkit-v1 | Joey | 1F3BAEC1F908F7A8E015160F4F70BC89B52DFFEDD72F9EE6F8CE80CC08FC14E9 |
| scenecraft-v1 | Joey | 78B43C660883A80D07C77F921049E15312CD53FD9B1E901BEE7AA0316E8EF57B |

The initial import left global/vault skills unchanged. A subsequent owner-requested Castkit correction replaces the sheet's neckline-dependent hollow-body variants with an intact-neck head crop for every outfit. The chest, shoulders and full natural neck stay solid; only the head is omitted immediately below the jawline, with no visible cross-section. Jewelry stays against the body. This correction is present in the app-owned copy and the installed `.agents` and `.codex` Castkit copies; the table above records the original import hashes. No vault skill was edited. Previously saved prompts require redrafting to use the correction.

Ghost continues to guide shot coverage. Project Stack Structure's Bible adapter was inspected in its unreleased worktree; it was not transplanted or treated as deployed.

Declared character/location keys travel from moments to board cards, queued generation records and landed takes. Generation records freeze the identity declarations at submission. These tags are metadata, not automatic visual recognition or model training.

Review Room registration retains its existing explicit action. This change does not register an empty project or manufacture clip folders while moments are still proposals. Automatic folder/template synchronization and a complete missing-footage coverage report remain follow-ups.

Validation covers append-only/idempotent board creation, stale moment invalidation, identity propagation across queued work, inherited reference isolation, workflow prerequisites, confirmation invalidation and selected skill loading through a fake model. Browser verification shows the fresh Blood Rush trailer's proposed moments, required cast/locations, inherited previews and Joey station controls. Actual Agent quality and generated images still need creative review; no images were generated for verification.

Validation results: `bun run check`, `bun run build`, `bun run check:env` and `git diff --check` pass (one existing unused CSS warning). Full `bun test`: 442 pass, one failure because the untouched `.agents/skills/seedance-teaser-trailer/SKILL.md` differs from its current vault source. The targeted story-plan/Prep suite passes all 11 tests. No unrelated vault skill was synchronized as part of this change.

November 16 attachment repair: source and outside-sheet pickers accept multiple
files and upload them sequentially with progress and stop-on-error feedback.
Outside uploads retain their original filenames as gallery labels. The expanded
saved-image gallery is visible even when no upload has successfully become the
current result. Local standalone trailer references retain their original pixels
and file format instead of going through the series-only 2K/name-stamping gate;
series publication requirements remain in force. Multiple attached views are
retained together, with one explicitly current reference; named view roles and
scene-specific selection remain deferred. Focused Prep tests (16), typecheck and
production build pass. Live recovery verified both previously failed gym uploads
and the current thumbnail return image/png with HTTP 200. Browser visual acceptance
was unavailable because browser access was blocked by its URL security policy.

November 16 facts repair: Prep reads the reference project's saved facts when a
local entry has none, preserving local overrides and normalizing the metadata
name to the current entry. Replacing a reference image retains facts. Empty
location/prop notes are rejected before saving. The UI labels static workflow
guidance, shows elapsed drafting time, and reports completion/errors alongside
the entry. A live rooftop draft returned valid saved notes after 150.6 seconds;
the UI previously supplied only generic waiting text and a page-top error area.
Seven existing cast specs were restored from Late Shift without model calls;
Bryson had no prior spec. General Portland, blue storm-night chase and sunset run
references were organized into separate local Prep entries at owner direction.
Focused Prep tests: 17 pass; typecheck: zero errors, one pre-existing CSS warning.
