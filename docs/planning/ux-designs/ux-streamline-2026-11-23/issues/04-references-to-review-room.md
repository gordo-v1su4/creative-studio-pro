# 04 · TR110's references into Review Room: plan

Asked for on 2026-11-24 ("Yes, plan it") after the Prep audition showed sixteen places, props and people made in
TR110's Prep that Review Room does not hold. Goal: every reference lives in Review Room's series reference folders,
one code each, like the shots. **Nothing below has been done.** Every step that writes to Notion or Review Room
needs the operator's word first.

## How the app sends a reference today (`src/lib/server/reference-files.ts`, `uploadReference`)

- **Notion first.** A reference can be sent only if it is in the series' References database in Notion (it needs
  that page's id). Notion is the story master; the app's series record is a copy of it.
- **The picture:** PNG, JPEG or WebP; its file name must contain the reference's exact name; at least **2048 px**
  on the long edge (`MIN_LONG_EDGE`). Character and location sheets are scaled *down* to 2K PNG; nothing is ever
  scaled up.
- It lands in the series' Review Room project, folder `refs:locations` / `refs:props` / `refs:characters`, with
  the code `BLR_REF_<LOC|PRP|CHR>_<NAME>` and becomes the version in use. A later upload of the same name is its
  next version. The upload also records the reference in the series record and caches the file.

## What there is (TR110's Prep, `data/projects/01a1f301…/prep.json`)

| Reference | Kind | Picture | Ready to send | Code it would get |
| --- | --- | --- | --- | --- |
| Chapel arcade at night | Location | 2048×1143 | yes | `BLR_REF_LOC_CHAPEL_ARCADE_AT_NIGHT` |
| Chapel basement stairwell | Location | 2048×1143 | yes | `BLR_REF_LOC_CHAPEL_BASEMENT_STAIRWELL` |
| Chapel undercroft | Location | 2048×1143 | yes | `BLR_REF_LOC_CHAPEL_UNDERCROFT` |
| Video Haven | Location | 2048×1143 | yes | `BLR_REF_LOC_VIDEO_HAVEN` |
| Pool | Location | 2048×1143 | yes | `BLR_REF_LOC_POOL` |
| Campus walkway | Location | 2048×1152 | yes | `BLR_REF_LOC_CAMPUS_WALKWAY` |
| Portland woods and campus boundary | Location | 2048×1143 | yes | `BLR_REF_LOC_PORTLAND_WOODS_AND_CAMPUS_BOUNDARY` |
| Rooftop chase, blue storm night | Location | 2048×1143 (spec) | yes | `BLR_REF_LOC_ROOFTOP_CHASE_BLUE_STORM_NIGHT` |
| Amber vials | Prop | 2752×1536 | yes | `BLR_REF_PRP_AMBER_VIALS` |
| The Pledge | Character | 2048×1158 | yes | `BLR_REF_CHR_THE_PLEDGE` |
| Campus gym | Location | **1678×937** (spec) | below 2K | `BLR_REF_LOC_CAMPUS_GYM` |
| Off-campus party house | Location | **1678×937** | below 2K | `BLR_REF_LOC_OFF_CAMPUS_PARTY_HOUSE` |
| Mara's dorm room | Location | **1672×941** | below 2K | `BLR_REF_LOC_MARA_S_DORM_ROOM` |
| Portland rooftops | Location | **1344×752** (spec) | below 2K | `BLR_REF_LOC_PORTLAND_ROOFTOPS` |
| Kai rooftop run, sunset | Location | none (spec) | Notion only | `BLR_REF_LOC_KAI_ROOFTOP_RUN_SUNSET` |
| The Rush | Prop | none | Notion only | `BLR_REF_PRP_THE_RUSH` |

Left out: **Kai's sunglasses** and **College Quad** are already in Review Room. TR110 holds **duplicates** of Mara's
dorm room (curly and straight apostrophe), Campus walkway (two spellings) and the blue storm rooftop chase; each
goes once. Only four of the sixteen have a written spec (marked above).

## The plan

1. **Catch the local series record up (read only on Notion and Review Room).** Run the existing "re-check the
   series" so this Mac's record lists Lucian Vale, Kai's sunglasses and Bryson's sheet like Review Room does.
   Writes only the local record.
2. **Settle the names.** One exact name per reference, because the name becomes the code and is printed on the
   sheet: proposed as in the table (straight apostrophes; a comma instead of " - "). The operator approves or edits
   the list.
3. **Add the sixteen to Notion's References database** (Name, Kind, handle; role and scenes where known). *Writes to
   Notion.* Then re-check the series so the app sees their page ids.
4. **The four below 2K:** upscale each to 2048 with an upscaler, price shown first (*spends credits*), or remake
   them, or leave them out for now. Recommended: upscale, since the sheets themselves were approved in TR110.
5. **Send the pictures** through the app's own upload (Series page, one reference at a time, or the same call from
   a script): ten now, four after step 4. *Writes to Review Room:* each becomes v001, in use, in the right folder.
6. **Check:** list Review Room's reference folders again (read only), open Prep, and confirm each shows "in Review
   Room" with its code; the Prep audition's "only in TR110" count should reach two (the two without pictures).
7. **Specs:** the four written specs stay in TR110's Prep file for now. Where a reference's spec lives once its
   sheet is in Review Room (Notion, Review Room's metadata, or the Prep file) is a separate decision.

## Step 1 done (2026-11-25)

The series record was backed up (`data/series/archive/before-refresh-2026-11-25/`) and re-checked from Notion
through the app's own `refresh` (reads Notion, writes only this Mac's record; it keeps the Review Room links and
sheet files untouched). **Nothing changed except the check time:** Notion's References database lists the same nine
(eight characters, College Quad). So this Mac's record was never behind Notion. The gap is between **Notion and
Review Room**: three sheets in Review Room have no Notion reference, so the app cannot use them.

| In Review Room | Versions | What it probably is |
| --- | --- | --- |
| `BLR_REF_CHR_LUCIAN_VALE` | 4 (20–26 Oct) | Lucian's earlier name. `BLR_REF_CHR_LUCIAN_BLAISE` starts on 31 Oct; Notion has only Lucian Blaise. |
| `BLR_REF_CHR_BRYSON` | 1 (4 Nov) | Bryson Vane's sheet, uploaded under a short name. The app looks for `BLR_REF_CHR_BRYSON_VANE` and finds nothing, so it shows Bryson with no sheet. |
| `BLR_REF_PRP_KAI_S_SUNGLASSES` | 1 (4 Nov) | A prop with no Notion reference. TR110's Prep has the same sheet. |

Decisions these need, before step 3:

- **Lucian Vale:** leave as history, or mark it retired in Review Room.
- **Bryson:** send the same sheet again as "Bryson Vane" (it becomes `BLR_REF_CHR_BRYSON_VANE` v001), or rename
  Bryson in Notion to "Bryson" to match.
- **Kai's sunglasses:** add to Notion with the sixteen in step 3; the sheet is already in Review Room under the
  code the app would give it, so the upload would make it v002 unless it is linked instead.

**Operator, 2026-11-25:** the three were added later, outside the normal path, and should be corrected so they
match the rest (Notion's names win). Bryson's sheet becomes Bryson Vane's; Lucian Vale is Lucian Blaise's history;
Kai's sunglasses join Notion's References.

### Decided (ADR 0012): Notion stays the master, but nobody has to leave the app

Notion sets everything up: story, scenes, shots, names, references. The app never invents a name Notion does not
have. But adding something should not mean going back to Notion by hand:

- **Add in the app, written to Notion at once.** Adding a character, place or prop in Prep (or from "Found in the
  story") creates its page in Notion's References database first, with its name, kind and handle, then gives it its
  code. Notion stays the one source; the app is where the work happens.
- **A checker that finds drift.** Comparing Notion, the app's projects and Review Room, it lists anything that exists
  in one and not the others (like these three, or TR110's sixteen) and offers, for each: *add to Notion*, *link to
  an existing reference* (same thing, different name), or *mark as old*. Nothing is written without a yes.
- **Names locked by Notion.** Once a reference has its code, renaming it in the app is refused; a rename happens in
  Notion and comes through on the next check, so codes never drift.

## Risks and how they are handled

- A wrong name becomes a permanent code. Step 2 settles names before anything is written.
- Review Room is production. Every write step waits for the operator's word, runs one reference first, and is
  checked before the rest.
- The local series record is behind (step 1); uploading before catching up could miss that a reference already
  exists. Step 1 comes first for that reason.
- Upscaling can change a face or a place. Each upscaled sheet is shown beside the original before it is sent.

## Decisions for the operator

1. The name list in the table: approve or edit.
2. The four below 2K: upscale (price first), remake, or leave out.
3. Who presses: the operator on the Series page, or a script run here, one write step at a time with their word.
