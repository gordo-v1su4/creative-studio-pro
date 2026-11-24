# UX streamline — decisions so far

Status: four rounds settled on 2026-11-23 and a fifth, for the re-render queue, on 2026-11-24. What is built is recorded in `PLAN.md`. Branch: `ux-streamline`. This file is the running record of how each decision was reached; the result is in `DESIGN.md`, `SPEC.md` and `PLAN.md`.

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

## Settled in round 5 (2026-11-24): the re-render queue, slice 8

Asked for by the operator that morning: "there should be a choice when you say needs revision on the right panel, to say 'add to queue for re-render' and we come up with a system to queue files and ai write the new prompt changes and just have it queued for rerendering it would then show complete in the render queue and where/how it was rendered ie. (higgsfield, fal.ai, local or cloud comfyui)". Settled in three rounds of questions the same day. The terms are in the root `CONTEXT.md` under "Rendering".

27. **A re-render remakes the video only, by reuse.** It sends the earlier take's request again: the same still, the same references, the same length and sound. Only the prompt changes, and nothing new is attached. This is what "Reuse" does in Higgsfield's own history, which is how the operator works today. Remaking the still is not part of it.
28. **Where it starts.** A take whose status is Needs changes shows "Queue re-render" in the review block of the right-hand panel, with one box: "What do you want to change?". It is offered wherever the status was set, here or by a client in Review Room. Nothing is ever queued by itself.
29. **The Agent writes the prompt change with the skill that wrote the prompt.** It reads the skill itself (Ghost for a video prompt), not its memory of it, and keeps the skill's sections in the skill's order. It works from the requested change, the shot's open notes from Review Room with their timecodes, the prompt by section and the shot spec, and changes only what they ask for. The skill's check runs on the result. A prompt that is not written in sections (older takes) is edited as it stands. The Agent changes the prompt only, never the settings.
30. **The prompt change is seen and approved before anything renders.** What was added is highlighted and what was taken out is shown struck through, word by word: a light highlight, not a line-by-line diff. The operator can edit any section, then approves. With no requested change and no notes there is nothing to go on, so the entry offers two choices: type a change, or "Render again unchanged".
31. **One price and one Confirm for everything approved.** The operator approves prompt changes while reviewing, then asks one price for all approved entries and confirms the total once. The total is shown per render provider, credits and dollars apart. Nothing is spent without that Confirm, which keeps decision 17; there is no standing cap. A provider that costs nothing still waits for the same Confirm.
32. **Render providers.** Higgsfield with Seedance 2.5 is where every entry starts. The operator can change the provider and model on an entry before approving it; the Agent never chooses. fal.ai is listed with Seedance 2.5 for video, and with Nano Banana Pro and GPT Image 2 for stills, which stay unused until stills can be re-rendered; it works once its key is set. SwarmUI on the desktop is listed as a placeholder that cannot be chosen yet. Cloud ComfyUI is on hold. A provider that is not set up is listed with the reason.
33. **There is no draft mode.** Higgsfield no longer finishes a 480p draft at 1080p from the same render, so Finalize and the seven-day draft window leave the app. Resolution is a plain choice of 480p, 720p or 1080p with the price shown for the one chosen; first renders and re-renders start at 480p. A higher-resolution take is a new render and will not match the 480p one, because the model gives no way to keep the seed. Open, for later: carrying a 480p take's motion to 1080p by attaching it as a video reference, which the operator has seen work sometimes.
34. **A finished re-render is another take, in both apps.** It is stored in Review Room at once as the shot's next version, awaiting review, and shows as another take on the shot here. It does not become the pick; the pick and Review Room's current version move only with "Make pick". The take it answers keeps Needs changes. "Make a take" keeps making its result the pick, as it does now.
35. **The render queue is a view in Shots.** It is the third view beside Grid and Canvas, belongs to the project, and lists every render the project sends, those from "Make a take" included, so "where and how" has one place. It is a sortable table, one line per render that never wraps, in the manner of Pindeck's table view and a Deadline render queue, built with TanStack Table. A list across projects is left out.
36. **What a line says.** Shot code and the take's version, state, render provider and model, resolution, length, sound, cost, when it was sent and how long it took, and the provider's answer code where it gives one. Opening a line shows the prompt as sent with the change highlighted, the requested change, the notes it answered, the still and references attached, the job id, and the provider's full error text. The answer code is coloured from the look's own palette: teal for 2xx, amber for 4xx, red for 5xx. Where a provider gives no number its status word is shown in the same colours.
37. **Failure.** A failed line stays, with the code and the reason, and offers "Try again", which asks for a new price and a new Confirm. Nothing retries a send by itself, because a retry can spend. A render refused for its content goes back to "To approve" so the prompt can be changed. A refund is shown only when the provider reports one.
38. **The queue runs on the server, on Trigger.dev.** Confirmed renders finish and land with the browser closed. Each render is a run on the operator's own Trigger.dev (`trigger.v1su4.dev`), in a project of its own beside Pindeck, Stack Structure, Review Room and Splitter Pro; the operator ruled out doing without it. The task keeps time and order; this app does the provider's work and stays the only writer of the project. See ADR 0011.
39. **Higgsfield on Hosted Studio.** The Higgsfield CLI will run on the App VM under the operator's plan, because plan credits are why Higgsfield is the default. Not now: it is on the operator's urgent list. Until then the queue is built and tested on the local copy, and Hosted Studio lists Higgsfield as not set up there. It is a smaller job than it looked: Stack Structure already runs the CLI on that VM with no interactive sign-in, by shipping the CLI's package in its image and handing it the sign-in file as a secret.
40. **Small rules.** One open re-render per take; queueing it again opens the one already there. Everything confirmed is sent as fast as each provider's limit allows. Removing an entry before Confirm costs nothing; after sending, Cancel is offered only where the provider supports it.

Facts found while settling this:

- Higgsfield keeps the whole request on every job (prompt, attached media with their roles, length, resolution, sound), and its media options accept the id of an earlier upload or job. So a take with a Higgsfield job id can be re-rendered with the same images, including takes brought in from the operator's history.
- Seedance 2.5 on Higgsfield accepts no seed. The CLI still lists a `draft` setting and a `draft_job_id`, and a price check with `draft` on was accepted on 2026-11-23; the app stops sending both (decision 33).
- A video take does not record which still it started from, and "Make a take" refuses a shot whose pick is a video. The render record has to carry the still and the references from now on.
- fal.ai answers a price before sending (`GET /v1/models/pricing`, in dollars), reports the balance, runs long jobs through a queue (`queue.fal.run`: submit, status, result, cancel) and answers with ordinary HTTP status codes. Its Seedance 2.5 endpoints are `bytedance/seedance-2.5/us/image-to-video` and `…/reference-to-video`; the image models are `fal-ai/nano-banana-pro` and `openai/gpt-image-2`. Nothing there is called "2.6".
- SwarmUI on the desktop takes a whole ComfyUI workflow through its own API (port 7861) and needs no key: `scripts/mvvm_gen/swarm_raw.py` in the music-video-vending-machine repository and `src/trigger/localGeneration.ts` in Stack Structure show the connection.
- Trigger.dev tasks run in their own containers on the App VM and share no files with any app. Pindeck's tasks report back to their app over HTTP with a bearer token, and a stale report is refused; that is the pattern ADR 0011 copies. The runbook is `proxmox-home/docs/triggerdev-vm100-runbook.md`.
- Stack Structure already sends paid Higgsfield work from a Trigger.dev task (`higgsfield-nano-banana-pro-grid` in its `src/trigger/higgsfield.ts`): the CLI's package is copied into the task image (`additionalFiles` in its `trigger.config.ts`), the sign-in reaches the CLI as a file named by `HIGGSFIELD_CREDENTIALS_PATH`, written from a secret (`src/lib/higgsfieldGateway.ts`, near line 196), the task sits on a `paid-generation` queue limited to one at a time, and it never retries by itself ("a paid provider request must never be duplicated by an automatic retry").
- On the Trigger.dev dashboard (looked at on 2026-11-24, nothing changed): the organisation is `v1su4-91d9` with four projects (Pindeck, Project Stack Structure, Review Room, Splitter Pro); a new project asks only for a name; Stack Structure's production environment allows 300 runs at once, with its own queues limited to 1 to 3.
- Pindeck's table view is hand-written today (`src/components/pd/TableView.tsx`: click a heading to sort, a header that stays put, 32px rows, chosen columns); it does not use TanStack Table. TanStack's current Svelte package supports Svelte 5.

Not asked, so assumed, and easy to change: a re-render leaves the shot's own video prompt alone (each take shows the prompt it was made with); the old Animate window with its session cap is not touched by this slice.

## 2026-11-24: asked for, not yet decided

- **Where am I.** Looking at Hosted Studio on 2026-11-24 the operator found the top of the screen confusing: "the title's at the top and where we're at and what sub-menu. That needs to be kind of clarified visually." It concerns the shell (project title, stage, and the views inside a stage such as Grid and Canvas), not slice 8. Not designed.
- **One thread per slice.** The operator asked that each slice be carried on in its own thread, started from a written handoff (`HANDOFF.md`).
- **Takes.** The operator's requirement, in their words: "we have to be able to see and select between the takes easily on the app and the 'current' take choice must update live between the two, or sync at changes." Built so far: take chips on the shot card, a pick that is kept and resent until Review Room has it, and Review Room's current version followed here within ten seconds. Open: Review Room's own screen following a change made here without a reload.


## 2026-11-24: the Agent chat's look, decided again

The operator looked at the chat in the app and at every earlier mock of it side by side, and chose this. It replaces "The Agent chat carries the Charm colours" above and is the one exception to "No gradients as decoration".

- **No pink anywhere.** "Let's not make a lot of colours with this. It's too busy with all these colours."
- **Purple is the Agent's only colour, and it shows in three places:** a wash that rises from the composer and fades to black about halfway up the panel, the word "Agent" over its messages (a muted purple), and Send with the talk button.
- **Everything else in the chat is grey**: the operator's message is a grey bubble on the right, codes are plain, tabs and mode buttons are grey. No teal in the chat except a proposal's main button.
- **No boxes.** The Agent's text and its proposals sit on the panel with nothing drawn round them, all lined up on the left edge. No borders, no pattern behind the text, no row of slashes.
- **The panel is a chat and nothing else.** "Why is there so many things in this chat menu? There's too much stuff in that chat window." What shows: the messages, one button to start or continue the interview, and the composer. The mode (Brief, Story), Focus, Close, the model and the Agent's actions (pitch three loglines, quick teaser, draft the brief, propose a level) are folded behind one "More" at the top right. What the Agent says about an action it is running still shows without opening it. The old header (wordmark, path, model) and the line under the composer ("Enter sends", version, status) are gone.
- Teal instead of purple was looked at and not chosen.

## 2026-11-24: decided while building slice 4

- **Level approvals live on the production** (`production.story_levels`): when each of the five levels was approved, plus the show code and project code the brief fixed. Scene codes stay on the story plan's scenes; a shot's code is on the shot (`scene_code` and `shot_number`).
- **The lock is enforced in the gateway**, not in the screens: approving is one command, and every whole-project save keeps the approvals, restores a fixed code that is missing and refuses one that is changed.
- **Approving is repeatable.** Something added to an approved level waits, and approving the level again names only what is new. Nothing is named the moment it is typed, so a scene called "New scene" is not stuck with `NSC`.
