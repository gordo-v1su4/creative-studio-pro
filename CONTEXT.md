# Creative Studio Pro

A production studio for short films and trailers: story beats are generated as images and video, reviewed on a board, assembled into cuts, given sound, and finished.

## Language

### Board

**Beat**:
One moment of the story, shown as a card on the board.
_Avoid_: Shot, card (in prose), slot

**Take**:
One generated clip or still attached to a beat; a beat can hold several.
_Avoid_: Asset, alternate, version

**Pick**:
The take currently chosen to represent its beat.
_Avoid_: Selected take, active take

**Spine**:
The story order of the beats, set by how they are connected on the board.
_Avoid_: Timeline, master cut, sequence

**Benched**:
A beat that keeps its place on the spine but is skipped wherever the spine is played or assembled.
_Avoid_: Deactivated, disabled, hidden

**Selection**:
The beats shift-clicked on the board, in click order, previewed together before anything is kept.
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

### Finishing

**Draft**:
A low-resolution take (480p) used for review; it can be finalized to full resolution from the same render for a limited time.
_Avoid_: Preview, proxy, temp

**Finalize**:
Re-rendering a draft at full resolution from the same generation, keeping its motion and timing.
_Avoid_: Upscale, up-res (those are different processes)
