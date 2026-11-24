# Spec: a streamlined Creative Studio Pro

Status: agreed with the operator on 2026-11-23 after four rounds of questions; the re-render queue (stories 56 to 70) was added on 2026-11-24 after a fifth. See PLAN.md for what is built. How it looks is in [DESIGN.md](DESIGN.md); the order of work is in [PLAN.md](PLAN.md); the reasoning behind each choice is in [DECISIONS.md](DECISIONS.md). Terms are used as defined in the root `CONTEXT.md`.

## Problem statement

The app can already take a story to finished shots, but it is hard to follow.

- Twenty controls share one top bar, and seven workflow tabs overflow it.
- Starting a project is spread over a dialog, an idea panel, an eleven-field brief form and the Agent, and the Agent refuses to start until the brief is locked.
- The Agent opens as a modal over the work.
- Shots and Board are two tabs showing the same shots.
- A shot's takes and its review status are hidden inside a disclosure.
- Review Room, where every take's media lives, appears only as a "Sync reviews" button and a project-id text box. Nothing shows whether a take is stored, what its status is there, or how to open it.
- Things were named one way in the story, another on the board and another in Review Room.
- A long timeline will not play until every clip has been downloaded and decoded.

## Solution

One shell, four stages, and an Agent that leads.

- **Four stages** in the top bar: Story, Prep, Shots, Cut. Everything else moves into a project menu.
- **One shell** on every stage: the story plan outline on the left, the work in the middle, the Agent docked on the right. A viewer opens over the middle.
- **One front door**: say the idea, drop what you have, or ask for a pitch. The Agent drafts the brief and proposes the story plan level by level; the operator approves each level, and approving it fixes that level's names for good.
- **Review Room on every shot**: stored or not, version, status, pick, with one click to open it there. Changes made in either app reach the other without a button.
- **Playback first**: hover-scrub on any frame, a viewer that opens playing, a selection that can be ordered and auditioned, and a timeline that starts before it is fully loaded.
- **Voice**: the operator can talk to the Agent and hear it answer.
- **A render queue**: a take marked Needs changes can be queued for a re-render. The Agent writes the prompt change, the operator approves it, and one Confirm sends everything approved. The queue finishes on the server and says where and how each take was made.

## User stories

### Getting in

1. As the operator, I want one screen that asks what we are making, so that I never choose between three starting dialogs.
2. As the operator, I want to drop a Notion series link, a show folder, images, video or a song onto that screen, so that the Agent can assemble a project from whatever I have.
3. As the operator, I want example phrases shown for "I have something" and "I have nothing yet", so that I can see what I can ask for.
4. As the operator with no idea yet, I want the Agent to pitch three loglines and three more on request, so that I can find a direction by reacting rather than writing.
5. As the operator, I want a quick teaser of the logline I pick before any characters exist, so that I can see whether the idea is worth building out.
6. As the operator, I want the Agent to start working at once and tell me what it is doing, so that I am not asked what I want to do.
7. As the operator, I want to talk to the Agent by holding a key or pressing Talk, so that I can pitch and react without typing.
8. As the operator, I want everything I say kept as ordinary chat text, so that I can read a spoken session back and carry on by typing.
9. As anyone, I want the series template as a public Notion page, so that I can view or duplicate it.
10. As the operator, I want to enter a Notion key once in Settings, so that the app can read and write my series without editing a file.
11. As the operator, I want to make a project with no Notion at all, so that an idea does not need a page before it can become shots.

### Story plan and names

12. As the operator, I want the Agent to propose the brief, then acts, then scenes, then story beats, then the shot list, so that I approve one level at a time.
13. As the operator, I want to change a proposed level by telling the Agent or editing it directly, so that approval is never all-or-nothing.
14. As the operator, I want the brief drafted for me rather than a form I must fill and lock, so that starting is quick.
15. As the operator, I want each level's names fixed when I approve it, so that a scene or shot is called the same thing in the story, on the board and in Review Room from then on.
16. As the operator, I want to be told before I approve that names will lock, so that I am not surprised.
17. As the operator, I want to rename a title at any time without changing its code, so that locking does not freeze my wording.
18. As the operator, I want the story plan outline visible on every stage, so that I can jump to any scene or shot.
19. As the operator, I want one plain "Next" line instead of S0–S10 stage and gate labels, so that I know what to do without learning the pipeline.

### Prep

20. As the operator, I want to drop every reference image at once, so that I do not file each one by hand.
21. As the operator, I want the Agent to sort them into characters, locations and props and tell me what it could not place, so that I only handle the exceptions.
22. As the operator, I want plain headshots turned into standard character sheets by the CastKit skill, and sheets already in the house format accepted as they are, so that every character is made the same way.
23. As the operator, I want the Agent to list the characters, locations and props the story names that have no image yet, so that nothing the script needs is forgotten.
24. As the operator, I want to add such an item in one click and have its reference made from its reference spec, so that a missing image does not block me.
25. As the operator, I want every reference shown at the same size with its exact name and handle, so that the page reads as one list.
26. As the operator, I want each character's headshot in the right-hand panel, so that I can see the cast while I talk to the Agent.

### Shots, takes and the canvas

27. As the operator, I want Grid and Canvas as two views of the same shots, so that I do not switch tabs to arrange them.
28. As the operator, I want each shot to show its pick, its length, how many takes it has and which is the pick, so that I can read a scene at a glance.
29. As the operator, I want selecting a shot to change nothing else on the page, so that the grid does not jump.
30. As the operator, I want the selected shot's takes in a fixed band with their version numbers, so that I can compare them without opening anything.
31. As the operator, I want to drag anything to anywhere it makes sense, so that I never look for a menu to move something.
32. As the operator, I want a clip dropped on a shot to become another take of it, so that filing new footage is one gesture.
33. As the operator, I want to select shots and press G to group them, so that grouping needs no dialog.
34. As the operator, I want a shot dragged to another scene to keep its code, so that moving it never renames it.
35. As the operator, I want footage that belongs to no scene kept under "Unplaced" in the outline, so that pools of clips have a home.
36. As the operator, I want references on the canvas linked to the shots they feed, so that I can see what each prompt will be given.
37. As the operator, I want a shot's shot spec and prompts in a Details tab, shown in the sections of the skill that wrote them, so that I edit a prompt in the form it will be sent in.
38. As the operator, I want "Get price" and "Confirm" as two separate steps, so that nothing is spent by one click.

### Playback

39. As the operator, I want to scrub any frame by moving the pointer across it, so that I can check a take without opening it.
40. As the operator, I want Space to open the viewer already playing, so that looking at a take costs nothing.
41. As the operator, I want arrow keys to step shots and takes in the viewer, so that I can review a scene from the keyboard.
42. As the operator, I want the scrub bar to thicken under the pointer and show the frame at that point, so that I can find a moment quickly.
43. As the operator, I want an audio lane under the picture, so that I can see where sound is.
44. As the operator, I want to gather shots into a selection, drag them into an order and swap in a different take, so that I can try an edit before keeping anything.
45. As the operator, I want swapping a take in a selection to leave the shot's pick alone, so that auditioning is safe.
46. As the operator, I want to push a selection to a cut with one button, so that a good order is saved exactly as I heard it.
47. As the operator, I want a long timeline to start playing as soon as its first clips are ready, so that I do not wait for all of them.
48. As the operator, I want a timeline I have opened before to open at once, so that returning to a cut is instant.

### Review Room

49. As the operator, I want every shot to show whether its pick is stored in Review Room and at which version, so that I know what a client will see.
50. As the operator, I want to set a shot's status, make a pick or exclude a take from the viewer, so that I can review without leaving the app.
51. As the operator, I want a change made in Review Room to appear here within seconds, marked on the shot, so that I never press a sync button.
52. As the operator, I want a change that failed to reach Review Room shown on the shot and retried, so that the two apps never silently disagree.
53. As the operator, I want one click from a shot, a scene or a version to the same thing in Review Room, so that I can hand off to a client view.
54. As a reviewer in Review Room, I want a link from a locked folder back to its project here, so that I can find where it is made.
55. As the operator, I want notes left in Review Room shown in the viewer at their timecode, so that I see feedback where it applies.

### Re-renders and the render queue

56. As the operator, I want a take marked Needs changes to offer "Queue re-render" in the right-hand panel, so that a review turns into the next take without leaving it.
57. As the operator, I want to type what should change in one box, so that I direct the re-render in my own words.
58. As the operator, I want a re-render to reuse the earlier take's still, references and settings, so that the only thing I touch is the prompt.
59. As the operator, I want the Agent to rewrite the prompt with the skill that wrote it, in that skill's sections and order, so that it does not drift from the format.
60. As the operator, I want reviewers' notes on the shot read by the Agent with their timecodes, so that feedback left in Review Room is answered too.
61. As the operator, I want to see what the Agent added and what it took out, highlighted, so that I can judge the change at a glance.
62. As the operator, I want to edit the changed prompt before approving it, so that the Agent's draft is never the last word.
63. As the operator, I want one price and one Confirm for everything I have approved, so that a review session ends in a single decision about money.
64. As the operator, I want to choose the render provider, model and resolution on an entry, with the price for that choice, so that I decide where and at what size it is made.
65. As the operator, I want confirmed renders to finish with the browser closed, so that I can leave and find them done.
66. As the operator, I want a finished re-render added as another take here and in Review Room, awaiting review, without replacing the pick, so that nothing reaches a client before I have looked.
67. As the operator, I want every render of the project in one sortable table, one line each, so that I can read the queue like a render manager.
68. As the operator, I want each line to say where and how the take was made (provider, model, resolution, length, sound, cost, time taken), so that I can trace any take.
69. As the operator, I want a failed render to show the provider's answer code in its usual colour, with the reason, so that I can tell a bad request from a provider fault.
70. As the operator, I want "Try again" to ask for a new price and a new Confirm, so that a retry never spends by itself.

## Implementation decisions

- **Stages.** The top-level navigation becomes a list of four stages. Board becomes a view mode of Shots. Sound and Export become steps inside Cut. Global pages (Series, Watch, Library, Runs, Settings), Publish and New project move into a project menu. A stored workspace tab from the old layout maps to its new stage.
- **Shell.** A single shell component owns the three panels, the top bar and the footer line. Stages render into its work area. The dock holds Agent and Details; the viewer adds Review.
- **Agent dock.** The Agent chat is no longer a modal. Its conversation state lives with the project so it survives stage changes.
- **Front door.** The start dialog, the Trailer House panel and the brief form are replaced by one screen plus Agent actions ("Pitch three loglines", "Quick teaser"). The existing start, interview, brief-draft, plan and fit endpoints stay; the brief is drafted by the Agent and approved as a level rather than locked before the interview. The rule that blocks the interview on an unlocked brief is removed.
- **Story plan levels.** The story plan gains an explicit approval state per level (brief, acts, scenes, story beats, shot list). Approving a level is one command that also assigns and fixes that level's codes.
- **Name locking.** One domain rule decides whether a name may still change: a code is editable until its level is approved, never after; a title is always editable. Every screen reads names from the project history. See ADR 0010.
- **Notion.** The key moves from an environment variable to a server-side setting entered in Settings, with the environment variable kept as a fallback. Writing codes to Notion becomes conditional on a key. The template's public address is a setting shown on the front door.
- **Prep intake.** One intake command takes many images and returns a proposed sorting (character, location, prop, unplaced) for the operator to accept or correct. A second reads the story plan and returns named things with no reference. Sheets are made through the CastKit and ONE SHOT skills held in the app, behind the existing price card.
- **Drop rules.** One resolver answers "what does dropping X on Y mean" (new take, move to scene, source image, add to selection, nothing) so the grid, the canvas and the outline behave the same.
- **Groups.** Selecting shots and pressing G creates a group. A scene is a group with a scene code. Existing board groups carry over.
- **Selection.** The existing ordered review sequence becomes the selection strip: explicit order, an auditioned take per entry that defaults to the pick, and Push to make a cut. Auditioning never writes a pick.
- **Viewer.** A single take plays through a plain video element on its 480p proxy. Frame previews come from a low-res strip made per take at ingest, the way Review Room makes its sprite.
- **Timeline loading.** The frame-bank loader plays once the clips at the playhead are resident, loads ahead of the playhead, and keeps proxies in the browser's storage keyed by take so a second open does not download. Before a clip is resident its poster is shown.
- **Review Room sync.** A poller reads the project's changes feed every 10 seconds while a project is open and on window focus, and applies status, pick and exclusion with latest-change-wins per shot. Local changes are written at once; a failed write is kept, shown and retried. The manual sync control is removed. See ADR 0008.
- **Review Room additions** (in its own repository): the open project, folder, asset and version become part of its address; a locked folder shows a link to its project here; a read endpoint returns an asset's notes with timecodes.
- **Voice.** A voice layer turns speech into chat text and chat replies into speech through OpenAI's voice API. It sits in front of the existing Agent chat endpoint and never answers on its own. It is absent when no key is set. See ADR 0009.
- **Prompt view.** Prompts are stored and shown by the sections their skill defines (Ghost for video, ONE SHOT for images), with the skill's QC result. A hand-edited prompt is still kept as edited.
- **Render record.** The record of a generation sent from a shot grows into the record of a render: its state (drafting, to approve, approved, queued, rendering, done, failed, refused), render provider and model, settings, the take it answers, the requested change, the notes it answered, the prompt before and after, the still and references it reuses, the confirmed price, the provider's job id and answer code, and its times. New fields are optional so stored projects still load. Renders are stored on the project.
- **Reuse.** A re-render's request is read from what the app recorded when the earlier take was sent, or, for a take brought in from Higgsfield, read back from Higgsfield by its job id. A take with neither cannot be re-rendered, and the panel says why. Renders from now on record their still and references so every later take can be reused.
- **Prompt change.** One server command gives the Agent the skill's own text, the earlier prompt by section, the shot spec, the requested change and the shot's open notes, and asks for the changed sections only; they are applied section by section, so everything else stays as written. The skill's check runs on the result, with one more ask if it finds something. A pure function compares before and after by word for the highlight. The Agent can only propose: no command it can reach approves, prices or confirms.
- **Render providers.** One interface: is it set up (and why not), price, send, check, cancel. Higgsfield through its CLI (the adapter that exists, without `draft`), fal.ai through its queue and pricing addresses, SwarmUI on the desktop as a listed placeholder. Cost keeps the provider's own unit: credits or dollars.
- **Confirm.** Approved entries are priced together; Confirm carries the price shown, and the server refuses any entry whose price has risen, whose check is not clean or whose still is under 2K, before anything is sent. Confirm is what starts a run; nothing else can.
- **Trigger.dev.** One project for this app on the operator's instance; one task that carries a render from queued to done or failed; one queue per render provider with its own limit; a run per render, keyed by the render so it cannot start twice, tagged with its project. The task calls this app to send and to check; the app answers a repeated send with the job it already started and refuses a report from a run that is out of date. A send is never retried automatically. See ADR 0011.
- **Landing.** A finished render's file is collected by the app and recorded as a take with where and how it was made. A re-render does not become the pick and is stored in Review Room as the next version, not the current one. "Make a take" goes out through the same path and keeps making its result the pick.
- **Queue view.** A third view of the Shots stage: a table built with TanStack Table, one fixed-height line per render, sortable by any column, with the detail of the selected line in the dock. Rows follow the project's record; Trigger.dev's live updates only make them move sooner.
- **Draft and Finalize.** Sends no longer ask for a draft; the Finalize action, the draft window and their notes are removed. Resolution is one of 480p, 720p and 1080p.
- **Look.** Design tokens are replaced with the set in DESIGN.md. The old tokens are removed once no screen uses them.

## Testing decisions

A good test here states what the operator can observe, through the highest seam that shows it, and does not reach into component internals.

- **Domain rules** (pure functions, the existing domain test folder): name locking, what a drop means, selection order and auditioning, latest-change-wins merging, mapping old workspace tabs to stages, sorting an intake result into kinds.
- **Server commands** (the existing integration and server test folders, with a fake fetch as the Review Room and Notion tests already use): approving a level assigns codes once and only once; the poller applies a changes feed and retries a failed write; Notion writes are skipped without a key; the voice layer forwards text to the Agent and never answers itself.
- **UI regressions** (the existing UI test folder): no control label wraps; selecting a shot does not change the grid's layout; no element in the shell has a border or outline other than the focus ring.
- **Render queue rules** (domain tests): which moves a render's state allows; one open re-render per take; what may be confirmed; totals per provider; where a re-render's request comes from; the word-level highlight; the colour of an answer code.
- **Render queue commands** (server tests with a fake provider, a fake model and a fake Trigger.dev client): the prompt change touches only the sections asked for and is checked; Confirm refuses a risen price and sends nothing; a repeated send returns the same job and spends once; a stale report is refused; a finished re-render lands as a take that is not the pick; a refused render returns to "to approve". No test spends: a real Confirm is exercised once, by the operator's word.
- **In the browser** (the project's preview server, by the agent doing the work, with a screenshot as proof): each slice is walked through on the local test copy at desktop and phone width before it merges.
- **Playback** is checked by measurement: time from Space to first frame in the viewer, and time from opening a 60-clip timeline to playing, recorded before and after.

## Out of scope

- Restyling Review Room itself.
- More than one operator, accounts, or per-user Notion keys.
- A phone-first layout. Screens must not break at phone width, but the phone experience is not designed here.
- Redesigning Prep's reference-making flow beyond intake, sorting and suggestions.
- Changing how cuts, sound mixing, export or QC work. Cut only moves into the shell in this pass.
- Webhooks from Review Room; polling is used until it has them.
- Re-rendering a still, cloud ComfyUI, and a working SwarmUI provider (it is listed as a placeholder).
- Carrying a 480p take to 1080p with the same motion. A higher-resolution take is a new render.
- Ticking off in Review Room the notes a re-render answered; that needs an addition there.
- A render queue across projects.

## Further notes

- The Cut stage has no mockup yet; it is mocked when its slice begins.
- Hosted Studio serves media through its gateway with caching off. Whether proxies and frame strips can be cached there is measured in slice 1 and decided then.
- The mockups use invented take file names and two invented logline titles.
