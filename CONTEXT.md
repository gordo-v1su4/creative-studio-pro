# Creative Studio Pro

A production studio for short films and trailers: story beats are generated as images and video, reviewed on a board, assembled into cuts, given sound, and finished.

## Language

### Story

**Structure**:
The storytelling template a project follows (a TV episode's acts, Save the Cat, Three-Act…), made of named, empty sections.
_Avoid_: Format, framework, beat sheet

**Section**:
One named slot of a structure, such as Act 2, Tag, Catalyst or All Is Lost; it holds story beats but is not one.
_Avoid_: Beat, act (unless the structure calls it that)

**Story beat**:
One thing that clearly happens in this story; it sits in one section and plays out over one or more scenes, and a season or film has roughly ten to fifteen.
_Avoid_: Beat (alone), plot point, moment

**Target length**:
The running time an episode is being made to, set per episode and defaulting to the series format; it decides how much screen time each scene is owed.
_Avoid_: Runtime, episode length, duration (in prose)

**Scene**:
A run of shots in one place and time, belonging to one episode.
_Avoid_: Sequence, group (in prose)

### Board

**Shot**:
One continuous piece of picture, shown as a card on the board; the smallest unit the story is built from.
_Avoid_: Beat, card (in prose), slot, clip

**Take**:
One generated clip or still attached to a shot; a shot can hold several.
_Avoid_: Asset, alternate, version

**Pick**:
The take currently chosen to represent its shot.
_Avoid_: Selected take, active take

**Spine**:
The story order of the shots, set by how they are connected on the board.
_Avoid_: Timeline, master cut, sequence

**Benched**:
A shot that keeps its place on the spine but is skipped wherever the spine is played or assembled.
_Avoid_: Deactivated, disabled, hidden

**Selection**:
The shots shift-clicked on the board, in click order, previewed together before anything is kept.
_Avoid_: Sequence, playlist

### Cuts

**Cut**:
A saved, named, ordered set of takes with their own trims and speed ramps, made by pushing a selection; later edits on the board never change it.
_Avoid_: Comp, pre-comp, sequence, edit, timeline

**Push**:
Taking a snapshot of a selection — its order, takes, trims and ramps — and saving it as a new cut.
_Avoid_: Export, send, commit

**Trim**:
The kept span of a take, from its in-point to its out-point.
_Avoid_: Clip range, cut points (in prose)

**Speed ramp**:
A curve over a trim that speeds parts of a take up; never slower than real time.
_Avoid_: Retime, time remap, speed curve (in prose)

**Locked cut**:
A cut whose picture is frozen for sound; it can no longer be trimmed, ramped or reordered.
_Avoid_: Final cut, frozen cut, published cut

### Agent

**Agent**:
The single in-app assistant that reasons about the story, drafts beats and prompts, and makes judgment calls inside the app's rules; measurable work is never left to it.
_Avoid_: NERATE, Stage Agent, assistant, copilot, bot

**Model provider**:
Where the Agent's language model runs, chosen as an app default with a per-project override that locks once the project has run.
_Avoid_: Backend, LLM service

**Raycast bridge**:
The operator's personal model provider, routing the Agent through Raycast on the home desktop or the M3 laptop; only offered when it is connected.
_Avoid_: Bridge (alone), M3 bridge

### Stills

**Hold**:
A take made from a still by holding it for a set length, optionally with a slow push-in or fade.
_Avoid_: Freeze frame, still video

**Animate**:
Making a video take from a still by sending it to a video model as the start frame.
_Avoid_: Image-to-video (in prose), I2V

### Media

**Review Room**:
The separate app where every take's media is stored and reviewed; this app refers to those files and keeps no copies of its own.
_Avoid_: RustFS, bucket, media server (in prose)

**Series tree**:
The folders for one series (series, then episode, then scene) that this app creates in Review Room; its shape is decided here, never there.
_Avoid_: Folder structure, hierarchy

**Locked folder**:
A Review Room folder that belongs to a series tree; media can be added inside it there, but it cannot be renamed, moved or deleted there.
_Avoid_: Read-only folder, synced folder

**Shot code**:
A shot's permanent production ID: show code, season and episode, scene, shot (e.g. `BLR_101_010_0020`); a take of it adds its version (`_v003`).
_Avoid_: Shot name, asset code, clip ID

**Deliverable**:
A finished export (an episode cut, a teaser, a trailer) kept in the `_Deliverables` folder of its episode, or of the series when it spans episodes; it has its own code, such as `BLR_EP101_EPC_v002` or `BLR_S1_TRL01_v003`.
_Avoid_: Final, export (as a noun), master

**Misfiled**:
Media in a series tree whose name or folder does not match any shot; it stays visible and flagged until someone confirms where it belongs.
_Avoid_: Rejected, invalid, orphan

**Grid**:
One 4K image holding a scene's stills as a 3×3 sheet, generated together for continuity and then split into still takes; it stays attached to them as a reference.
_Avoid_: Contact sheet, storyboard, collage

### Finishing

**Draft**:
A low-resolution take (480p) used for review; it can be finalized to full resolution from the same render for a limited time.
_Avoid_: Preview, proxy, temp

**Finalize**:
Re-rendering a draft at full resolution from the same generation, keeping its motion and timing.
_Avoid_: Upscale, up-res (those are different processes)
