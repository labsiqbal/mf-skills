# Hill climb

Coordinate bounded improvements against a fixed evaluation contract. The
builder changes the product; evaluation workers produce evidence; root selects
the best supported candidate. Preserve mf-orca's coordinator boundary, project
authority, and the active harness's delegation and continuation contract.

## Bind the evaluation

Record the following in the existing task/spec before implementation:

- Objective and allowed change scope; baseline revision/artifact and workload.
- Primary metric and acceptance target, or a rubric with anchored dimensions
  for subjective work. Reuse existing project checks before creating more.
- Hard guards: required behavior, security, accessibility, and relevant runtime
  checks. Improving a metric cannot compensate for a failed guard.
- Fixed inputs and environment, reviewer coverage (one reviewer unless the
  owner requested a council), artifact home,
  round limit, and any owner-specified time/usage budget.

Default to at most three candidate rounds after baseline, stopping after two
consecutive rounds without a qualifying improvement. Honor the owner's limits.
Define improvement and material tradeoffs before seeing candidate results. For
example, smaller payloads qualify only with unchanged decoded values; UI scores
need evidence for each affected dimension and no agreed dimension regression.

Keep checks, rubric and comparison inputs fixed during the loop. If an evaluator
is wrong or the owner changes acceptance, record the change and evaluate both
the baseline and retained candidate under the revised contract before ranking.

## Assign builder and evaluators

Use one bounded builder at a time. Keep its selected model/provider across
rounds unless the owner changes them or an unavailable route requires a
decision. Builder continuity may use its existing task when the harness allows.

Prefer programmatic evaluation for correctness and measurable performance.
Use a separate read-only reviewer context for subjective judgments. A separate
run of the same model can supply review when no other family was requested;
record that limited diversity. The builder's self-score cannot supply the
required independent judgment.

The coordinator does not invoke the evaluator, test command, screenshot capture,
or benchmark during orientation or review. Workers own those runs. Root reads
their frozen receipts and raw outputs; if a receipt is missing, return the
bounded evidence task to the existing worker.

When the owner requests a council in this task, resolve three available model families across
distinct providers through the harness, honoring named members. Report missing
members instead of replacing them silently or claiming complete coverage.
Batch members within workspace/runtime concurrency limits. Reviewers receive
the same frozen revision, evidence, rubric and comparison set. On their initial
assessment, omit the desired numerical score, earlier scores, other reviewers'
answers, and builder advocacy. Ask for dimension evidence, reproducible findings,
uncertainty and dissent. Apply numerical thresholds at the coordinator.

Use fresh review tasks after fixes where the harness requires them. Fixes remain
builder-owned except mandatory small-review-fix handling by root. A higher score
does not settle an evidenced bug or authorize scope growth.

## Capture baseline

Have a worker run the chosen checks and capture the initial artifact and raw
results before changes. Keep baseline immutable. For a new product, establish a
runnable initial candidate first and label it as that baseline; do not invent a
prior UI. For bugs, start with the user-facing reproduction required by project.

For UI, capture matching routes, data, states, viewport, theme and zoom before
and after. Include relevant narrow layouts and key interactions, loading/error
states or accessibility checks as the task requires. Apply project design tokens,
platform conventions and reduced-motion rules. A screenshot supports appearance;
interaction and accessibility claims need their own checks.

If required capture or evaluation tools are unavailable, record the missing
evidence and keep its gate open. Continue only independent work the task allows.

## Run a round

1. Dispatch a bounded change against the current best candidate and open
   findings. Workers retain the original objective and allowed file scope.
2. Have workers run unchanged evaluation inputs and relevant regression checks.
   Capture raw outputs, exit codes and candidate revision/hash. Freeze that
   artifact while reviewers assess it; new edits require new evidence.
3. Review actual artifacts and results. Findings keep stable IDs with evidence,
   severity and fixed/disputed/declined status. Validate recommendations against
   the source; keep out-of-scope work as follow-up.
4. Promote only a candidate that passes all hard guards and meets the agreed
   improvement rule. Missing evidence or reviewer coverage means unverified.
   Retain the previous best when a candidate regresses. Preserve rejected work
   for recovery; rejection grants no permission to reset or discard other work.
5. Stop when acceptance is met, the round/usage limit is reached, progress stalls,
   or a material decision requires the owner. Otherwise start the next round
   under the harness's worker lifecycle.

For noisy model judgments, compare the candidate with the same baseline and
reference set in fresh contexts. Repeat uncertain important cases within budget
and report the variation. Passing a finite corpus is evidence for those cases,
not a guarantee of general behavior. Keep held-out cases when the task has a
meaningful corpus; do not expand a small change into a benchmark project.

## Evidence and handback

Keep a compact round receipt in the existing task, with raw artifacts in its
permitted evidence home. Private client data and runtime logs stay private.

```text
Round and candidate revision/hash:
Best retained revision/hash:
Evaluation contract and environment:
Primary metric / dimension judgments:
Hard guards, coverage and unresolved findings:
Baseline, candidate, raw checks and reviewer evidence paths:
Actual builder/reviewer model, provider, effort; usage if exposed:
Decision and reason; remaining rounds / next action:
```

For UI handback, provide original before/after captures and a labelled comparison
that identifies changed elements and why they changed. Keep annotations separate
from originals. State which views and interactions were actually checked.

Report the retained best candidate and stop reason. Distinguish acceptance met,
budget exhausted, stalled and blocked; none implies merge, release or deploy.
Unresolved subjective acceptance remains the owner's decision. Persist the best
candidate, pending workers and next action for continuation in the same task.
