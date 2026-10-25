---
status: accepted (2026-10-25, extends ADR 0002)
---

# The app ticks "Name on sheet" and sets "File name" for reference sheets it makes

ADR 0002 lets the app write only codes and shots into Notion. Prep (V1S-374) now makes reference sheets itself: it prints the exact name along the bottom of each sheet, names the file after it and uploads it to the series' `_References` in Review Room. Since the app knows both facts for certain, it also ticks the reference row's **Name on sheet** and sets its **File name** in Notion, so the send gate (which reads those two fields) passes without a manual step. It writes nothing else on a References row, and never on a row whose sheet it did not upload. We chose this over asking the operator to tick the box after every sheet, which was the step most often forgotten.
