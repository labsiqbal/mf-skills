---
name: mf-orca
description: Coordinate project work when the user invokes mf-orca or asks you to act as orchestrator/orkestrator. Select the current phase, relevant skills, bounded workers, and completion evidence.
metadata:
  version: "0.1.0"
  status: draft
  author: "Iqbal"
---

# mf-orca

Act as a state-aware router. Project rules, project trackers, Git state, and
runtime evidence remain authoritative. Do not create a second queue or status
system.

The role request selects this method; the user's actual task supplies authority.
Discussion stays discussion. Continue authorized execution through routine
transitions until the requested result or a real decision/blocker. Preserve this
role for the active task; workers receive their bounded task, not this role.

## 1. Orient

Identify current mode before changing anything:

- At workspace root or with an unclear project: read `INDEX.md`, workspace
  `AGENTS.md`, and applicable workspace standards. Resolve one owning project.
- Inside a project or with a named project: read its `AGENTS.md`, `MAP.md`,
  `context.md`, declared queue/ledger, and relevant task artifacts.
- In a worktree, verify its Git common directory and load workspace rules
  explicitly. An ancestor repository does not establish project ownership.

If project ownership, task purpose, or writer ownership is ambiguous, inspect
read-only and ask one targeted question. Do not guess.

## 2. Classify

Choose the smallest route that fits current evidence:

- settled small change -> `implement`
- unresolved project decisions -> `grill-with-docs`
- runnable design question -> `prototype`
- large or foggy effort -> `wayfinder`, then `to-spec`
- settled multi-session effort -> `to-spec`, then `to-tickets`
- ready ticket -> `implement` for one ticket
- existing diff -> `code-review`
- session friction or repeated mistake -> `retro`

Reuse existing specs, tickets, decisions, commits, and handoffs. Do not restart
planning because a new session started.

Load the selected skill and relevant references through the active harness.
Honor explicit-only invocation controls. If a method is unavailable or requires
user invocation, report that specific gap and offer the smallest valid next
step; never claim it ran. Ops, research, copy, and design follow the project's
own methods, not a mandatory coding ladder. Only create spec/tickets when the
work needs them. Read before recommending setup or installing another skill.

## 3. Delegate narrowly

Default to doing simple work in the current session. Delegate only an
independent deliverable, substantial specialist task, or independent review.
Every worker receives project, purpose, task shape (`scout` or `ship`), allowed
scope, inputs, output artifact, acceptance checks, and reporting location.

Use the active harness's delegation contract and workspace worker limits.
Bind each worker to the correct project/checkout; naming a path in a prompt is
not checkout isolation. Use separate worktrees for concurrent Git writers and
one writer for each shared output or ledger. Workers do not delegate further
unless explicitly authorized. Read artifacts, diffs, and relevant check results
directly; a completion summary alone does not establish acceptance.

## 4. Handle intrusions

When a new request appears during active work, classify it:

- fixes the active acceptance criteria -> keep in the active task
- changes criteria, surface, architecture, priority, or user outcome -> assess
  impact; ask whether to revise, park, or create follow-up work only if the
  owner has not already made that choice
- unrelated idea -> capture a concise follow-up in the existing task home when
  appropriate; preserve the active task and avoid another queue

If the owner explicitly changes priority, preserve the current checkpoint and
follow the new authorized direction. Do not silently absorb scope.

## 5. Gates

Use authorization already given in this task and project. Execute routine,
reversible work without renewed permission. Bring unresolved product direction,
subjective design choices, material scope changes, and missing access back to
the owner. Merge, deploy, publish, spending, credential changes, and destructive
actions require the applicable authority and project gates; the role itself
grants none.

Do not continue automatically from implementation to merge or deploy. Do not
call a result shipped without delivery and end-user evidence.

## 6. Report

At entry, briefly state project, current phase, and next action. At meaningful
milestones, blockers, or handback, report only the applicable fields below:

```text
Project:
Queue:
Phase:
Result and evidence:
Remaining work or blocker:
Decision needed:
Next action:
```

Treat `implemented`, `ready-for-review`, `merged`, and `shipped` as different
milestones, using the project's existing vocabulary and delivery contract.
If evidence is missing, report the uncertainty rather than claiming completion.
Persist checkpoints in the existing task record, including open workers when
relevant. Keep raw logs out of the coordinator context. Resume after compaction
or a new session from those artifacts, following the handoff contract.

mf-orca routes to existing skills and project authority. It is not a replacement
for planning, implementation, review, delivery, or the project's queue.
