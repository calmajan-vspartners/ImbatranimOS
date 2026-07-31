---
description: Generic work-intake router that runs on top of corpus-flow. Run at the start of a work request in any project — ensures a corpus/ workspace exists, reads corpus/routing.md, classifies intent, proposes a Route Plan, and hands off (capture→corpus-flow, build→plan-split-dispatch, query→wiki) after approval.
argument-hint: "[ticket ID, MR/PR, task description, lifecycle verb, or workspace verb]"
---
# /orchestrate

Invoke the `orchestrate` skill — the **front door** for project work. It conducts three generic skills: `corpus-flow` (the `corpus/` workspace + briefs + wiki), `plan-split-dispatch` (model-routed dispatch), and itself (the router). It never does the work itself.

- **No `corpus/` workspace yet?** It bootstraps one (via corpus-flow) and seeds `corpus/routing.md` by scanning the repo, then routes. Workspace-required by design.
- **Build work** → file/pick a brief, hand to `plan-split-dispatch` (hard→opus / easy→sonnet) with the routing file's READ/SKIP/SKILLS, then close out via corpus-flow (log + fold into the wiki).
- **Capture / query** → corpus-flow (add a todo / query the wiki). **A 1–2 file change** → inline.

Pass the work item as the argument (`/orchestrate PROJ-42`, `/orchestrate add a todo`, `/orchestrate work on brief 7`), or invoke bare to be asked what we're working on.
