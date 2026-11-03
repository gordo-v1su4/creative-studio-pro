# Too Perfect: handoff (2026-11-02)

A new show, separate from Blood Rush. Everything for it lives in `data/projects/too-perfect/`. Only the text is in git.

**Images are on the server.** The 23 main images are in Review Room (https://review.v1su4.dev), project **Too Perfect** `ks75drxa63detat0ycy3d0mv9d8hgsrs`, in four folders:
- Character Sheets
- Character Sheets (labelled)
- Locations
- Shot Grids

Every file's asset and version ID, and how to download one, are in `REVIEW-ROOM.md`. The full local set (595 MB, including rejected takes) stays on the Windows desktop. The Higgsfield CDN links below are a public fallback for the 11 main references.

## The show

An elite coed college cheer squad, the Cardinals, set in 2001, is suddenly too good. Its secret is the lead's blood.

- **Rafa Quiñones:** the lead, an attractive "stud chulo" tumbler. His blood is the drug.
- **Tess Lindqvist:** the flyer who is breaking.
- **Marcus Hale:** the college president's son, a base on the squad, and Rafa's secret love interest. He reads as straight; Brooke is his cover.
- **Brooke Ashby:** Marcus's public girlfriend. She knows she's the cover.
- **Coach Lorraine Duvall:** knows everything.
- **The twist:** the squad hasn't aged since 1998. Rafa is in the 1998 team photo with the same face.

The story beats and the misleading-trailer plan are in `FLASH-CUTS.md`.

## Rules the user set (keep them)

- **The dose is clinical, like IV therapy.** Rafa gives blood like a donor: a tourniquet or elastic band, a needle in the crook of the elbow, a cotton ball and bandage. The squad takes it by drip: a line taped to the back of the hand, a bag hung from a locker door, everyone scrolling their phones like it's a vitamin session. Never a mouth on a wound, never sucking a bleeding finger.
- **The fake fall is one base** at the bottom of a pyramid buckling a knee on purpose, so the stunt folds and the flyers are caught. It's never the whole squad falling at once. Coach Lorraine's line: "Worse. Do it worse."
- **The cheer must look real,** like Netflix's *Cheer*: coed, strong male bases, blue spring floors, motion blur on all action.
- **The look:** dark, a cold green fluorescent tint from ceiling tubes only. Little haze. Never warm amber or yellow light (the party yellow was awful). Lens wording is just "anamorphic lens". No fake flares.
- **Images:**
  - Grids and sheets are always 16:9, never square.
  - On GPT, add "the nine stills butt edge to edge … with no borders, gutters, gaps or white lines".
  - Every sheet gets a labelled copy: upper left, a bold name over "year · role · cm · kg".
- **Words:**
  - Never write the word "neon".
  - Nobody wears a white hoodie.
  - References must be at least 2K.
- **Git:** after every chunk, commit and push straight to `main` (cloud sessions too) so nothing is left only in the cloud.
- **Video renders: 480p only, always,** until the user says to move up to 720p. Never 720p or 1080p before that.
- **Teaser prompts:** use the character sheets and location plates as references. Grids are at most a loose reference, and the prompt never describes what's in them (no overhead twist, no yelling, no bleeding from the grids); tell new beats instead. That's what has worked best.
- **Credits:**
  - Paid renders need the user's OK with the cost shown.
  - Nano Banana Pro on Higgsfield Unlimited (toggle on) is free and needs no OK, but only until about 2026-11-17; after that it's paid like everything else, so show the cost.

## Models

- **GPT Image 2.5 Sunburst** (~2.75 credits per image) gives the best grids and sheets, with no gutters. Its filter is strict: blood drops, nosebleeds, teeth, tourniquets and "bag of blood" got flagged, and blocked renders are refunded.
- **Nano Banana Pro** (free on Unlimited) accepts the IV and blood shots, but adds thin white gutters.
- **Prompt formats:**
  - Nano Banana Pro and grids use the nano-banana-pro format, linted with `--target nano_banana`.
  - Video uses Seedance 2.5 (the seedance-higgsfield format), linted with `--target seedance`.

## Reference images (upload these, in the order each prompt declares)

All are 2K+ PNGs on Higgsfield's CDN. They are listed in `prompts/grids/ref-urls.txt`:

| Ref | URL |
|---|---|
| Rafa sheet | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/ecd38fd0-72be-445f-bdbe-1c38a4b92215.png |
| Tess sheet | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/a8f746d0-45b9-486e-85e4-e6d8a2b38f5b.png |
| Marcus sheet | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/af814e1c-cbc3-4b19-8fe6-ff0013a0c988.png |
| Lorraine sheet | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/9da8f61d-f4b9-436e-9532-9a3c466e9b6f.png |
| Brooke sheet | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/68f0aa79-dafd-4d7b-a86f-b2165a762ac9.png |
| Gym plate | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/51fbd86b-6b85-4f28-891e-6954bb13bbd9.png |
| Locker room | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/f7844127-f03b-4034-b2b9-bbf0e87f8283.png |
| Coach's office | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/aa266191-99c4-41aa-a2ec-7ce025a66c8e.png |
| Dorm hallway | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/356fe370-7303-472e-b369-4cc0a61fc52f.png |
| Gym roof | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/6404a432-8d66-42a9-9c73-5c0a79509755.png |
| Parking lot | https://d2ol7oe51mr4n9.cloudfront.net/user_2x2ysOb5q5Tw0qQqsK66mA3mJ9U/5becec7b-14d2-404d-baa1-c3da34954d9f.png |

## Where things stand

- **Grids (Higgsfield job ids; the keepers are in Review Room's Shot Grids folder):**
  - Body:
    - GPT `6d86463a` is the stripped, GPT-safe version.
    - NBP `6b9dc8ea` has the IV bag and the blood drop, with gutters.
  - Squad: GPT v3 `b269d90a`. The pyramid folds into the catchers and there are no gutters.
  - Marcus (`grid-3-marcus-v2.txt`) and twist (`grid-4-twist-v2.txt`): GPT v2 renders, not yet reviewed. Download them with `hf generate list --image`.
- **Teasers (Seedance 2.5, lint-clean, not yet rendered):**
  - `teasers/too-perfect-teaser-15s-v1.txt` (upload order: Rafa, Tess, Marcus, Lorraine, gym).
  - `teasers/too-perfect-teaser-30s-v1.txt` (upload order: Rafa, Tess, Marcus, Lorraine, Brooke, gym).
  - Render them on Seedance 2.5 at 16:9, 720p or higher, as a draft first. Get the user's OK on the cost before sending.

## Next

1. The user renders the 15 s and 30 s teasers, or asks for changes to them.
2. Pick keeper panels from the grids, and crop them out at 2K.
3. Review the Marcus and twist grids.

## Status check (2026-11-03, cloud session)

- All four prompts lint clean: both teasers (`--target seedance`) and the Marcus and twist v2 grids (`--target nano_banana`).
- **Teaser render cost (Seedance 2.5, omni_reference, 16:9, 720p, audio on):** 15 s = **105 credits**, 30 s = **210 credits**. Balance 2,808.53 (Creator plan). Seedance 2.5 isn't on Unlimited. Not sent yet: needs the user's OK.
- **Grids still to review:** Marcus GPT v2 `aebde844`, Marcus NBP `7257b390`, twist GPT v2 `1f0baac7`, twist NBP `7b984a97` and `2a2990bd`. They're shown in the Higgsfield widget. The cloud container can't fetch the CDN or Review Room (network policy blocks `d8j0ntlcm91z4.cloudfront.net` and `review.v1su4.dev`), so the user reviews them, or those hosts get added to the environment's allowed domains.
- **Reference media IDs on Higgsfield** (for the teaser `medias`): Rafa `ba09dd36-9d96-4ca4-9a7c-05fd819c3e54`, Marcus `fa0cfd0a-b357-41e0-af34-0945dcd6cf17`, Brooke `7a2266f1-0d4a-47be-abb3-cfe6a888d089`, Lorraine `54fd0468-cb77-4754-9aac-ac55e48d2b20`, gym `06fe006f-82cf-46ed-a224-d763af4e0546`, parking lot `89d22504-a545-47ce-a80c-e3e428c2cc2f`. Tess still needs an upload or lookup.
- **Teasers sent to render (user OK'd, 315 credits):** 15 s job `d7db05f1-316b-4185-b2e5-c30193e33e82`, 30 s job `5c8875ff-74a2-4e06-8edb-a711410d9660`. Settings: Seedance 2.5, omni_reference, 16:9, 720p, audio on, prompts verbatim from `teasers/`, Higgsfield's "IN THE DARK" preset turned down. Tess's reference media ID is `cd1934ae-8a91-4123-b90c-f9d41f66327b`. Next: check them with `jobs_wait` or `show_generation_by_ids`, review, then revise.
- **Superseded:** the 30 s v2-grids render `bdd60c8f-da2c-4d78-9cac-00ba138a5206` went out at 720p (210 credits) before the user's correction; the 15 s v2 was denied. The v2-grids prompts describe the grid panels, so they're dropped.
- **Now:** `teasers/too-perfect-teaser-15s-v3.txt`, new beats, lint-clean. References in order: Rafa `ba09dd36-9d96-4ca4-9a7c-05fd819c3e54`, Tess `cd1934ae-8a91-4123-b90c-f9d41f66327b`, Marcus `fa0cfd0a-b357-41e0-af34-0945dcd6cf17`, Lorraine `54fd0468-cb77-4754-9aac-ac55e48d2b20`, gym `06fe006f-82cf-46ed-a224-d763af4e0546`, locker room `2fdbaabe-19a0-43f4-b95e-859f695197d6`, coach's office `1f50ffd4-ee6c-4906-8f0e-61f6bf6977b7`. Render at 480p once the user OKs it.
- Other location media IDs: dorm hallway `c23fe497-f6fe-4e72-aa39-d996af88cb68`, roof `1f9e7ceb-7656-4236-b9af-2dd2edccd416`, parking lot `89d22504-a545-47ce-a80c-e3e428c2cc2f`, Brooke `7a2266f1-0d4a-47be-abb3-cfe6a888d089`.
- **Rendering at 480p (2026-11-03):** 15 s v3 `1fa2cc6a-b8ae-43b4-a525-16f452b8e5e9`, 10 s moment "the cover" (Brooke, Marcus, Rafa: parking lot, dorm hallway, roof) `edfb8a14-ca01-4281-9526-559030e96ffa`, 10 s moment "Nationals" (Tess, Rafa, Lorraine: gym, locker room) `191f31ce-62d2-4d84-91e8-1fe43350163d`. Prompts are in `teasers/`. References are sheets and plates only, with new beats.

## In the app (2026-11-03)

Too Perfect is now a Notion series made from the Series Template: https://app.notion.com/p/40d8a0067650816bb8efd7306e3fcbdd (under Creative Studio Pro).
- **Season 1 Story:** logline, world, cast, the rules, the ladder, and a "Production rules (learned)" section, all read by the app's Agent.
- **References:** the 5 characters (labelled sheet file names) and 8 locations.
- **Episode 0 "Teaser":** three scenes (The Drawer, The Cover, Nationals), one shot each, with the render job IDs and prompt files in Notes.
- **To finish in the app (on the PC):** Series → paste the Notion link → Connect; upload the reference images to the series' Review Room `_References`; import Episode 0; attach the three 480p renders as takes once they're done.
- **Asked for:** a "freestyle → inject" import that doesn't go through Notion (not built yet).
