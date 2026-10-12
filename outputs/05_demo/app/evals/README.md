# Evaluating the agents

The evaluation measures how the 14 agents with cases answer, using the app's own `runAgent`, so what is measured is what the app does. It follows `docs/BUILD-LEARNINGS.md` Part 9.

## What a run does

Each case runs three times. Every answer gets deterministic checks (required and forbidden wording), then a judge from a **different model family** scores it 1 to 5 on task success, usefulness, grounding, role fit and clarity, against the case's rubric. An answer is "good" when every check passed and the judge gave at least 4. A run fails fast after three unusable answers in a row, and records a fingerprint (commit, prompts, cases, judge prompt, models) so two runs are only compared when it is clear what changed.

## Commands (from `outputs/05_demo/app`, Node 24, on the company VPN)

```sh
npm run eval -- --check                      # validate the cases and the settings; no model is called
npm run eval -- --agent reglead --reps 1     # a trial: one agent, one repetition (the run counts as INVALID, by design)
npm run eval                                 # the full run: 59 cases x 3 repetitions (about 40 minutes, about 350 model calls)
npm run eval -- --baseline <saved run file>  # compare with an earlier run, case by case
npm run eval:regrade -- <saved run file>     # offline: re-run today's checks on a saved run's stored answers
```

Runs are saved under `.eval-runs/` (git-ignored, local). The verdict says whether the run is a valid measurement; it is not a quality grade.

## Cases

One YAML file per agent in `evals/cases`, about four cases each: a normal question, a request for a decision reserved for people, facts about a named asset, a pasted text that looks confidential, and an out-of-remit question. The loader rejects duplicate ids, a case that asserts nothing, a last turn that is not from the user, and a forbidden claim that already appears in the case's own text.

## Rules of thumb (learned from the first live run)

- **Fix the measurement before you tune an agent.** In the first run, all 33 failures of the two most-failed checks were wording, not behaviour (the agents asked for "deletion" where the check wanted "removal"), and all 4 "critical" hits were false positives ("I have checked nothing" matched a ban on "I checked").
- **Checks are for exact things** (numbers, identifiers, a required label). Anything a person could say several ways belongs in the rubric, which the judge reads. A check must still be able to fail on a genuinely bad answer; each change needs a test that proves it.
- **Never loosen a check to make a number look better.** First look at the failing answers. Then change the check, and re-grade the saved answers offline with `eval:regrade` to see exactly what changed. A re-grade is not a new measurement: the judge scores stay the stored ones, and the case hash changes, so confirm with a fresh run.
- **Per-agent numbers are noisy.** With four or five cases per agent the plus-or-minus is 0.2 to 0.7; only the all-agents figure is tight. Do not claim an agent-level gain inside the noise.
- **Known limits:** several checks cannot tell a refusal from an instruction (they read words, not meaning), and Ruben's closing-question check wants a question followed by at most about 220 characters of closing, so it fails a reply with no question or with a longer closing. Each case notes its known limit in its rubric.
