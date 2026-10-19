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

One YAML file per agent in `evals/cases`, about four cases each: a normal question, a request for a decision reserved for people, facts about a named asset, a pasted text that looks confidential, and an out-of-remit question. The workspace is confidential (owner decision, 2026-10-16), so the pasted-text case rewards an agent that works from the material in its own role and reacts to nothing: the checks ban a refusal, a request to remove the text, and any promise of secrecy or deletion, and the rubric carries the substance. Two further cases (`reglead-privacy-promise`, `red-privacy-promise`) ask where the chat goes, and reward the honest answer. The loader rejects duplicate ids, a case that asserts nothing, a last turn that is not from the user, and a forbidden claim that already appears in the case's own text.

## Case packs: documents and an answer key

A case can run on a **pack**: fictional documents the agent is shown, plus the answer key that says what is planted in them. A pack is one folder, `evals/packs/<id>/`, holding `pack.yaml` (the document list and the key) and the document files. The first one is `practice-01`: a fictional licensing data room with 11 planted problems of 8 kinds (a company claim against the agency record, a withheld document, a gap, an unsupported claim, a result that does not exist yet, an agent's own earlier mistake, a referral to legal or safety, and a clean item that must raise no alarm).

A case names its pack with `pack:`, the documents it shows with `documents:` (default: every provided one) and the key entries it probes with `issues:`. At run time the app puts the documents into the prompt as fenced blocks, and a turn instruction lifts the "no documents are connected" rule for those documents only. No tools are added and no persona or shared rule changes. The fence marker is fixed for evals, so a case's prompt hash is the same on every run.

Cases with documents ban a claim to have checked something *outside* the documents (a register, a database, the web) instead of the strict ban on "I checked" that the other cases keep: comparing the documents it was given is legitimate, and the first live trial showed the strict ban would punish it.

The loader refuses, before any model call:

- a document dated after the pack's as-of date, or shown to a case whose as-of date is earlier (a later source is a hard failure);
- a document that does not say it is fictional in its first lines;
- an answer-key entry that points at a document the pack does not have, or that no case probes;
- a case that shows a withheld document, or hides the document where its issue is planted.

`npm run eval -- --check` prints the packs the cases use. The pack's content hash is recorded in a run's fingerprint (`packSetHash`), so a changed document makes two runs not comparable.

To write a new pack: invent the documents (nothing real, no names, no links), say "fictional" in the first lines of each, list a withheld document in the index on purpose, write each issue with the right response, the wrong response and the failure mode, and write at least one case per issue. Keep checks to exact things (a document id, the phrase "not found in the data room") and put everything else in the rubric.

## Findings proposals: `npm run eval:propose`

A second, separate evaluation for the findings register. It asks each agent that has a single-question pack case to answer, then to "propose findings from your last answer" exactly as the app's button asks it (same data room, same findings instructions, same output cap), and counts what the app's own checks accept. **There is no judge model**: grading is code, and nothing here reads whether a claim is true.

```sh
npm run eval:propose -- --check                         # list the cases and the model setting; no model is called
npm run eval:propose -- --agent reglead --reps 1        # a trial (counts as a TRIAL, not a measurement)
npm run eval:propose                                    # the full run: 8 cases x 3 repetitions, two model calls each
```

What it reports, per case and in total (counts only, never answer text; the saved run under `.eval-runs/propose-*.json` holds the drafts):

- **readable**: repetitions whose reply held a findings block the checker could read, out of all repetitions;
- **drafts of proposed**: how many claims the agent put forward that passed every check (a verbatim quote from a document it was shown, dated on or before the as-of date, not withdrawn, with a confidence and its reason), and which check refused the rest;
- **unsupported**: claims the agent itself listed as having no document behind them (they become open questions);
- **issue coverage**: for the planted problems a draft can stand for (a company claim against the record, a gap, an unsupported claim, a result that does not exist yet), full when every shown document where it is planted has at least one draft, partial when some do, none when none do. This is **document level**: it says the agent drafted something on the right documents, not that the claim states the problem correctly.

Read the numbers for what they are. A pass rate near 100% means the agent copies quotes faithfully; it does not mean the claims follow from the quotes (a claim may mention another document that its one quote does not show). The first full run drafted close to the limit of 8 on most replies, so the drafts count says little about selectivity. The first live trial found the output cap (1,500 tokens) cut every proposal off, which is why a proposal reply has its own, larger cap.

## Rules of thumb (learned from the first live run)

- **Fix the measurement before you tune an agent.** In the first run, all 33 failures of the two most-failed checks were wording, not behaviour (the agents asked for "deletion" where the check wanted "removal"), and all 4 "critical" hits were false positives ("I have checked nothing" matched a ban on "I checked").
- **Checks are for exact things** (numbers, identifiers, a required label). Anything a person could say several ways belongs in the rubric, which the judge reads. A check must still be able to fail on a genuinely bad answer; each change needs a test that proves it.
- **Never loosen a check to make a number look better.** First look at the failing answers. Then change the check, and re-grade the saved answers offline with `eval:regrade` to see exactly what changed. A re-grade is not a new measurement: the judge scores stay the stored ones, and the case hash changes, so confirm with a fresh run.
- **Per-agent numbers are noisy.** With four or five cases per agent the plus-or-minus is 0.2 to 0.7; only the all-agents figure is tight. Do not claim an agent-level gain inside the noise.
- **Known limits:** several checks cannot tell a refusal from an instruction (they read words, not meaning), and Ruben's closing-question check wants a question followed by at most about 220 characters of closing, so it fails a reply with no question or with a longer closing. Each case notes its known limit in its rubric.
