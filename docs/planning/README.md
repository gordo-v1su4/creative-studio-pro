# Planning artifacts

Product and engineering planning for Creative Studio Pro. These files are the
requirements and design source of truth for what the app is being built toward.

## Start here

| Doc | Path |
|-----|------|
| PRD (v1.0.0) | [prds/prd-creative-studio-pro-2026-08-22/prd.md](prds/prd-creative-studio-pro-2026-08-22/prd.md) |
| Epics & stories | [epics.md](epics.md) |
| Architecture spine | [architecture/architecture-creative-studio-pro-2026-08-22/ARCHITECTURE-SPINE.md](architecture/architecture-creative-studio-pro-2026-08-22/ARCHITECTURE-SPINE.md) |
| Methodology contract | [architecture/architecture-creative-studio-pro-2026-08-22/METHODOLOGY-CONTRACT.md](architecture/architecture-creative-studio-pro-2026-08-22/METHODOLOGY-CONTRACT.md) |
| Visual design | [ux-designs/ux-creative-studio-pro-2026-08-22/DESIGN.md](ux-designs/ux-creative-studio-pro-2026-08-22/DESIGN.md) |
| UX behavior | [ux-designs/ux-creative-studio-pro-2026-08-22/EXPERIENCE.md](ux-designs/ux-creative-studio-pro-2026-08-22/EXPERIENCE.md) |

## Related

- **Implementation specs:** [../implementation/](../implementation/)
- **Product brief:** [../product-brief/](../product-brief/)
- **Agent onboarding:** [../AGENT-HANDOFF.md](../AGENT-HANDOFF.md)
- **Runtime gates (S1/S2, bridge):** [../../HANDOFF.md](../../HANDOFF.md)

Shorter entry points at repo root: [../PRD.md](../PRD.md), [../UI-UX.md](../UI-UX.md).

## Story and Prep workflow improvements

Recorded November 15, 2026 during Blood Rush trailer planning, then brought into
scope at the owner's request. The first implementation is described in
[Trailer moments and Joey Prep](../implementation/trailer-moments-and-joey-prep.md).
The verified public Notion template link, full coverage report and automatic
Review Room template synchronization remain follow-ups. The original requirements:

1. **New Project starts from the owner's actual starting point.** Offer three
   paths: **I need an idea**, **I have an idea**, and **I already have a story**.
   Only the first path begins with concept/logline pitches. The existing-story
   path offers **Import from Notion** and access to the **Notion template**
   (download or duplicate, as supported). Import should work with the current
   template/page arrangement rather than assuming the old nesting. Clearly
   distinguish the source story (such as a whole season) from the deliverable
   being made (such as a trailer); do not require a finished story to restart
   idea generation or intake.
2. **Make the Story-to-production handoff and navigation explicit.** Show how a
   reviewed story becomes an editable shot plan and then a new board, including
   which existing takes cover each beat and what is missing. Explain the roles
   of Story, Prep, Board, Shots and Cuts, and distinguish Draft Brief, Save Brief,
   Save Workspace and Rebuild Story. Existing story/footage workflows must retain
   prior boards, cards, takes and cuts when developing a new trailer plan, rather
   than silently replacing them with six generated cards. Show-level cast and
   location Prep must be reusable by the show's trailers and episodes, with
   production-specific choices kept explicit. A trailer can be one deliverable
   containing many planned shots without borrowing an episode's full beat sheet.

## Deferred Prep follow-ups — November 16, 2026

Owner requested recording these for later while completing the current trailer
workflow; this list does not authorize starting implementation or generating media.

- [ ] Keep multiple named location views (exterior, interior, reverse, additional
  angle) under one location. Label each reference's role and let the owner choose
  the relevant views for a scene or shot; uploading another view must not silently
  replace the selected one.
  Blood Rush rooftop note: retain distinct sunset/backflip-run and blue
  storm-night/group-chase settings. The owner has not established whether Kai's
  backflip run belongs to the same chase as the group pursuit. Do not merge their
  geography, lighting or story continuity. Owner subsequently identified three
  references: the general Portland skyline, blue storm-night chase (LUMEN), and
  Kai's sunset rooftop run for venting/letting off steam. These now have separate
  named Prep entries and reference images. Scene/shot-specific locks remain pending.
- [ ] Keep named character looks under one identity, with revisions within each
  look. Allow identity plus optional wardrobe references when building a look.
  Lock the approved look and location-view versions to a scene, with explicit
  shot overrides, so changing the Prep default cannot silently change that scene.
- [ ] Expose a show-level visual Bible with approved palette/lighting reference
  frames, day/night guidance and clear inheritance into location and shot prompts.
  Sample colors from owner-approved footage or stills and label palette-only
  references separately from geometry and identity sources. Character identity
  sheets retain their neutral-gray lighting contract.
- [ ] Reconcile Blood Rush's older California location-visual-canon.md against
  the current Portland v2.1 story and Portland film lock before reusing its campus
  architecture. Develop daytime guidance for owner review: minimal daytime in the
  trailer, with muted overcast/open-shade imagery rather than bright sunny campus
  coverage. This is proposed direction, not an approved new palette.
