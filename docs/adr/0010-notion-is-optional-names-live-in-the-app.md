---
status: superseded by ADR 0012 (2026-11-25)
---

# Notion is optional; names are decided and kept in the app

A project can be made from start to finish without Notion. Show, trailer, episode, scene and shot codes and reference names are decided in this app, fixed when the operator approves the level they belong to, and kept in the project's own history; they are written into Notion as well when a Notion key is present (ADR 0002 still describes how). The key is entered once in Settings by the single operator and never shown again, and the series template is a public Notion page anyone can duplicate. We chose this over keeping Notion as the required starting point because a project that begins from an idea, a pitch or a folder of images has no Notion page yet, and because names that changed between Notion, the board and Review Room were the main source of confusion.

**Consequences**: every screen shows the one name the app holds; a code never changes after its level is approved, only a title can; import from Notion (ADR 0006) and from a show folder remain ways in, not requirements; a project with no Notion key simply has no Notion copy.
