# Backlog

The order is the priority. Update it after every working session, next to `DECISIONS.md` and `OPEN_QUESTIONS.md`.
Source for items 2 to 11: `outputs/01_concept/learnings-from-the-other-team.md` (section numbers in brackets).

## Next up

1. **Practice case with an answer key** (owner's choice, 2026-10-15). A case with about ten planted problems. For each one: where it is planted, what a good agent does, what a bad agent does, and how we score it. Plus the case types we lack: a document withheld on purpose, a clean item that must raise no alarm, an agent mistake a person must correct, and a question that must be handed to legal or safety. It runs through our real agents and the evaluation harness (the `agent-eval` order), and doubles as the live demo case. A plan is approved first (open question 23).

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

## Other open items (details in `OPEN_QUESTIONS.md`)

- Question 21: shorter replies after a pasted confidential text. Explained to the owner 2026-10-15; decision pending.
- Question 19: whether Ona environments can reach the company model gateway (the probe is on `main`, `docs/ONA.md`).
- Question 20: the other team's files on `main` (left as they are, for now).
- Owner settings to review: the GitHub email-privacy setting, and optional extra deny rules in `.claude/settings.json`.
