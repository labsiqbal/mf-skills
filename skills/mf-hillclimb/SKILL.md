---
name: mf-hillclimb
description: Improve a product, UI, prompt or code over repeated rounds against a fixed metric or rubric, keeping only verified gains. Use when the user asks for a hill climb, iterative optimization with before/after evidence, or resuming one.
license: MIT
metadata:
  version: "0.1.0"
  status: draft
  author: "Iqbal"
---

# mf-hillclimb

Climb from a fixed baseline toward an agreed target. Each round produces one
candidate; the evaluation contract decides whether it becomes the new best.
Project rules, trackers and Git state stay authoritative; keep round receipts in
the existing task home or the location the user names.

## 1. Bind the evaluation contract

Record the contract in the existing task, spec or conversation before any change:

- Objective, allowed change scope, baseline revision/artifact and workload.
- Primary metric and acceptance target, or a rubric with anchored dimensions for
  subjective work. Reuse existing project checks before creating new ones.
- Hard guards: required behavior, security, accessibility and relevant runtime
  checks. A metric gain never compensates for a failed guard.
- Improvement rule and material tradeoffs, defined before any candidate result.
  Example: a smaller payload qualifies only with unchanged decoded values; a UI
  score needs evidence for each affected dimension and no agreed regression.
- Fixed inputs and environment, evidence home, round limit and any owner budget.
- For a noisy metric (timings, model judgments), the repeat count and
  aggregation, such as the median of 7 runs, so one bad run cannot flip a verdict.

Round limit: at most 10 candidate rounds after baseline. Stop early after 2
consecutive rounds without a qualifying improvement. The owner's limits win.

The contract stays frozen for the whole climb. When an evaluator proves wrong or
the owner changes acceptance, record the change, then re-evaluate both baseline
and current best under the revised contract before ranking again.

Done when every field above is recorded or explicitly marked not applicable.

## 2. Capture the baseline

Run the chosen checks and capture the initial artifact and raw results before
any change. The baseline stays immutable. For a new product, build a runnable
first candidate and label it the baseline. For a bug, start from the user-facing
reproduction.

For UI, capture matching routes, data, states, viewport, theme and zoom before
and after, plus relevant narrow layouts, key interactions, loading/error states
and accessibility checks. A screenshot supports appearance only; interaction and
accessibility claims need their own checks.

When a required capture or evaluation tool is unavailable, record the missing
evidence and keep that gate open.

## 3. Assign builder and evaluator

One builder changes the candidate per round. Evaluation is independent of it:

- Prefer programmatic checks for correctness and measurable performance.
- Subjective judgments go to a separate read-only reviewer context with the
  frozen candidate, evidence and rubric. A fresh run of the same model is
  acceptable; record that limited diversity.
- Without delegation, run evaluation in a fresh context or by script and label
  the review as same-agent. The builder's self-score is never the verdict.

Use the active harness's delegation contract. Accept a worker result only after
the harness confirms completion; then read its artifacts and raw outputs
directly. Record actual builder/reviewer model, provider and effort when exposed.

## 4. Run rounds

1. Change the current best candidate within the allowed scope, addressing open
   findings.
2. Run the unchanged evaluation inputs and relevant regression checks. Capture
   raw outputs, exit codes and the candidate revision/hash. Freeze that artifact
   during review; a new edit needs new evidence.
3. Review the artifacts and results. Give findings stable IDs with evidence,
   severity and fixed/disputed/declined status. Park out-of-scope ideas as
   follow-ups.
4. Promote the candidate only when it passes every hard guard and meets the
   improvement rule. Missing evidence means unverified. On regression, keep the
   previous best and preserve the rejected work for recovery.
5. Stop on: acceptance met, round or budget limit reached, stall, or a material
   decision for the owner. Otherwise start the next round.

Every candidate scored against the metric is a round and counts toward the
limit. Exploratory measurement between rounds may guide the next change, but only
a recorded round promotes a candidate.

For noisy model judgments, compare candidate and baseline against the same
reference set in fresh contexts; repeat uncertain important cases within budget
and report the variation. Keep held-out cases when a meaningful corpus exists.

## 5. Report

Keep a compact receipt per round:

```text
Round and candidate revision/hash:
Best retained revision/hash:
Evaluation contract and environment:
Primary metric / dimension judgments:
Hard guards, coverage and open findings:
Baseline, candidate, raw checks and review evidence paths:
Builder/reviewer model, provider, effort; usage if exposed:
Decision and reason; rounds left / next action:
```

For UI, hand back original before/after captures plus a labelled comparison of
what changed and why; keep annotations separate from originals and name the
views and interactions actually checked.

Final handback names the retained best candidate and the stop reason: acceptance
met, budget exhausted, stalled or blocked. Each of these is short of merge,
release or deploy, which follow the project's own gates. Subjective acceptance
remains the owner's call.
