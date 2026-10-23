# Multi-shot grammar: real cuts inside one generation

Adapted from `references/multishot-grammar.md` in [gordo-v1su4/seedance-2.0](https://github.com/gordo-v1su4/seedance-2.0) (MIT, © 2026 Iamemily2050, last verified there 2026-06-09). The worked shapes are rewritten to follow this skill's naming rules. Labels: [official] = ByteDance or fal docs, [field] = practitioner-reported.

## The grammar [official]

Label every cut. Seedance 2.0 uses `Shot 1:` / `Shot 2:` / `Shot 3:` in plain prose; Seedance 2.5 uses `Hard cut.` on its own line between shots inside its timeline sections. The labels are what give the model cut points: long unlabeled prompts tend to render as one continuous take. Per shot: one primary action and one camera move, plus its sound. Order inside a shot: subject and action, then camera, then sound.

## The budget [official]

Shots cost seconds.

- **2.0:** plan about 4–6 s per shot. Two shots want about 10 s, three want 12–15 s. Ask for four shots in 5 s and the model compresses or skips beats. Below about 10 s, multi-shot starves the beats.
- **2.5:** the budget is wider (up to 30 s), but every cut still needs its own written shot. Fast cutting at 15 s wanted about 20 written shots on Blood Rush; with too few, the model pads with filler.

## Requirements [official + field]

- **Standard tier [field].** fal documents the same multi-shot schema on fast endpoints, but field reports say fast tiers don't reliably honor multi-shot, slow motion or dolly moves on the first try. Iterate on Fast, judge on Standard.
- **2.0 at 10–15 s or `auto` [official].** `duration: auto` lets the model size the clip to the prompt; set an exact duration only when the edit demands it.

## Timestamps [official + field]

- **2.0:** `Shot N:` labels are the structure. Timestamps only as hints inside a labelled shot ("at 5 seconds…"), never as bracketed `[0–6s]` blocks replacing the labels.
- **2.5:** continuous whole-second ranges are the structure (`[00:00–00:04] — SECTION`), with `Hard cut.` between the shots inside them.
- Chinese surfaces (Dreamina/Jimeng) use a bracketed timeline (`【时间轴】0-3s: …`) as the skeleton. Match the active surface, and never mix two skeletons in one prompt.

## Dialogue and audio placement [official + field]

A spoken line goes inside the shot where the speaker is on screen, in quotes, short. Name each shot's specific sounds: they anchor the audio pass. Audio is generated per call, not across calls, so a piece made of several generations gets its unifying score in the edit.

## The single-take alternative [official]

For an unbroken take, say so: "single continuous take, no cuts". Otherwise a long action description may get cut up. Continuous takes use phases and no hard cuts; never mix the two contracts in one prompt.

## Worked shapes

*Three-shot product beat (2.0, about 15 s):*

```
No image: the bottle — a ribbed glass soda bottle beaded with condensation
No image: the rooftop — a tar-paper city rooftop at sunset
Shot 1: extreme close-up of condensation sliding down the bottle, ice clinking.
Shot 2: the bottle rises out of crushed ice, the camera tilting up into a backlit halo.
Shot 3: a hand closes around the bottle against the sunset on the rooftop, the city humming below.
```

*Two-shot dialogue beat (2.0, about 10 s):*

```
No image: Detective Hale — a rain-soaked detective in a grey overcoat
No image: Wren Calloway — a commuter in a red raincoat
No image: the platform — a night train platform under a stuttering sodium lamp
Shot 1: close on Detective Hale under the stuttering lamp on the platform, rain on the overcoat; Detective Hale says quietly, "You were never on that train."
Shot 2: Wren Calloway's face as the train doors close behind Wren Calloway, a half-smile; the departure chime swallows the silence.
```

## Failure → fix [field]

| Symptom | Fix |
|---|---|
| Renders as one continuous take | clearer `Shot N:` labels or `Hard cut.` lines · fewer shots · Standard tier |
| A shot's action skipped or compressed | fewer shots · more seconds or `auto` · one action per shot |
| Cut lands mid-action | end each shot on its completed beat; let the next shot open the new one |
| Atmosphere breaks between shots | declare the persisting effect once for the whole piece: "thin mist throughout, every shot" |

## Sequence boundary

Multi-shot grammar is cuts inside one generation. Planning several connected generations is a different job: never paste a later clip's shots into the current prompt. If a beat belongs to a later generation, leave it out.
