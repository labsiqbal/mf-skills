---
name: mf-orca
description: Coordinate project work when the user invokes mf-orca or asks for orchestration. Route phases, delegate bounded work, and verify completion. Support requested hill climbs while keeping the coordinator out of implementation.
license: MIT
metadata:
  version: "1.2.0"
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

- Resolve the project from the user's request, current directory, and available
  project documentation. A workspace index can help when one exists.
- Read applicable instructions and existing task artifacts, such as `AGENTS.md`,
  `CLAUDE.md`, a README, specs, or the configured tracker. No particular filename
  or workspace layout is required; use the current request when none exists.
- In a Git worktree, verify its common directory and applicable instructions.
  An ancestor repository does not establish project ownership. Non-Git work uses
  its existing artifact home.

If project ownership, task purpose, or writer ownership is ambiguous, inspect
read-only and ask one targeted question. Do not guess.

## 2. Classify

Choose the smallest route that fits current evidence:

- settled small change or ready ticket: bounded implementation and checks
- unresolved project decisions: clarify consequential choices
- runnable design question: a scoped prototype
- large or unclear effort: investigate, then specify the agreed scope
- settled multi-session effort: use the existing spec and dependency-ready tickets
- existing diff: review against project rules and the requested behavior
- repeated friction: inspect its cause and propose a targeted process correction

Reuse existing specs, tickets, decisions, commits, and handoffs. Do not restart
planning because a new session started.

For a requested hill climb or iterative optimization with before/after evidence,
read [Hill climb](references/hill-climb.md). It wraps the selected build and
review methods; ordinary tasks keep their existing route.

Review uses one separate read-only reviewer. A council (multi-model review
panel) runs only when the owner asks for one in the current task; a hill climb,
high stakes, project history or an earlier council never adds one. For a
requested council, read [Hill climb](references/hill-climb.md#assign-builder-and-evaluators).

Use the project's methods and available skills through the active harness;
no companion skill collection is required. For example, an installed `implement`
or `code-review` can handle its matching phase. Otherwise put the method and
acceptance checks directly in the worker brief. Honor explicit-only invocation
controls and never claim an unavailable skill ran. Ops, research, copy, and
design follow their own methods. Only create specs or tickets when needed;
without a tracker, keep a compact checkpoint in the conversation or agreed
artifact home. Installing tools or skills is a separate action.

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

Use the harness's supported permission inheritance and honor explicit user
runtime choices. This skill requires no particular access-mode name and grants
no permission escalation. Verify effective worker limits when exposed; report
restrictions or unknown values that affect acceptance. Scouts and reviewers
remain read-only by task scope even when their runtime allows writes. Authorized
in-scope work needs no duplicate approval; ask only for missing authority or
unresolved decisions. Harness ceilings and enforced approvals still apply.

Use the active harness's native delegation contract. For asynchronous work,
write a minimal open-worker checkpoint before dispatch with task, writer, scope,
checkout, and expected artifact. Dispatch is complete only when the returned
task ID is saved in that checkpoint as the next action, before any wait or
further work. Keep that checkpoint for continuation.
Follow the harness's returned continuation instructions. For completion-driven
background tasks, yield and resume on their signal; for in-turn workers, use the
supported bounded wait. Avoid status polling or artificial keep-alive loops.

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
