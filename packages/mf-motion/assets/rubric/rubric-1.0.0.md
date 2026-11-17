# Rubric 1.0.0

Six axes, scored as integers 1-10 by a judge who sees only the packet. Each axis has one question. The judge scores against the anchors; a score between two anchors means "better than the lower, not yet the higher".

Targets: 8 on every axis at runtime; 9 on every axis, aspect and mode for the library.

## hook

Question: In the first second, does a viewer see something worth watching that belongs to this brand?

| Score | Anchor |
|---|---|
| 10 | Frame 0 already shows the product, a result or a bold line; by 1 s the viewer knows what this is and wants the next beat. |
| 9 | Strong opening image by 0.3 s and a clear promise by 1 s; one small hesitation. |
| 8 | Content by 0.5 s, purpose clear by 1.5 s. |
| 7 | Opens on a generic title or logo but moves to content within 1.5 s. |
| 5-6 | A title fading over brand colour; purpose clear only after 2 s. |
| 3-4 | Empty, black or logo-only opening longer than 1 s. |
| 1-2 | Nothing readable or nothing happening in the first 2 s. |

For moves: "first second" means the first 0.5 s of the move's own clock; overlays are judged on how quickly the idea reads once ink appears.

## brand

Question: Would the brand's own designer recognise this as theirs?

| Score | Anchor |
|---|---|
| 10 | Real brand material (logo, real screens, real copy voice) used with the brand's own palette roles and type; nothing generic. |
| 9 | Palette roles and type exact; real material present; one element feels borrowed from a template. |
| 8 | Correct colours and fonts; real material present but secondary. |
| 7 | Correct colours; generic shapes and stock-like layouts dominate. |
| 5-6 | Colours roughly right, type wrong, no real material. |
| 3-4 | Could be any brand. |
| 1-2 | Conflicts with the brand (wrong colours, misused logo). |

## motion

Question: Does every movement have intent, weight and a clear cause?

| Score | Anchor |
|---|---|
| 10 | Arrivals land with weight, exits are faster than entrances, overlaps are tuned, camera moves are motivated, nothing floats. |
| 9 | All of the above with one slightly generic ease or stagger. |
| 8 | Purposeful and varied; a few moves feel mechanical. |
| 7 | One ease and one timing used everywhere; competent but uniform. |
| 5-6 | Fade-and-slide on everything; idle loops or creeping scales. |
| 3-4 | Jittery, abrupt or random movement. |
| 1-2 | Motion that obstructs reading or looks broken. |

## legibility

Question: Can every word be read once, comfortably, on a phone?

| Score | Anchor |
|---|---|
| 10 | Every line holds long enough, sized for the phone sheet, high contrast, never competing with another line. |
| 9 | One line slightly fast or small, still readable. |
| 8 | All readable; one or two need a second look. |
| 7 | Readable on desktop, strained on the phone sheet. |
| 5-6 | Some lines too fast, small or low-contrast to read once. |
| 3-4 | Several lines unreadable. |
| 1-2 | Most copy unreadable. |

## rhythm

Question: Does the cut, motion and sound pattern feel deliberate, with no dead air?

| Score | Anchor |
|---|---|
| 10 | Something new on every beat, layout changes on the bar, holds only where meaning needs them, sound hits land on picture. |
| 9 | Same, with one beat that drags or rushes. |
| 8 | Even pacing; a few soft spots. |
| 7 | Pacing follows a grid mechanically; no variation in energy. |
| 5-6 | Noticeable dead stretches or crowded bursts. |
| 3-4 | Long still stretches; cuts unrelated to the beat. |
| 1-2 | No discernible rhythm. |

For silent moves, rhythm judges motion cadence against the move's own timing.

## finish

Question: Does it look and sound finished, with nothing a professional would fix?

| Score | Anchor |
|---|---|
| 10 | Clean edges, consistent spacing and radii, no banding, no clipping, correct alpha edges, mixed loudness on target. |
| 9 | One minor craft flaw visible only on close inspection. |
| 8 | Two or three minor flaws. |
| 7 | A flaw visible at normal viewing (misalignment, banding, harsh shadow). |
| 5-6 | Several visible flaws. |
| 3-4 | Looks like a draft. |
| 1-2 | Broken output. |

## Fix lines

Any axis whose judge score is under the active target carries at least one fix: `{ at, where, problem, change }`, each one sentence, `change` stating an exact edit (a number, an element, a timing), never an adjective. Example: `{ "at": "4.20-5.00", "where": "headline in shot 3", "problem": "holds 0.6 s for 6 words", "change": "extend the hold to 2.3 s by moving the exit from bar4 to bar5" }`.
