Write the SEEDANCE PROMPT in the Seedance 2.5 format used on Higgsfield: an opening line, then four sections. Each section starts with its heading in capitals on its own line, with a blank line between parts. Plain text, no Markdown.

Opening line: Create a {{SECONDS}}-second, {{ASPECT}} cinematic live-action <genre> teaser for "<TITLE>".

REFERENCE AND CONTINUITY
First the declarations, one per line: "@Image_1 = <exact full name> — definitive identity lock" for each reference image (a place: "@Image_2 = <the place's name> — exact location lock for every shot"), then "No image: <exact name> — <one fixed line>" for every other character and place in the teaser. An audio or video reference gets its one job: "@Audio_1 = <the track> — master track: keep the original audio from @Audio_1 unchanged, precise lip sync", "@Video_1 = <the clip> — motion, camera and timing only". A character sheet carries the look, so never re-describe that character. Then the continuity locks: props that stay put ("the cup stays in Kai "Hoodie" Santana's left hand throughout"), wardrobe that never changes, screen direction.

STORY AND TONE
A short paragraph: who, where, what happens, what is at stake, and the tone, including what the performances must not do.

The timeline: sections covering all {{SECONDS}} seconds in continuous ranges with no gaps or overlaps, each starting on its own line as "[00:00–00:04] — <SECTION NAME IN CAPITALS>". Inside each section, short paragraphs in shot order:
- each shot: framing and angle, the camera move, one concrete action, the light;
- "Hard cut." on its own line between shots, so every cut is a real cut;
- one written shot per cut: fast cutting needs every cut written, or the model pads with filler;
- each sound at the moment it happens, as its own short sentence ("The beat drops." / "The music cuts completely. Only rain and the engine turning over.");
- slow motion only as a labeled moment ("MICRO SLOW-MOTION HOLD: …"), then "snap back to full speed";
- the silence beat, written where it falls;
- dialogue as its own block in the section where it is spoken: one line "<SPEAKER NAME>, <where they are or who they speak to>, <delivery>:" and the words in quotes on the next line, then the listener's reaction if any.
The last section ends on the title: "Hard cut to black." then Title: "<TITLE>" (the title in quotes) then the final sound.

VISUALS AND SOUND
The global look (photoreal live action, optics, flares, grain, palette, production design), the camera coverage rules and the exact number of slow-motion accents. Name the palette in positive colours. To keep a colour or object out, count it ("Count of green elements after 00:04: zero") instead of repeating "no green", which plants the word. Then the sound: the score or "no music", the ambience, the effects, and the mix ("duck the music beneath dialogue"); with an @Audio_1 master track, describe no new score. Then the dialogue rule: "Speak only the <N> scripted lines, verbatim, with natural delivery and synchronized mouths. No narration or additional dialogue. No subtitles. Only the final title appears onscreen."

Naming rules (the app's prompt linter checks every one of these, and the prompt is fixed until it passes):
- Declare every character and every place before the story uses them, one per line: "@Image_1 = <exact full name> — definitive identity lock" for anything with a reference image, and "No image: <exact name> — <one fixed line>" for everything else (for example "No image: Drexler — the crew boss, heavyset, dark oilskin coat" or "No image: the car deck — the ferry's sealed lower vehicle hold").
- After that, call each of them only by the exact declared name, in full, every time. Never a first name alone, never a pronoun (he, she, they, him, her, his, their, them…), never a stand-in for a person (man, woman, girl, boy, kid, guy, person, people, figure) or a place (room, building, store, shop, interior, storefront, place, location).
- Words inside quotation marks (dialogue, the title) are exempt.
- Never describe a referenced character's face, hair or clothing. The one exception is a storyboard grid used as the reference: a grid doesn't hold a look the way a sheet does, so put the look in that reference's declaration line, after the dash, and nowhere else.
- Never write a banned word, not even as a negative ("no X" still plants it).
- Nothing is black and white.
