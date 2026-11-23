---
name: Creative Studio Pro — streamlined look ("B, Capitals")
status: agreed, not built
updated: 2026-11-23
supersedes: ../ux-creative-studio-pro-2026-08-22/DESIGN.md (when slice 1 lands)
mockups: https://claude.ai/artifact/GcSURykGvjJGXujETaqa1m (sources in ./mockups)
colors:
  ground: '#000000'
  panel: '#0c0c0e'
  raised: '#141417'
  control: '#1e1e22'
  selected: '#10221f'
  selected-row: '#0c1a18'
  ink: '#e4e4e7'
  ink-2: '#a1a1aa'
  ink-3: '#7c7c86'
  teal: '#7dd9c8'
  teal-deep: '#1b4741'
  teal-ink: '#cdf3ea'
  agent-pink: '#ff8adf'
  agent-purple: '#a78bfa'
  agent-purple-deep: '#2a2350'
  agent-surface: '#15122a'
  amber: '#f5b84a'
  status-needs-changes: '#ff7a6b'
  status-in-progress: '#7fb2ff'
typography:
  body: { family: 'Geist, system-ui, sans-serif', size: 12.5px, weight: 400, line: 1.35 }
  title: { family: 'Geist', size: 13px, weight: 400 }
  chrome: { family: 'Geist Mono', size: 9.5px, weight: 400, transform: uppercase, tracking: 0.11em }
  code: { family: 'Geist Mono', size: 10.5px, tracking: 0.01em }
  headline: { family: 'Geist Mono', size: 18px, weight: 400, transform: uppercase, tracking: 0.22em }
radius: { control: 5px, thumb: 5px, card: 8px, panel: 10px }
sizes: { top-bar: 34px, control: 20px, row: 22-24px, panel-gap: 3px }
---

# Design

## Character

A quiet production desk. Black ground, zinc greys, one colour (teal), and the picture as the brightest thing on screen. Chrome is set in small tracked capitals; everything the operator wrote or will read as prose is set in plain Geist. Purple and pink belong to the Agent alone.

## Hard rules

These came from four rounds of review and are not negotiable in implementation.

1. **No borders, outlines or dotted lines.** Not on cards, inputs, composers or drop areas. Structure comes from tone: panels on the ground, raised surfaces on panels.
2. **Selected is teal, never grey.** A selected or current thing gets the `selected` fill and `teal-ink` text. There is no outline ring.
3. **No solid white.** No white buttons, no large white numbers or titles. The brightest text is `ink`.
4. **Nothing bold.** Weight is 400, at most 500 for a logline title. No serif, no condensed display face.
5. **Controls hug their text.** 20px tall. No pills, no dot-in-capsule chips, no circled numbers.
6. **One line, always.** No label, status or button text may wrap. Shorten, shrink or truncate with an ellipsis.
7. **Nothing reflows on click.** Selecting, hovering or opening must not move neighbouring content. Detail appears in a fixed place (the takes band, the dock, the viewer).
8. **Sliders and playheads are tall rectangles.** Never a ball or a round thumb. Markers are rectangles too.
9. **No decorative gradients.** The only gradient is the played part of a scrub bar or waveform lane, dark teal to bright teal toward the playhead.
10. **Responsive from the start.** The three panels wrap to a column on a narrow screen; touch targets grow to 36px under a coarse pointer.

## Colour roles

| Role | Token | Used for |
| --- | --- | --- |
| Brand and positive | `teal` | The pick, approved, codes in chat, section headings, the wordmark, links |
| Primary action | `teal-deep` fill, `teal-ink` text | The one main button of a view |
| Secondary action | `control` fill, `ink` text | Everything else that is a button |
| Selection | `selected` fill, `teal-ink` text | Current stage, current scene, selected shot, pressed toggle, the operator's chat messages |
| Agent | `agent-pink`, `agent-purple` | The Agent's name and prompt mark (pink); its emphasis, proposals, tab and send button (purple) |
| Time and attention | `amber` | Timecode, note markers, awaiting review |
| Review status | amber / blue / red / teal | Awaiting review, in progress, needs changes, approved: as coloured text, with the word |

Colour never carries a status alone: the word is always there.

## Type

- **Chrome** (stages, tabs, buttons, labels, section headings, statuses, hints): Geist Mono, uppercase, 9.5px, tracking 0.11em. Tracking adds space after the last letter, so centred chrome text gets 1px extra left padding and a 1px top nudge.
- **Content** (titles, descriptions, chat, prompts): Geist, sentence case, 12–13px.
- **Codes and numbers** (shot codes, versions, timecode, durations, counts): Geist Mono, 10.5px, as typed.
- **Headline** (front door, pitch): the chrome face at 18px with 0.22em tracking.

## Layout

- **Top bar, 34px**: wordmark, project crumb, the four stages centred, Review Room state, search.
- **Three panels on the ground** with 3px gaps and 10px corners: the outline (220px), the work area (fluid), the dock (300px). Each is `panel`.
- **Footer line, 24px**: "Next" on the left, key hints on the right.
- **The work area** has a 36px header row (code, title, counts, view toggles, actions), then content, then, in Shots, a fixed 56px band.

## Components

- **Stage tab**: chrome text, 20px, no container; the current one has the `selected` fill.
- **Outline row**: 24px for a scene (code, title, count), 22px for a shot (number in its status colour, title).
- **Shot card**: frame at 16:9 with 5px corners; over it, the duration bottom-right and one upright 3×9px rectangle per take bottom-left (teal for the pick, dim for excluded); under it, title and number, then status, take count and version. No card container unless selected.
- **Hover-scrub on a card**: a 5px bar along the frame's bottom edge, teal toward a rectangular playhead, timecode in amber top-left.
- **Takes band**: the selected shot's takes as small frames, each with its version label; the pick's label is teal-deep.
- **Selection timeline**: clips sized by length in one row, a 3px scrub line above with a rectangular playhead, Play and Push to cut at the right.
- **Viewer lanes**: a strip of low-res frames, an 8px scrub bar, and a waveform, stacked, with one rectangular playhead across all three. Hovering shows a frame preview with amber timecode above the pointer.
- **Dock tabs**: Agent, Details (and Review in the viewer). The Agent tab has a purple fill and a row of slashes beside the tabs.
- **Agent message**: pink "AGENT" label, plain text, purple emphasis, teal codes. A proposal sits on `agent-surface` with its own buttons. The operator's message is a `selected` bubble, right-aligned.
- **Composer**: a `raised` block with a pink `>` mark, the input, a three-bar mic and Send. No outline.
- **Voice bar**: `agent-surface`, level shown as upright rectangles in pink, purple and teal.
- **Prompt view**: one 20px row per skill section (label in teal chrome, text truncated), with the skill's name in pink and its QC result in teal beside the title.
- **Reference row**: a 16:9 frame the same size for every kind, then exact name, handle, and state.
- **Canvas card**: the shot card at 124px on a `control`-toned tile; groups are `raised` regions with a chrome label; connections are 1px teal lines at low opacity; a dragged card lifts with a shadow and its drop target takes a teal fill.

## Motion

Short and plain: 110–180ms, ease-out. The front door's input opens into the two example groups; panels cross-fade; a shot marked by a change from Review Room pulses its status once. Nothing loops except the voice level bars. Reduced-motion is respected.
