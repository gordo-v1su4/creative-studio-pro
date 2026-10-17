---
name: story-interview
description: Turn a rough story idea into a filled Creative Studio Pro series in Notion, in three short rounds at most. Use when the user has an idea for a show, season or episode and wants it structured (Save the Cat season, TV-episode acts, scenes), or says "story interview", "structure this idea", "start a series".
---

# Story interview

Rough idea in, filled Notion series template out. Short and directed: assume the standard structure, decide what you can, and ask only about real gaps. Never a drawn-out interview. Read `CONTEXT.md` for the words (Story beat, Structure, Section, Scene, Shot) and use them exactly.

## Steps

1. **The idea.** Take the user's one or two sentences. If there is none, ask once: "Tell me the idea in a sentence or two."
2. **Three directions.** Offer exactly 3, each a logline plus a twist (the hidden contradiction that turns the story), plus format (episodes × minutes). The user picks one or blends; don't proceed without that pick.
3. **Fill it yourself.** For the picked direction, write:
   - the **season** in **Save the Cat**: one story beat per section (Opening Image … Final Image; the list is in `src/lib/domain/structures.ts`), each a single sentence where one thing clearly happens, with the episode it lands in;
   - **each episode** in the **TV episode** structure (Teaser, Act 1, Act 2, Act 3, Tag): title, summary, mid-episode twist, cliffhanger, and its scenes (title, section, location, summary, characters, the story beats it carries).
   Do not write shots unless asked; shots come later (Fit to length writes them).
4. **Ask only the gaps — at most 3 rounds.** Group every genuinely undecided point (who the antagonist is, what the twist reveals, how the season ends) into one numbered round with your recommended answer for each, like the grilling skill. Anything with a sensible default, decide and state it. Stop asking after round 3 and go with your recommendations.
5. **Write it to Notion** (Notion MCP or API), under the user's *Creative Studio Pro* page, by duplicating the *Series Template* page and filling:
   - **Story** page: logline, twist, format, characters (prose; this stays Notion-only).
   - **Story Beats** database: `Beat` (title), `Section` (select, a Save the Cat section), `Order` (number), `Summary`, `Episode` (relation), `Scenes` (relation).
   - **Episodes**: `Title` ("EP01 — Title"), `Episode #`, `Season`, `Summary`, `Mid-Episode Twist`, `Cliffhanger`, `Scenes`.
   - **Scenes**: `Scene` ("P01 — Title"), `Scene #`, `Episode`, `Section` (Teaser / Act 1 / Act 2 / Act 3 / Tag), `Summary`, `Location`, `Characters`, `Timecode` (e.g. "Act 1 · ~1:30").
   Never write show codes, scene codes, shot numbers or target length: the app owns those.
6. **Hand back.** One short summary: the logline, the 15 season beats in one line each, the episode list, and the link to the new Notion page. Then: "Connect it on the Series page and import an episode."

## Rules

- Story beats are story events, never musical beats. Say "story beat", never "beat" alone.
- Keep every beat and scene summary to one or two sentences; the writer edits in Notion.
- No word the project's rules ban (check `PROMPT-RULES.md` or the brief's must-nots if the project has them).
- If Notion isn't reachable, write the same structure as a Markdown file in the repo's `docs/` and say so.
