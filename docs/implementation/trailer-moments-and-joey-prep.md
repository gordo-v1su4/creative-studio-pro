# Trailer moments and Joey reference creation

Implemented November 15, 2026. New projects can start from no idea, an idea, or an existing story. The existing-story path accepts pasted text or a connected Notion series/root link. Notion remains the story master; the project stores a dated Bible snapshot and named reference catalogue. A verified public Notion template download/duplicate link is still pending.

Story plans propose dramatic moments before camera coverage. Each moment requires explicit approval before the Agent can break it into shots. Editing its event, cast, location or time budget clears its approval and breakdown. Adding approved coverage to the Board appends stable, benched draft cards in act groups; it preserves existing cards, picks, assets and cuts. Model proposals must fit the requested runtime. The older Rebuild Story action is blocked for projects using this plan.

Prep derives requirements from moment cast/location declarations, even before shots exist. The owner can add named characters, locations and props. An optional reference project supplies read-only previews; reusing a reference copies a source into the new project. Generated references for a standalone trailer stay local instead of replacing show references in Notion or Review Room. Existing episode workflows retain their previous behavior.

New story-plan characters use Joey's **Castkit v1**: face lock, outfit from an approved face, then a three-panel sheet from an approved outfit. Locations use Joey's **Scenecraft v1**: environment master, then matching coverage from an approved master. This UI currently exposes these core stations; Castkit additions/outfit replacement and Scenecraft people plates are not separate controls yet. Each station requires saved facts, a pre-prompt confirmation and the existing separate generation price approval. Source/fact changes invalidate confirmation. These workflows load their full skill and use their own QC instead of ONE SHOT's incompatible white-background/left-face sheet rules. Props and older projects retain their existing workflow.

App-owned skill copies came unchanged from `C:/Users/Gordo/.agents/skills/` on November 15, 2026:

| Skill | Creator | SHA-256 of SKILL.md |
| --- | --- | --- |
| castkit-v1 | Joey | 1F3BAEC1F908F7A8E015160F4F70BC89B52DFFEDD72F9EE6F8CE80CC08FC14E9 |
| scenecraft-v1 | Joey | 78B43C660883A80D07C77F921049E15312CD53FD9B1E901BEE7AA0316E8EF57B |

No global/vault skill was edited. Ghost continues to guide shot coverage. Project Stack Structure's Bible adapter was inspected in its unreleased worktree; it was not transplanted or treated as deployed.

Declared character/location keys travel from moments to board cards, queued generation records and landed takes. Generation records freeze the identity declarations at submission. These tags are metadata, not automatic visual recognition or model training.

Review Room registration retains its existing explicit action. This change does not register an empty project or manufacture clip folders while moments are still proposals. Automatic folder/template synchronization and a complete missing-footage coverage report remain follow-ups.

Validation covers append-only/idempotent board creation, stale moment invalidation, identity propagation across queued work, inherited reference isolation, workflow prerequisites, confirmation invalidation and selected skill loading through a fake model. Browser verification shows the fresh Blood Rush trailer's proposed moments, required cast/locations, inherited previews and Joey station controls. Actual Agent quality and generated images still need creative review; no images were generated for verification.

Validation results: `bun run check`, `bun run build`, `bun run check:env` and `git diff --check` pass (one existing unused CSS warning). Full `bun test`: 442 pass, one failure because the untouched `.agents/skills/seedance-teaser-trailer/SKILL.md` differs from its current vault source. The targeted story-plan/Prep suite passes all 11 tests. No unrelated vault skill was synchronized as part of this change.
