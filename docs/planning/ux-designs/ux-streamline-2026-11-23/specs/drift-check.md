# Spec: the drift check, and adding references from the app

Tracked as GitHub [#28](https://github.com/gordo-v1su4/creative-studio-pro/issues/28) and Linear [V1S-506](https://linear.app/v1su4/issue/V1S-506).

Decided in ADR 0012 (Notion is the master of names, edited from the app, with a drift check). Glossary: Reference,
Drift check, Old (reference), Source image, Handle, Prep. Built in **Prep's turn** of the screen order.

## Problem Statement

The operator's references live in three places that do not agree. Notion's References database lists nine. Review
Room's reference folders hold sheets that Notion does not have: `BLR_REF_CHR_LUCIAN_VALE` (Lucian Blaise's earlier
name), `BLR_REF_CHR_BRYSON` (Bryson Vane under a short name, so the app shows Bryson Vane with no sheet) and
`BLR_REF_PRP_KAI_S_SUNGLASSES`. TR110's Prep holds sixteen places, props and people that are in neither, some
spelled two ways. A reference can only be sent to Review Room once it has a Notion page, and adding one means
leaving the app for Notion by hand, so work made in the app stays stranded in one project. Nobody can see the gap
without reading three systems side by side, and a name changed in one place silently becomes a new code.

## Solution

Notion stays the one place that says what references exist and what they are called, but the operator never has to
go there. Adding a character, location or prop in the app writes its page into Notion first and only then adds it
in the app; if Notion refuses, nothing is added. A drift check compares Notion's References, every project's Prep
and Review Room's reference folders, and the Agent posts what is out of step in its chat, one message with each
item's choices: add to Notion, link to an existing reference, or mark as old. Nothing is written until the operator
says yes, typed or by a press. A rename after a code exists is caught and never followed silently. Pictures are a
separate step: a sheet under 2048 px on its long edge is offered an upscale (price first) or a remake; a larger one
goes to Review Room as 2K and its full-size file is kept.

## User Stories

1. As the operator, I want to add a character, location or prop in Prep and have its Notion page made for me, so that I never leave the app to keep Notion the master.
2. As the operator, I want a reference added from "Found in the story" to be linked to the scene it was found in, so that Notion shows where it is used.
3. As the operator, I want the new Notion page to carry the name, kind and handle I gave, and nothing I did not give, so that Notion holds no invented text.
4. As the operator, I want an add that Notion refuses to add nothing at all and tell me why, so that no reference exists only in the app.
5. As the operator, I want a failed add to keep what I typed so I can try again, so that a timeout does not cost me the entry.
6. As the operator, I want a reference's code given only when its sheet is first sent, so that adding a name does not fix a code too early.
7. As the operator, I want the app to refuse a name already used by another reference of the same kind, so that two pages never share a code.
8. As the operator, I want a character's name to be their full first and last name, as printed on the sheet, so that image models read the same name every time.
9. As the operator, I want to ask the Agent "what's out of step?", typed or spoken, so that I can check at any moment.
10. As the operator, I want the check to run by itself when I re-check the series and when Prep opens, so that drift shows up where I work.
11. As the operator, I want the check never to run on a schedule, so that nothing happens behind my back.
12. As the operator, I want the check to only read until I say yes, so that looking is always safe.
13. As the operator, I want the Agent to post one message listing what is out of step, so that the chat stays readable.
14. As the operator, I want nothing posted when everything is in step, beyond the Agent's usual line saying it checked, so that a clean check is quiet.
15. As the operator, I want each item to say where it was found (Notion, which project's Prep, Review Room) and where it is missing, so that I understand it without opening three systems.
16. As the operator, I want each item to offer only the choices that make sense for it, so that I cannot pick something that cannot work.
17. As the operator, I want a reference that is in a project's Prep but not in Notion to offer "add to Notion", so that TR110's sixteen can be brought in.
18. As the operator, I want a Prep entry or Review Room sheet whose name is close to a Notion reference to offer "link to" that reference, so that Bryson and Bryson Vane become one.
19. As the operator, I want "link" to send the stray sheet again under the Notion name, as that reference's next version, so that its code matches Notion.
20. As the operator, I want "link" to mark the stray Review Room asset as old once the new version is in, so that it stays as history and is never offered for a shot.
21. As the operator, I want "mark as old" on a Review Room sheet no Notion reference uses, so that Lucian Vale becomes Lucian Blaise's history.
22. As the operator, I want an old sheet to stay visible in Review Room, so that history is not lost.
23. As the operator, I want the check to ignore sheets already marked old, so that settled drift never comes back.
24. As the operator, I want a Notion reference with no sheet yet not to count as drift, so that unmade references are not noise.
25. As the operator, I want duplicates in one project (two spellings of Mara's dorm room, two of Campus walkway) shown as one item with both spellings, so that each reference goes to Notion once.
26. As the operator, I want to choose or edit the exact name before "add to Notion" writes it, so that a wrong spelling never becomes a code.
27. As the operator, I want the proposed name to use straight apostrophes and no " - ", so that codes stay clean.
28. As the operator, I want a name changed in Notion after its code is set to appear as drift, so that a rename is never followed silently.
29. As the operator, I want that rename item to offer "put the old name back in Notion" or "make it a new reference", so that I decide whether the sheet is remade.
30. As the operator, I want "make it a new reference" to give a new code and mark the old reference's sheets as old, so that history stays linked.
31. As the operator, I want the app never to offer a rename of a coded reference, so that codes never drift from inside the app.
32. As the operator, I want adding to Notion and sending the picture to be separate choices, so that a missing or small picture never holds up the name.
33. As the operator, I want a picture under 2048 px on its long edge to be offered an upscale with its price shown first, or a remake, so that I decide before credits are spent.
34. As the operator, I want an upscaled sheet shown beside its original before it is sent, so that a changed face or place is caught.
35. As the operator, I want a reference with no picture at all to be added to Notion and listed in Prep as still to make, so that it has a place.
36. As the operator, I want a sheet larger than 2K sent to Review Room as 2K, so that every reference in use is the same size.
37. As the operator, I want the full-size file kept beside the 2K, so that I can export again if the limit changes.
38. As the operator, I want each choice I press to be said in the chat as it runs and as it ends, so that I see what was written where.
39. As the operator, I want a choice that fails to say why and leave things as they were, so that a half-done link never happens.
40. As the operator, I want to answer several items at once ("add all six"), so that bringing TR110's sixteen in is not sixteen presses.
41. As the operator, I want the first write of a batch to run alone and be checked before the rest, so that a mistake hits one reference, not sixteen.
42. As the operator, I want Prep to show every reference as in Review Room, waiting for a picture, or missing from Notion, so that I know what is left to prep.
43. As the operator, I want Prep's "only in this project" count to fall to zero once the drift is settled, so that I can see the work is done.
44. As the operator, I want the check to cover every project of the series, so that a reference made in an old trailer is not forgotten.
45. As the operator, I want the check to work on this Mac's test copy without changing Review Room until I press, so that looking at TR130 or TR110 is safe.

## Implementation Decisions

- **A pure comparison rule in the domain layer.** Input: the series' Notion references (name, kind, handle, page id, code if any), each project's Prep entries (name, kind, picture size, project) and Review Room's reference assets (code, folder, versions, old flag, the Notion page id stored in their metadata). Output: a list of drift items, each with a kind (only in Prep, only in Review Room, renamed in Notion, picture too small, duplicate spellings), where it was found, the candidate Notion reference for "link" if any, and the choices allowed for it. Name matching is case and punctuation insensitive (curly and straight apostrophes, " - " and ",") and prefix-aware (Bryson to Bryson Vane); it only proposes a link, never decides one.
- **A server drift module** around it: `check` gathers the three inputs and returns the report; `resolve` takes one item and one choice (with the operator's final name where it writes one) and carries it out; `addReference` is the one way a reference is added from the app. All three take Notion and Review Room as dependencies, like the reference upload does today.
- **Notion: creating a References page.** New: the app creates pages in the References database (Name, Kind, Handle, and the Scenes relation when added from a scene). Nothing else is written there. The app's Notion connection already has insert rights (ADR 0002).
- **Review Room: reading the reference folders.** New: the check lists the assets in `refs:characters`, `refs:locations` and `refs:props` from the series project's change feed, the way takes are pulled for scene folders. No new Review Room endpoint.
- **Review Room: the old flag.** "Old" is written into the asset's current version metadata (with the reference it is history of, if any), through the existing metadata call. The check, Prep and every shot's reference picker skip assets marked old.
- **Link** sends the stray sheet's file through the existing reference upload under the Notion name, then marks the stray asset old. Upload first, mark second; if the upload fails nothing is marked.
- **Adding** writes Notion first, then re-reads the series record so the new page id is known, then adds the entry in Prep linked to that page. A Prep entry with no Notion page is no longer created.
- **Pictures.** The reference upload keeps its long-edge minimum of 2048 px. A larger sheet is scaled down to 2K for Review Room and its full-size file is kept with the reference in the project, recorded as its source image. Upscaling uses the existing upscaler with a price shown first, and is a choice of its own.
- **The Agent chat.** The check's result is posted as one Agent message with its items and their choices as small actions inside it, in the Agent panel's decided look (no boxes). Choices run through the Agent's existing "doing / done / failed" lines. The Agent can also run the check and the choices as actions when asked in words. No running log is added.
- **Triggers:** on demand from the Agent, after every series re-check, and when Prep opens. Never on a schedule.

## Testing Decisions

- Tests check behaviour from outside: given these three inputs, this report; given this item and choice, these writes to fake Notion and fake Review Room, in this order, and nothing else. They never look at how matching is done inside.
- **The comparison rule** is tested test-first with TR110's real cases: the sixteen, the duplicate spellings, Bryson against Bryson Vane, Lucian Vale, Kai's sunglasses, a picture at 1678 px, a reference with no picture, a Notion reference with no sheet (no item), an asset marked old (no item), and a Notion rename after the code was set. Prior art: the pure rule tests under `tests/domain`.
- **The drift module** is tested with fake Notion and fake Review Room clients: add writes Notion first and adds nothing when Notion fails; link uploads then marks old, and marks nothing when the upload fails; mark as old writes only metadata; a check makes no writes. Prior art: the reference upload and story writer tests under `tests/server`, which fake the same two systems.
- **The Agent message** is covered by the look-rule tests that already check every component in the shell, plus a browser walk-through on TR110 and TR130 at 1440 px and phone width, looking only, never pressing a choice against the real Review Room without the operator's word.

## Out of Scope

- Scenes and shots in the drift check (shots already go through the series sync; they can join later).
- Where a reference's written spec lives once its sheet is in Review Room; specs stay in Prep for now.
- Renaming a reference from inside the app.
- Removing Notion pages: Notion only gains pages.
- A running log in the Agent panel.
- Voice; it is its own slice, and whether the voice model answers by itself (reopening ADR 0009) is decided there.
- Actually sending TR110's sixteen and fixing the three strays: that is the first use of the finished check, done with the operator's word, one reference first.
- The bug that a series re-check drops the queue of shot pages waiting to be trashed in Notion; it gets its own ticket.

## Further Notes

- Every step that writes to Notion or Review Room is real: Review Room is production and this Mac's copy is connected to it. Build and test against fakes; in the browser, look only.
- The table of TR110's sixteen, their sizes and proposed names is in `issues/04-references-to-review-room.md`.
