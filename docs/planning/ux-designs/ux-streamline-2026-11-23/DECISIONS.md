# UX streamline — decisions so far

Status: all four rounds settled on 2026-11-23. Nothing here is built. Branch: `ux-streamline`. This file is the running record of how each decision was reached; the result is in `DESIGN.md`, `SPEC.md` and `PLAN.md`.

Mockups (private canvas): https://claude.ai/artifact/GcSURykGvjJGXujETaqa1m — front door, logline pitch, story plan, Prep, Shots, Canvas, Viewer. Sources in `mockups/`.

## Goal

Make the app easier to follow from an idea to the story plan and shot list, and make its link to Review Room visible. Keep the colours, the Agent chat, the canvas, and shot cards that hold text, image, video and takes. Playback and quick preview with no perceptible wait is requirement number one.

## Settled in round 1

1. **Four stages.** Story · Prep · Shots · Cut replace the seven workflow tabs. Board becomes a Grid/Canvas toggle inside Shots. Sound and Export become steps inside Cut. Series, Watch, Library, Runs, Settings, Publish and New project move into one project menu.
2. **One shell.** Story plan outline on the left, the work in the middle, the Agent docked on the right (collapsible, no modal). A viewer opens over the middle on spacebar from any shot or take.
3. **One front door.** Starting a project is a single drop-anything screen. The Agent drafts the brief and proposes the story plan level by level (brief, acts, scenes, story beats, shot list); the operator approves each level. The brief is no longer a form that must be locked first. S0–S10 stage and gate labels shrink to one plain "Next:" line.
4. **Review in both apps, kept in step.** Statuses, picks and exclusions can be set here or in Review Room. Sync is automatic (no "Sync reviews" button). Every shot shows its Review Room state and opens there with one click, which needs deep links in `review-room-svelte`, so that repo is in scope.
5. **Look.** This app's colours with Review Room's shape language: Inter in sentence case at 13–14px, softer corners, resizable panes, Review Room's status colours, mono type only for shot codes. This supersedes the founding DESIGN.md's 2px corners and uppercase mono labels.
6. **Playback bar.** Hover-scrub on any thumbnail with no wait; spacebar opens the take playing in under 100ms; arrow keys step shots and takes; a selection plays without gaps.

## From the operator, after round 1

- The selection preview (select clips, order them, swap takes, play, push to a cut) is liked and stays; it must get easier to use.
- Playing a long timeline of clips has been the weak spot (slow load). The 480p proxies (`51d3b97`, `bea917a`) and the pinned ffmpeg build (`aa49837`) helped.

## Facts that shape the plan

- Review Room is at `review.v1su4.dev`. Project, folder, asset and version are client state, not in its URL: no deep links today.
- Review Room has no webhooks. This app polls `GET /api/v1/projects/{id}/changes`.
- Review Room media URLs for outside apps are signed and expire in about 10 minutes.
- Hosted Studio serves every request, media included, through the Vercel gateway to the App VM with caching disabled (`docs/operations/hosted-studio.md`).
- Shot thumbnails request the `medium` variant (about 1,800px) for 300px cards.
- The top bar holds about 20 controls; the stage tabs overflow at 1440px.

## Settled in round 2

7. **Look confirmed.** The mockup canvas is the base: this app's colours, Inter in sentence case, soft corners, amber for anything Review Room.
8. **Build order.** (1) The shell plus Shots with the viewer, keys and selection strip. (2) Review Room state, automatic sync and deep links. (3) The front door and story plan levels. (4) Cut, with Sound and Export as steps.
9. **Selection strip.** A strip docked at the bottom of Shots: click a shot to add it, drag to reorder, up/down swaps the take in place, Space plays, one button pushes it to a cut. Assemblies move under Cut.
10. **Shot cards lose their face tabs.** A card shows the pick, and its takes when selected. The shot spec and prompts open in a Details tab in the right dock.
11. **Sync conflicts.** The latest change wins, per shot. This app checks Review Room every 10 seconds while a project is open and when the window regains focus, and marks a shot briefly when a change arrives from there. See ADR 0008.
12. **Review Room additions.** Links that open a given folder, shot or version; an "Open in Creative Studio Pro" link on locked folders; a way for this app to read a shot's notes. Restyling Review Room waits.
13. **Names.** The four stops are stages; the full-size player is the viewer; S0–S10 steps are gates and appear only in Runs.

## More facts

- A timeline plays from GPU frame banks (`src/lib/media/gpu/clipBanks.ts`): each clip's proxy is downloaded whole and decoded into GPU memory (1.5 GB budget) before it can play. Once loaded it is instant; the wait grows with the number of clips.
- An ordered selection already exists in code as `ReviewSequence` (`src/lib/ui/review-sequence.svelte.ts`); the selection strip builds on it.

## Settled in round 3

14. **Swapping a take in the selection auditions it.** The shot's pick, and Review Room's current version, change only with "Make pick". A pushed cut keeps the auditioned takes. The selection's order is the strip's order; boxing shots on the canvas adds them in reading order.
15. **Unplaced footage.** Groups that are not scenes sit in an "Unplaced" section under the story plan in the outline; dragging a shot onto a scene places it.
16. **A timeline plays before it is fully loaded.** It starts when the first clips are ready, loads ahead of the playhead, and keeps proxies in the browser so a second open is instant. The viewer plays one take straight from its proxy. Jumping far ahead may show the still for a moment.
17. **Making a take.** Prompt, "Get price" and a separate Confirm live in the Details tab. The Agent prepares; it never confirms a spend.
18. **Idea tools become Agent actions** on the front door ("Pitch three loglines", "Quick teaser"); Trailer House is no longer a panel.
19. **Scope.** Prep only moves into the new shell, with references in the outline. Desktop is built first, but every screen must hold up at phone width.
20. **Landing.** Each slice merges to `main` and deploys to Hosted Studio once verified, replacing the old screens in place.

## Look, second pass (replaces decisions 5 and 7)

The first mockup was rejected on 2026-11-23. The rules now:

- **Black, neutral greys.** Zinc or neutral, never slate, never green or teal tints. Darker than the first pass.
- **No borders, no outlines, no dotted lines.** A thing is selected or it is not: selection is a tonal fill. Where a division is unavoidable, one hairline at low opacity.
- **No pills.** Review status is shown without a capsule or a dot-in-a-capsule.
- **No circled step numbers.**
- **Compact controls.** 28px tall at most on desktop (Review Room's control height), little vertical padding.
- **One line, always.** No label may wrap; shrink, shorten or truncate instead.
- **Readable primary action.** Dark text on a light button.
- **Pink and purple, sparingly.** Hints of pink and purple stay, strongest around the Agent (its name, its composer, its send button), plus the playhead and the pick. Nothing else is coloured except review status.
- **Panels on black.** Outline, work area and dock are separate rounded surfaces on a black ground with small gaps (Frame.io's structure). Review status is coloured text: amber awaiting, blue in progress, red needs changes, white approved.
- **Fonts.** Geist for the interface, Geist Mono for codes, Archivo Narrow for titles (Pindeck's set).
- **References.** Frame.io first, T3 Chat for restraint, Review Room for button proportions.
- **Responsive and phone-friendly from the start.**


## Look, third pass (feedback on the second, 2026-11-23)

The second pass was "closer" but still not polished. Added or changed rules:

- **Base is black with zinc greys; the colour is teal**, used as it was in the app before. Purple is allowed for the Agent only. No pink. No gradients as decoration.
- **No solid white**: no white buttons, no large white numbers or titles. Primary actions are a muted teal fill.
- **No heavy type.** Titles are not bold. Small tracked capitals (as in Stack Structure) are welcome. The front-door headline gets a different, lighter display face.
- **Buttons hug their text.** Shorter than the second pass; Review Room's are the reference.
- **Nothing reflows on click.** Selecting a shot must not move the rest of the page.
- **No outline on the Agent composer**, animated or not.
- **Sliders and playheads are tall rectangles, never balls.** Note markers too.
- **The scrubbable timeline is the most important control.** Hovering the play bar thickens it and previews low-res frames; the played part is teal, brightest at the playhead and darker behind it (Review Room's scrubber already does this). Timecode stays amber.
- **Takes need a real design**, not a strip that extends the card.
- Reference gathered: Linear (density, restraint), T3 Chat (inset panel, tonal composer), Frame.io (structure, hover-scrub), Review Room (scrubber, teal buttons), Stack Structure (tracked capitals, rectangular sliders).

## Product needs raised with the look

- **Names are fixed early and never change.** As soon as a level of the story plan is approved, its Review Room names are assigned (scene codes with scenes, shot codes with the shot list, reference names in Prep), and that one name is what every screen shows from then on.
- **The Notion template is public.** The series template is published as a public Notion page that anyone can view and duplicate. From the front door the operator can start from a fresh copy or ask the Agent to set it up, and there is a place in Settings to enter a Notion key.

## More product needs (raised 2026-11-23, not yet grilled)

- **Two ways in.** The front door asks one question and then opens up. With an idea: the operator drops whatever they have (a Notion series, a show folder, images, video, a song) and the Agent assembles it. Without one: the Agent leads, pitches three loglines, pitches three more if none fit, and carries on to a quick teaser so the idea can be seen before any characters are built. Example phrases show what can be asked. Small, simple animations are welcome.
- **The Agent leads.** It gets straight to work rather than asking what the operator wants to do. Its chat stays docked at the side throughout.
- **Voice.** The operator can talk to the Agent instead of typing, through OpenAI's voice API.
- **Dump and sort in Prep.** The operator drops every reference image at once. The Agent works out what each one is (character, location, prop), makes standard character sheets from plain headshots with the CastKit skill, and accepts sheets already in the house format. Each character's headshot shows in the right-hand panel.
- **The canvas must be visible and useful.** Images and shots can be laid out, connected and later fed into prompts.
- **Drag and drop everywhere.** Anything can be dropped anywhere it makes sense: into the outline, onto a scene, onto a clip to nest it in a group. Selecting shots and pressing G groups them. Every such action should be guessable without being taught.

## Look chosen: B, Capitals (2026-11-23)

Of the three options the operator chose B. Its rules, on top of the third-pass list above:

- **Chrome in small tracked capitals**: stages, tabs, buttons, labels, section headings and review statuses are set in Geist Mono, uppercase, about 9.5px with wide tracking. Content (titles, descriptions, chat) stays in Geist, sentence case, regular weight.
- **One display face**: Instrument Serif, regular, only for the front-door headline and logline titles.
- **Colour roles**: teal `#7dd9c8` for the brand, the pick, approved, section headings and codes; deep teal `#1b4741` with pale teal text for primary buttons; purple `#a78bfa` only for the Agent's name, voice and send button; amber `#f5b84a` for timecode, notes and awaiting review; red for needs changes; blue for in progress.
- **Surfaces**: black ground; panels `#0c0c0e`; raised `#141417`; selected `#1e1e22`; 10px panel corners, 5px controls; 3px gaps between panels.
- **Sizes**: 34px top bar, 20px controls, 22–24px rows.
- **Takes on a frame**: small upright rectangles, one per take, teal for the pick.
- **Scrub bar**: 8px on hover with a strip of low-res frames above it and a frame preview at the pointer; played part teal, brightest at a rectangular playhead; notes are amber rectangles.

Seven screens are mocked in this look on the canvas: front door, logline pitch, story plan, Prep, Shots, Shots on the canvas, Viewer. Each was rendered and checked locally before publishing. Cut (with Sound and Export) is not mocked yet.

## Look B, revisions after the first seven screens (2026-11-23)

- **No serif.** Instrument Serif is dropped. Headlines are Geist Mono capitals, about 18px, wide tracking, regular weight. Logline titles are Geist, 14px, medium.
- **Selection is teal, never grey.** Anything selected or current gets a dark teal fill (`#10221f`) with pale teal text. The Agent's own tab uses a dark purple fill.
- **Button text is optically centred**: controls are flex-centred with a 1px top nudge and 1px extra left padding to offset the tracking.
- **The Agent chat carries the Charm colours** (as in Charm's Crush and Bubble Tea): pink for the Agent's name and the prompt mark, purple for emphasis and its proposals, teal for codes and for the operator's messages; a row of slashes in the header. It is voice and text.
- **Prep**: every reference thumbnail is the same 16:9 size. A "Found in the story" row lists characters, locations and props the script names that have no image yet, each addable in one click.
- **Prompts are shown in their skill's sections**, not as a paragraph: Ghost's sections for video (Scene, References, Characters, Space, First frame, Timeline, Physics, Camera, Light, Sound, Locks), ONE SHOT's block order for images, with the QC result beside the title.
- **Viewer**: picture and audio lanes (frame strip, scrub bar, waveform) share one tall rectangular playhead; the played part of the waveform is teal.

## Skills are the defaults (raised 2026-11-23)

Every reference, image prompt, video prompt and score prompt the app writes comes from the ONE SHOT skills and Joey's skills held in `agent-skills/` (CastKit for character sheets, SceneCraft for locations, Ghost for video, ONE SHOT image prompts, Fresh Idea for pitches, GhostSuno for score), in each skill's own format and section order. This restates ADRs 0003 and 0004 as a UI rule: the interface shows and edits prompts by those sections.

## Settled in round 4 (2026-11-23)

21. **Voice is a layer, not a second Agent.** OpenAI turns the operator's speech into text and reads the Agent's replies aloud. The thinking stays on the project's model provider. Talking is a Talk button, or holding V (Space stays play). See ADR 0009.
22. **When names lock.** Approving the brief fixes the show code and the trailer or episode code. Approving scenes fixes scene codes. Approving the shot list fixes shot codes. A reference's name fixes when its sheet is made. Before that a name is editable; after it only the title can change.
23. **One operator, one Notion key, Notion optional.** The key is entered in Settings and never shown again. The series template is a public Notion page anyone can duplicate. A project can live entirely in the app; writing to Notion is offered when a key is present. See ADR 0010.
24. **What a drop means.** A clip dropped on a shot becomes another take of that shot. A shot dropped on a scene moves there and keeps its code. An image dropped on a reference becomes one of its source images. G groups the selected shots; a scene is a group with a scene code. The word "collection" is not used.
25. **Found in the story.** A character, location or prop the story names can be added with no image; the Agent can make its reference from the reference spec alone, behind the usual price and confirm.
26. **Cut is mocked when its slice comes up.** It reuses the viewer's lanes with a music lane added.

The design tree is now fully settled. The written spec and plan are `DESIGN.md`, `SPEC.md` and `PLAN.md` beside this file.
