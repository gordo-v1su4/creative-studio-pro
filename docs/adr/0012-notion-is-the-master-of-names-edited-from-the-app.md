---
status: accepted (2026-11-25, supersedes ADR 0010)
---

# Notion is the master of names, edited from the app, with a drift check

Every series has a Notion copy, and Notion decides what exists and what it is called: the story, references, scenes and shots, and each one's name or shot line. Codes are still given by this app when a level is approved and written into Notion as read-only columns (ADR 0002 stands). The operator never has to go to Notion to add something: adding a character, place or prop in the app writes its page into Notion's References first (Name, Kind, Handle, and the scene it came from), and if that write fails nothing is added. A **drift check** compares Notion's References, each project's Prep and Review Room's reference folders, and offers for each mismatch *add to Notion*, *link to an existing reference* or *mark as old*. Nothing is written without a yes.

We chose this over ADR 0010 (Notion optional, names kept in the app). A reference could never be sent without a Notion page anyway, and the stray sheets this produced (Lucian Vale, Bryson, Kai's sunglasses, and sixteen of TR110's references that existed only in its Prep) came from names made in two places. Two modes, one with Notion and one without, would have meant two code paths and two kinds of drift for a single operator whose series are all in Notion. The project that starts from an idea, which 0010 was protecting, still works: the app creates the Notion pages as things are added.

## Consequences

- **A rename is a new reference.** The code is built from the name and the name is printed on the sheet, so a name changed in Notion after the code is set is never followed silently. The drift check offers to put the old name back or to make a new reference (new code, new sheet) and mark the old one as old.
- **Linking sends again.** A stray sheet (`BLR_REF_CHR_BRYSON`) is linked by sending it under its Notion name (`BLR_REF_CHR_BRYSON_VANE`) and marking the stray asset as old. "Old" is a flag in the Review Room asset's metadata; the check then ignores it and no shot is offered it. Notion only gains pages and never loses them. A Notion reference with no sheet yet is not drift.
- **The check covers references only at first.** Shots already go through the series sync; scenes and shots can join it later.
- **Findings appear in the Agent chat** as one message with each item's choices, and the operator can ask for a check, typed or spoken. It runs on demand, on every series re-check and when Prep opens, never on a schedule. There is no running log.
- **The picture is a separate step from adding to Notion.** A picture under 2048 px on its long edge is offered only a remake: a new sheet rendered in Prep at 2K (a location with Scenecraft V1, a character with Castkit V1), priced first. It is never upscaled (operator, 2026-11-25: "upres gets messy"; GitHub #43 / V1S-521). A larger one is scaled down to 2K for Review Room, and the full-size file is kept beside it, as Pindeck keeps its originals.
- **It is built in Prep's turn** in the screen order. Prep is not finished until every reference it lists is in Review Room or is shown as missing.
