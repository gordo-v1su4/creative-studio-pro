---
status: accepted (2026-10-17, supersedes the "codes not in Notion" part of the series-production plan, Q29)
---

# The app writes codes and shots into Notion; Notion never writes them

The writer wants to read a series in Notion down to the shot, with its codes, so show, episode, scene and shot codes appear there as columns. They are still assigned and locked only in this app: the app writes them into Notion (and shots' plain fields both ways) with a deterministic sync, never an LLM, and a value typed over in Notion is overwritten on the next sync. We chose this over keeping codes out of Notion (invisible to the writer) and over letting Notion own them (two masters that drift once media is named after them, see ADR 0001). Consequence: the app's Notion connection has Read, Update and Insert content (no comments, no user info) and still sees only the Creative Studio Pro page; prompts stay in the app.
