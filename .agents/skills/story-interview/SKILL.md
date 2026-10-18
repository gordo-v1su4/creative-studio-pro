---
name: story-interview
description: Turn a rough story idea into a filled Creative Studio Pro series in Notion (template v3), in three short rounds at most. Use when the user has an idea for a show, season or episode and wants it structured (Save the Cat season, TV-episode acts, scenes with Action and Dialogue), or says "story interview", "story pass", "structure this idea", "start a series".
---

# Story interview (template v3)

Rough idea in, filled Notion series out. Short and directed: assume the standard structure, decide what you can, and ask only about real gaps. Never a drawn-out interview. Read `CONTEXT.md` for the words (Story beat, Structure, Section, Scene, Shot, Reference, Handle) and use them exactly. The decisions behind this are in `docs/planning/series-production-v3.md`.

## Scope

- **Whole season:** the season's story beats (Save the Cat) and an **Episode outline** for every episode.
- **Only the episode being made:** its scenes, each with **Action** and **Dialogue**. Other episodes get outlines, not scenes.
- **Never:** shots (Fit to length writes them later), show/episode/scene/shot codes, Locked, target length. The app owns those (ADR 0002).

## Steps

1. **The idea.** Take the user's one or two sentences. On an existing series, read it first (Notion, or `read_series` in the app's Agent panel) and start from what is there.
2. **Three directions** (new series only). Offer exactly 3, each a logline plus a twist (the hidden contradiction that turns the story) plus format (episodes × minutes). The user picks one or blends them. Don't go on without that pick.
3. **Fill it yourself.**
   - **Season story beats:** one per Save the Cat section (the list is in `src/lib/domain/structures.ts`), each a single sentence where one thing clearly happens, with the episode it lands in.
   - **Each episode:** title, summary, mid-episode twist, cliffhanger, and its **Episode outline**: the main story points in order, each tagged with its section (Teaser / Act 1 / Act 2 / Act 3 / Tag), flashbacks marked "(flashback)".
   - **The episode being made, scene by scene:** a name-only title ("Morning Quad", never "P01 — …" or "010 QUD — …"), **Scene #** in tens (10, 20, 30…), section, location, characters, a one- or two-sentence summary, and:
     - **Action:** what happens, in order, one numbered line per moment; concrete and filmable.
     - **Dialogue:** one line each, `SPEAKER (delivery): "line"`, in the order spoken. Write it with script craft: subtext over statement, setups that pay off later, short lines, each character sounding like themself, a twist line where the scene turns. No line is filler.
     - **Links:** the season story beats the scene carries, and its **References** (characters, the location, props) by their exact names.
4. **Ask only the gaps, at most 3 rounds.** Group every undecided point (who the antagonist is, what the twist reveals, how the season ends) into one numbered round, with your recommended answer for each, like the grilling skill. Decide anything that has a sensible default and say what you chose. After round 3, stop asking and go with your recommendations.
5. **Write it to Notion.** Write only after the user agrees to the structure.
   - **In the app's Agent panel** (web or phone, any model): call `read_series`, then `write_story_beat`, `write_episode_outline` and `write_scene`. They check the rules (names only, tens, dialogue format, this episode only, no codes) and refuse anything wrong, so fix it and retry.
   - **In any other chat with a Notion connector** (Kimi desktop's Notion plugin, Claude): under the user's *Creative Studio Pro* page, in the series' databases:
     - **Story Beats:** `Beat` (title), `Section` (Save the Cat select), `Order`, `Summary`, `Episode`, `Scenes`.
     - **Episodes:** `Title` (name only), `Episode #`, `Season`, `Summary`, `Episode outline`, `Mid-Episode Twist`, `Cliffhanger`.
     - **Scenes:** `Scene` (name only), `Scene #` (`010`, `020` … as text in v3), `Episode`, `Section`, `Summary`, `Action`, `Dialogue`, `Location`, `Characters`, `References` (relation).
     - Never fill `Show code`, `Episode code`, `Scene code`, `Shot code` or `Locked`.
   - **Without Notion:** output the same structure as Markdown (season story beats by section, episode outlines, then the episode's scenes with Action and Dialogue) and say so.
6. **Hand back.** One short summary: what was created or updated, each with its Notion link. Then: "Run Sync on the Series page; Fit to length writes the shots from Action, Dialogue, story beats and References."

## References and handles

- A **Reference** is a named image of a character, location or prop. Its **Name** is the exact string printed on the image (`Kai "Hoodie" Santana`). Use that exact name in Action and Summary, never a nickname or a first name alone.
- Handles (`@Kai`) are for shot prompts, which Fit writes. Story fields use exact names.
- Only link references that exist in the series' References database. If a character has no reference yet (a new character such as Bryce), say so in the hand-back so the operator can add one.

## Rules

- Story beats are story events, never musical beats. Say "story beat", never "beat" alone.
- Keep every story beat and scene summary to one or two sentences; the writer edits in Notion.
- "Scene", never "sequence".
- No word the project's rules ban (check `PROMPT-RULES.md` or the brief's must-nots if the project has them).
- Respect holds the operator set (for Blood Rush: the P01 "2:47 AM" teaser is on hold; don't rewrite it).
