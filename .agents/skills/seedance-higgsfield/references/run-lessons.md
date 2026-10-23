# What the runs taught

Operator-verified on Higgsfield, from the Blood Rush runs (2026-09) and the super-seed2 music-video work (2026-10). These are facts about the model, not style choices.

## References

- Every reference image is at least 2K on the long edge. Never HD, chat-paste copies or upscales. Resize anything over 4K before upload.
- One clean sheet per character, named exactly the same every time. The sheet carries the look, so the prompt never re-describes it.
- Give every reference one job and say what it is: identity, location, first frame, motion only, master audio. Never "combine these naturally".
- Upload order is tag order: the first upload is `@Image_1`.
- Attach an environment reference for every location in the clip. Locations described only in text drift between shots.
- Never attach an annotated reference: the model draws the annotations.
- A storyboard grid is not a sheet. Its look goes in its declaration line (the grid exception), and the prompt says "render every shot as full-screen footage; the grid itself never appears".
- On Higgsfield multi-shot, a face holds best when it's in the first shot.
- If a run is blocked by the content filter, suspect the reference images first, not the text.

## Audio references (`@Audio_1`)

- Each audio clip 2–30 s, all audio together 30 s at most. Set the output duration to the audio's length.
- When `@Audio_1` is the master track: "keep the original audio from @Audio_1 unchanged, precise lip sync to @Audio_1", and describe no new score.
- 5–10 s audio references are steadier than 20 s ones; 20 s still works.
- If the platform regenerates the audio anyway, lay the master track back on in the edit.
- Blood Rush generates sound effects and dialogue only ("no music, no score") and lays the song on in the edit, because its `@Audio_1` is a rhythm guide, not the soundtrack.

## Video references (`@Video_1`)

- Motion, camera, timing and cuts only. Say what it must not supply: people, setting, text, style, audio.

## Writing

- Name every character with the exact same full name every time, plus its reference.
- "Flicker" reads as an edit strobe between cuts, so never ask for it. Describe the edit pace instead.
- Never describe a guide line or trajectory arc: the model draws it on screen.
- Visual negations plant what they forbid. "No green" repeated three times puts green in the shot. Name the palette positively, and to keep something out, count it: "Count of green elements after 00:04: zero". Plain negatives are fine only for audio and artifacts: no music, no score, no subtitles, no logos, no watermarks.
- Tie a hard cut to something physical where you can (a tray passing the lens, steam, a fan opening): the cut lands cleaner.
- One slow-motion accent is a moment, not a style. Label each one and state the exact count.

## Named locks (when the model keeps breaking the same rule)

From the super-seed2 Cully Hill Boys dialogue scene (2026-10). When a run keeps adding extra lines, wrong eyelines, visible off-screen characters or late reactions, give each rule a capitalised name and state it once, as a lock, in REFERENCE AND CONTINUITY (2.5) or the global style line (2.0):

- **SPEECH COUNT LOCK:** the exact number of spoken lines in the whole clip and who says them ("exactly one spoken line: Horace Pike's "Pull it, Oli." at about 00:06; Cal Ainsley speaks zero words").
- **EYELINE LOCK:** where every eyeline sits ("just beside the lens, never into it").
- **OFF-SCREEN LOCK:** what stays out of frame, and how its action reads ("the kicked door stays behind the camera; each kick reads only in the two faces").
- **IN-FRAME LOCK:** what in frame never moves ("every visible door stays shut the entire take").
- **HEIGHT RULER:** relative heights, so two characters don't come out the same size.
- **EVENT TIMECODES:** reactions land in the same second as their cause, never a beat late.

Name the lock positively where you can, and count rather than negate.

## Iterating

- 480p is always a draft. Iterate on Enhanced Fast, judge on the standard model at 720p or 1080p.
- When a generation comes out wrong, change one thing per rerun, so you know what fixed it.
