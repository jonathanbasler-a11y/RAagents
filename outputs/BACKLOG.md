# Backlog

The order is the priority. Update it after every working session, next to `DECISIONS.md` and `OPEN_QUESTIONS.md`.
Source for items 2 to 11: `outputs/01_concept/learnings-from-the-other-team.md` (section numbers in brackets).

## The route to a proper MVP (owner, 2026-10-19)

A. **DD workspace as the landing page, driving the real team.** Built on `feature/workspace-landing` (see `DECISIONS.md`).
B1. **Data room: built and merged** (PR 18; see `DECISIONS.md`): the documents, the as-of wall, documents on the turn, what the agents saw in the trace.
B2. **Findings register: built** on `feature/findings-register` (see `DECISIONS.md`): agents draft from the data room, code checks each quote, a person accepts or rejects. Not yet merged or in the demo. The piece below is B3: the checklist and the briefing.
B3a. **Checklist and tags: built** on `feature/checklist` (see `DECISIONS.md`). B3b, the briefing assembled by code from accepted, tagged findings and the checklist, is next.
B. **Data room, findings register, checklist, briefing.** A fictional practice pack first, ready for public sources (URL and date; the as-of date enforced in code). Read-only document tools for the agents, which edits the shared rules, so it needs a fresh baseline and a measured run first. The findings register enforces "no source, no finding" in code; a person accepts or rejects each finding; the checklist keeps "checked", "checked: not applicable", "not checked" and "could not check" apart; the briefing is built from accepted findings with the inputs for the probability of technical and regulatory success. Also correct the claim in `learnings-from-the-other-team.md` that "no source, no finding" is enforced in code today (it is not).
C. **Gates** (items 2 and 3 below): go ahead, pause, ask for more, stop; the recommended call and the evidence that would change it; a recorded human decision; the always-human list. Open question 22.
D. **Concept, canvas and deck** (`outputs/01_concept`, `02_canvas`, `03_deck`): drafted alongside B and C, finished last.

Not in the MVP: items 11, 13, 14 and 15 below, the Ona connection (question 19), the other team's files (question 20), and giving agents the DD setup in their prompt.

## Found while building B2 (owner decides the order)

- **Claim against quote.** The register proves a quote is real, not that the claim follows from it. A judge-based check (judge from another model family, claim and quote shown, graded as supported / partly / not) would measure this and could run in `eval:propose`. Until then the page shows claim and quote side by side.
- **Selectivity.** Agents filled the cap of 8 on most proposals. Consider asking for "only what matters for the DD" in the findings instruction, measured with `eval:propose` before and after.
- **Login.** Decisions are stamped "person (local, not authenticated)". Real per-person decision rights are needed before the app is shown beyond one computer, and before gate decisions (phase C).
- **Findings page.** Filter and sort (by document, agent, status), and a way to ask for the proposal from several agents' answers at once. Not needed for the demo.
- **Two claims on one sentence.** One draft per quote means a second, different claim on the same sentence is not added. Revisit if it bites.
- **Re-measure the two practice cases** that dropped in the B1 measurement (comparability gap, interim teaser) with whole-room cases; `eval:propose` shows comparability-gap partly covered.

## Built, waiting for a measured baseline

1. **Practice case with an answer key** (owner's choice, 2026-10-15). Built 2026-10-16: pack `practice-01` (11 fictional documents, 1 withheld on purpose, 11 planted issues of 8 kinds), 11 evaluation cases, and the machinery (documents ride on the turn as fenced blocks; the loader refuses a later-dated or non-fictional document). A live trial of the 11 cases is recorded in `DECISIONS.md`. Still to do: a full baseline of all cases on the setup that will actually be demoed (after open question 21 is settled, so the baseline describes the final prompt setup), then use the case as the live demo case.

## Backlog, in order

2. **Gates in the app** [3, playbook layer]. At a few points the app stops and shows the choices (go ahead, pause, ask for more information, stop), what each costs, our recommended call, and the evidence that would change it. A person decides through an authenticated action, and it is recorded. Open question 22.
3. **"Always human" list and the disagreement rule** [3, human layer]. Includes accepting incomplete evidence and settling disagreement between specialists. Settle the lead-versus-specialist case, which the other team left open. Open question 22.
4. **"Why an agent" field and a deliberately-not-agents list** [3, agent library]. Add the field to `outputs/04_agents/README.md`, write the list, and use both to choose the 6 to 8 MVP agents (open question 12).
5. **Permission ceiling** [3, trust layer]. Agents observe and recommend; no autonomy level ever concludes. Write it into the autonomy section of the concept.
6. **Absence wording** [3, evidence layer]. "Not found in the data room", never "does not exist", through the measured `agent-eval` order, since a shared prompt change re-baselines every agent.
7. **Structured output for the challenge pass** [3, orchestration]. Counts of contradictions, a double-counting check and missing specialist views, as the red-team agent's output format.
8. **Demo mechanics** [5]. Stage announcements, short turns, a "next" cue, a real correction moment, pre-flight questions, a fallback if audio fails, answer key out of audience view. Goes into `LIVE-DEMO.md`.
9. **Staged path to trust** [4, Box 9]. Replay, shadow run, assisted use, scale gate; baselines first; material-risk recall before speed. Into the deck's "how we get there". Open questions 18 and 24.
10. **One testable value hypothesis and the ask** [5]. Same shape as the other team's opener, for our ask to stakeholders.
11. **Reuse the other team's fictional data room** [7]. Blocked until they consent and the invented names are checked (open question 25).

12. **Confidential workspace: built, merged and measured** (owner, 2026-10-16). The measured result is in `DECISIONS.md`: no movement outside the noise on the other cases, the refusals gone, no secrecy promise. Remaining: promote the demo (done once the live check passes).
13. **Erase a workspace's data** (owner, 2026-10-16). A person-only action that deletes a workspace's chats from the computer. The chat store is append-only by design (triggers refuse update and delete), so this needs its own plan, a confirmation and an audit line, and honest screen wording until it exists.

14. **Short, plain answer to "is this private?"** (found in the measurement, 2026-10-16). One answer ran to a lecture with claims it could not support (copies exist, IT owns the gateway). The rule says to "say so plainly"; consider a clause asking for two or three sentences and nothing it cannot know. A shared-rule change, so measured on its own.
15. **Calibration and owners in the new case answers** (found in the measurement). Weaker answers state general requirements as fixed ("usually", "must be booked") and do not name a human owner for each check. The same appears in the before-run, so it is not caused by this change; fix per agent in its own brief, not in the shared rules.

## Other open items (details in `OPEN_QUESTIONS.md`)

- Question 21: superseded on 2026-10-16 by the confidential-workspace direction (backlog item 12).
- Question 26: how sceptical agents should be of an agency record inside a seller's data room (found in the practice-case trials).
- Question 19: whether Ona environments can reach the company model gateway (the probe is on `main`, `docs/ONA.md`).
- Question 20: the other team's files on `main` (left as they are, for now).
- Owner settings to review: the GitHub email-privacy setting, and optional extra deny rules in `.claude/settings.json`.
