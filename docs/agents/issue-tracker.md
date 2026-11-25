# Issue tracker: GitHub and Linear, both written

Every ticket lives in **both** trackers, and the agent writes every change to both in the same step. Neither copies
from the other. They are kept the same by hand, so a change written to only one of them counts as a broken ticket.

| | GitHub | Linear |
| --- | --- | --- |
| Where | `gordo-v1su4/creative-studio-pro` (`gh` CLI, inferred from `git remote -v`) | team **V1su4** (`V1S`), project **Creative Studio Pro — series production** (`P-V1S-12`), through the Linear MCP tools |
| Labels | the five triage labels in `triage-labels.md` | the same five names, plus a type label (Feature, Improvement, Bug) |
| Status | open / closed, plus the triage label | Todo → In Progress → Done (Canceled when dropped) |
| Blocking | "Blocked by #N" in the body (GitHub has no native link) | native blocked-by relation |

## The pair

- **Create**: the GitHub issue first, then the Linear issue with the same title and body, the line
  `GitHub: <url>` at the top of its body, and the GitHub issue edited so it carries `Linear: V1S-<n>`. A ticket
  that is in only one tracker is not created yet: finish the pair before doing anything else.
- **Title**: the same in both. The body may name the ticket by either id.
- **Start**: comment "Started in <session name>" on both; Linear status to In Progress.
- **Progress**: at every stopping point (a commit, a hand-off to a new session, being blocked), one comment on both
  saying what is done, the commit hash, and what is left.
- **Done**: close the GitHub issue with a comment carrying the commit hash; Linear status to Done with the same
  comment. Then tick the ticket in the plan it came from (`PLAN.md` or the spec).
- **Changed scope**: edit the body in both, and say in a comment on both what changed and why.

## GitHub commands

- Create: `gh issue create --title "..." --body "..." --label ready-for-agent` (heredoc for long bodies)
- Read: `gh issue view <n> --comments`
- List: `gh issue list --state open --json number,title,labels`
- Comment: `gh issue comment <n> --body "..."`
- Labels: `gh issue edit <n> --add-label "..." --remove-label "..."`
- Close: `gh issue close <n> --comment "..."`

GitHub shares one number space across issues and PRs: resolve a bare `#42` with `gh issue view 42`.

## Linear

Use the Linear MCP tools: `save_issue` (create and update; team `V1S`, project `P-V1S-12`), `save_comment`,
`list_issues`, `get_issue`. Statuses and labels are listed above; they were read from the team on 2026-11-25.

## Pull requests as a triage surface

**No.** Work commits to the branch; there are no PRs to triage.

## When a skill says "publish to the issue tracker"

Create the pair, as above.
