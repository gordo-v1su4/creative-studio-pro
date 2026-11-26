# SPECIMEN teaser: where it stands (2026-11-26)

**Current prompt:** `SPECIMEN_teaser_v1.txt`, one 30 s Seedance 2.5 prompt. It is written, and it is waiting for the T3 Code instance on the Windows PC to render it. Renders never run from the Mac.

## Render brief for T3 Code

Settings: Seedance 2.5, omni reference, 30 s, 16:9, 1080p, audio on, **Unlimited on**.

References, upload in this order (the files are in this folder on the Mac; copy them to the PC):

| Ref | Name in the prompt | File |
|---|---|---|
| @Image_1 | Wade Kessler Week 1 | `hf_20261126_061046_b61e3ecb-3309-4dc5-88c1-ce75b50fab62.png` (Before sheet) |
| @Image_2 | Wade Kessler Week 6 | `hf_20261126_061420_aa0945b1-011d-4b51-82e6-0f53826cefaa.png` (Muscle sheet) |
| @Image_3 | Wade Kessler Week 9 | `hf_20261126_062146_10008fba-3586-44f3-97fd-bda18ca93789.png` (Half sheet) |
| @Image_4 | the Weigh Station | `hf_20261126_064111_cbba26df-862d-49cd-abe8-62d797668075.png` |
| @Image_5 | the Stadium | `hf_20261126_064111_8506ab97-1be1-4d5e-a0a0-2dd78bd87429.png` |

v1 drops the Full sheet (`…062430`, the one judged to look horrible). The Week 9 stage is the Half sheet, and the ending moves the amber eye onto Dane Royce instead.

## What else is in here

| File | Status |
|---|---|
| `SPECIMEN.md` | Ghost reverse of the source clip, the stage-sheet prompts, and the first 30 s plan (section 3, superseded by v1). |
| `specimen_30s_seedance25.txt` | Superseded. The first 30 s prompt (job `3943e76d`), judged unusable. |
| `specimen_ghost_30s.md`, `ghost_clip1.txt`, `ghost_clip2.txt` | The two 15 s Ghost clips. Clip 1 was rendered (job `5bef619d`, `hf_20261126_202644_…mp4`); clip 2 was never rendered. |
| `stage*_prompt.txt`, `loc_*.txt`, `loc_*.url` | Prompts and CDN links for the sheets and location plates. |

Media files (`*.png`, `*.mp4`) stay on disk under their Higgsfield names and are not committed.
