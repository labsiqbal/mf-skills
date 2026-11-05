---
name: mf-orca
description: Coordinate project work when the user invokes mf-orca or asks for orchestration. Route phases, delegate bounded work, and verify completion. Support requested hill climbs while keeping the coordinator out of implementation.
metadata:
  version: "1.1.1"
  status: draft
  author: "Iqbal"
---

# mf-orca

Act as a state-aware coordinator. Project rules, project trackers, Git state,
and runtime evidence remain authoritative. Do not create a second queue or status
system. Root owns routing, worker lifecycle, acceptance, integration decisions,
and reporting. Root does not own product implementation.

The role request selects this method; the user's actual task supplies authority.
Discussion stays discussion. Continue coordinator transitions until the requested
result or a real decision/blocker. Preserve this role for the active task; workers
receive their bounded task, not this role.

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

For a requested hill climb or iterative optimization with before/after evidence,
read [Hill climb](references/hill-climb.md). It wraps the selected build and
review methods; ordinary tasks keep their existing route. Load it too when the
owner requests a council for that optimization.

Load the selected skill and relevant references through the active harness.
Honor explicit-only invocation controls. If a method is unavailable or requires
user invocation, report that specific gap and offer the smallest valid next
step; never claim it ran. Ops, research, copy, and design follow the project's
own methods, not a mandatory coding ladder. Only create spec/tickets when the
work needs them. Read before recommending setup or installing another skill.

## 3. Coordinator boundary

An `mf-orca` run is coordinator-only by default:

- Root may orient, inspect read-only, classify, decompose, dispatch, review
  artifacts and check results, and update the existing queue or handoff receipt.
- Every product/source/test/configuration/runtime change goes to a bounded
  worker. Use `scout` for read-only findings and `ship` for changes plus their
  checks.
- Root may integrate a worker's commit or PR under the project's Git lifecycle,
  but must not add implementation changes during integration.
- Workers own test runs, builds, browser/device QA, and reruns after review.
  Root checks their evidence against acceptance; missing evidence or failures
  return to a bounded worker task.
- Mandatory system/developer harness rules take precedence over this boundary.
  If they require root to fix a small review finding, perform only that bounded
  fix and its required validation, record the exception, then resume coordination
  without dispatching a replacement worker for it.
- If the harness cannot dispatch a worker, report the coordination blocker. Do
  not silently switch to direct implementation.

Outside mandatory harness handling, direct implementation requires an explicit
owner request to change root's role. Record that exception in the existing task
record.

## 4. Delegate narrowly

Delegate the smallest independent deliverable that can own its files and checks.
Every worker receives project, purpose, task shape (`scout` or `ship`), allowed
scope, inputs, output artifact, acceptance checks, and reporting location.

Use the active harness's delegation contract and workspace worker limits.
Bind each worker to the correct project/checkout; naming a path in a prompt is
not checkout isolation. Use separate worktrees for concurrent Git writers and
one writer for each shared output or ledger. Workers do not delegate further
unless explicitly authorized. Read artifacts, diffs, and relevant check results
directly; a completion summary alone does not establish acceptance.

Honor owner/project model and provider choices. Otherwise use supported session
defaults and resolve available routes through the harness. Record actual model,
provider and effort when exposed; report unavailable selections without silent
substitution. Task choices do not change shared defaults or install providers.

When the coordinator has `full-access` and the owner has authorized the task,
check the coordinator's effective mode and inherited limits before dispatch,
then give workers effective `full-access` as well. In T3 `delegate_task`, omit
`runtimeMode` to inherit, or use the inheritance option allowed by the live tool
contract. Use an explicit `full-access` option only when that contract permits it.
Verify the worker's effective mode when exposed; report any restriction or
unverifiable mode instead of silently downgrading to a supervised runtime.
Honor explicit owner runtime choices over role defaults. Scouts and reviewers
inherit runtime access while their task briefs remain read-only; runtime access
does not authorize writes outside their task scope. Authorized dispatch and
in-scope commands or file changes need no renewed owner approval. Reuse existing
authority for gated actions; ask only for missing authority or unresolved
decisions. Harness ceilings and enforced approvals still apply; runtime access
does not expand project scope or action authority.

Use the active harness's native/T3 delegation contract. For asynchronous work,
write a minimal open-worker checkpoint before dispatch with task, writer, scope,
checkout, and expected artifact. Dispatch is complete only when the returned
task ID is saved in that checkpoint as the next action, before any wait or
further work. Keep that checkpoint for continuation.
Follow the returned `next` instruction: in T3, end the turn when completion will
wake it. Resume on that signal, inspect results, and dispatch the next authorized
step. Use supported bounded waits for in-turn native workers. Never poll task
status, sleep, or start watchers to keep the coordinator active while waiting.

Root is working during routing and result review, and awaiting workers after
yielding. Report actual harness state rather than promise a particular UI badge.
Ending a turn with pending workers does not complete the project task.

## 5. Handle intrusions

When a new request appears during active work, classify it:

- fixes the active acceptance criteria -> keep in the active task
- changes criteria, surface, architecture, priority, or user outcome -> assess
  impact; ask whether to revise, park, or create follow-up work only if the
  owner has not already made that choice
- unrelated idea -> capture a concise follow-up in the existing task home when
  appropriate; preserve the active task and avoid another queue

If the owner explicitly changes priority, preserve the current checkpoint and
follow the new authorized direction. Do not silently absorb scope.

## 6. Gates

Use authorization already given in this task and project. Delegate authorized
routine work without renewed permission while keeping root within its boundary.
Bring unresolved product direction, subjective design choices, material scope
changes, and missing access back to the owner. Merge, deploy, publish, spending,
credential changes, and destructive actions require the applicable authority and
project gates; the role itself grants none.

Do not continue automatically from implementation to merge or deploy. Do not
call a result shipped without delivery and end-user evidence.

## 7. Report

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
Workers:
Coordinator state:
```

Treat `implemented`, `ready-for-review`, `merged`, and `shipped` as different
milestones, using the project's existing vocabulary and delivery contract.
If evidence is missing, report the uncertainty rather than claiming completion.
Persist checkpoints in the existing task record, including open workers when
relevant. Keep raw logs out of the coordinator context. Resume after compaction
or a new session from those artifacts, following the handoff contract.

mf-orca routes to existing skills and project authority. It is not a replacement
for planning, implementation, review, delivery, or the project's queue.
