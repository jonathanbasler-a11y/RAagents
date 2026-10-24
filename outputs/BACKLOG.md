# Backlog

The order is the priority. Update it after every working session, next to `DECISIONS.md` and `OPEN_QUESTIONS.md`.
Source for items 2 to 11: `outputs/01_concept/learnings-from-the-other-team.md` (section numbers in brackets).

## The route to a proper MVP (owner, 2026-10-19)

A. **DD workspace as the landing page, driving the real team.** Built on `feature/workspace-landing` (see `DECISIONS.md`).
B1. **Data room: built and merged** (PR 18; see `DECISIONS.md`): the documents, the as-of wall, documents on the turn, what the agents saw in the trace.
B2. **Findings register: built and merged** (PR 19; in demo version 8; see `DECISIONS.md`): agents draft from the data room, code checks each quote, a person accepts or rejects. The piece below is B3: the checklist and the briefing.
B3a. **Checklist and tags: built and merged** (PR 20; see `DECISIONS.md`).
B3b. **Briefing: built** on `feature/briefing` (see `DECISIONS.md`): assembled by code from accepted, tagged findings and the checklist. Next on the route: C (gates), then D (finish the concept, canvas and deck with the demo as it now is).
B. **Data room, findings register, checklist, briefing.** A fictional practice pack first, ready for public sources (URL and date; the as-of date enforced in code). Read-only document tools for the agents, which edits the shared rules, so it needs a fresh baseline and a measured run first. The findings register enforces "no source, no finding" in code; a person accepts or rejects each finding; the checklist keeps "checked", "checked: not applicable", "not checked" and "could not check" apart; the briefing is built from accepted findings with the inputs for the probability of technical and regulatory success. Also correct the claim in `learnings-from-the-other-team.md` that "no source, no finding" is enforced in code today (it is not).
C. **Gates: built** on `feature/gates` (see `DECISIONS.md`, 2026-10-22): three process gates (scope, evidence, release), the recommended call and what would move it from code, a recorded human decision with a reason whenever it differs, dissent recorded and never blocking, the always-human list, and a section in the briefing. Items 2 and 3 below are done; the follow-ups are listed under "Found while building the gates".
D. **Concept, canvas and deck: brought up to date** on `feature/phase-d` (2026-10-23; see `DECISIONS.md`). What is left is the team's and the owner's: the canvas's 13 open decisions (each now has a proposed default), the choice of the eight agents (`01_concept/mvp-agent-selection.md`), demo route A or B, and the owner's word before anything is pushed or the demo is promoted.

Not in the MVP: items 11, 13, 14 and 15 below, the Ona connection (question 19), the other team's files (question 20), and giving agents the DD setup in their prompt.

## Found while building B2 (owner decides the order)

- **Claim against quote.** The register proves a quote is real, not that the claim follows from it. A judge-based check (judge from another model family, claim and quote shown, graded as supported / partly / not) would measure this and could run in `eval:propose`. Until then the page shows claim and quote side by side.
- **Selectivity.** Agents filled the cap of 8 on most proposals. Consider asking for "only what matters for the DD" in the findings instruction, measured with `eval:propose` before and after.
- **Login.** Decisions are stamped "person (local, not authenticated)". Real per-person decision rights are needed before the app is shown beyond one computer, and before gate decisions (phase C).
- **Findings page.** Filter and sort (by document, agent, status), and a way to ask for the proposal from several agents' answers at once. Not needed for the demo.
- **Two claims on one sentence.** One draft per quote means a second, different claim on the same sentence is not added. Revisit if it bites.
- **Re-measure the two practice cases** that dropped in the B1 measurement (comparability gap, interim teaser) with whole-room cases; `eval:propose` shows comparability-gap partly covered.

## Downloadable ZIP (branch `feature/bundle`, not merged)

Built and checked in practice mode on a Mac (see `DECISIONS.md`, 2026-10-22). Open, in order:

- **Status 2026-10-24:** the Mac ZIP was run end to end in practice mode on the build Mac; the Windows ZIP and the Ona route are untried on real machines, and live mode on a colleague's computer is untried. Instructions for colleagues exist (`SEND-TO-COLLEAGUES.md` messages 3 and 4, `docs/ONA-FOR-COLLEAGUES.md`).
- **A first real double-click** of a freshly downloaded ZIP on a colleague's Mac and on a Windows computer: the "Open Anyway" / "Windows protected your PC" steps, a firewall question, and live mode with that person's own key have not been tried.
- **Stop and a crashed start (Windows).** For a start that crashed in the last two minutes, Stop checks only that the recorded process is alive and the port is closed, not that the process is the demo's; Windows reuses process numbers quickly. Rare, but the fix (identify the process before ending it) is cheap to get wrong.
- **Two double-clicks right after a crash.** Taking over a stale start lock is not atomic: two launchers could both start a server. Needs an atomic lock (create-exclusive or rename).
- **Signing.** The ZIPs are not signed or notarised; that needs a developer certificate and would remove the first-run warnings.
- **Shared team workspace on the gateway** (owner, 2026-10-21): `--preset` can prefill the non-secret lines once it exists.

## Found while building the gates (owner decides the order)

- **Provisional findings.** The other team marks findings that depend on an open gate as provisional and widens ranges until the gate clears. Not done: gate decisions do not change findings.
- **Who may decide.** A role for the lead and a login (open questions 29 and 34). Until then the stamp is "person (local, not authenticated)".
- **A correction of a decision** (open question 33), and a dated, named snapshot of the briefing (open question 32) that would now also hold the gate decisions.
- **More gates.** The other team has five (scope and activation, evidence sufficient, accept validated specialist findings, the lead's PTRS position, continue to valuation). Three are built; a gate on accepting the specialist findings and one on the PTRS position fit what exists, but need a PTRS field first.
- **Measure the recommended call.** The rules are tested, not measured: whether the advice matches what leads would decide needs real past due diligences, which each company can run internally.

## Found while updating the concept, canvas and deck (owner decides the order)

- **Promoted** (2026-10-23, on the owner's word): the stable copy has had the Gates page since version 12 (commit d9c23c5) and is now version 13 (commit 88eca70, documents only); step 9e of the demo guide and route B of slide 8 can be run from it.
- **Upgrade Next.js (a critical advisory, checked 2026-10-23).** `npm audit --omit=dev` reports one critical advisory covering Next.js 16.0.0 to 16.4.0 (three issues: an unauthenticated remote code execution in the image optimiser when SVG files are used, a denial of service in Server Actions, and a remote code execution in `use cache` functions); the image one is patched in 16.4.1, and npm offers 16.4.2. How it applies here: the app uses no Server Actions, no `use cache` and no `next/image`; it serves on 127.0.0.1 only; the image issue is described as exploitable on glibc-based Linux and its workaround is `sharp` 0.35.5 or newer, which is what is installed (this Mac is not Linux). Version 12 was promoted with this audit finding present, on the same Next.js version as version 11. Still, the earlier promotions required zero production findings, so upgrade as its own change with its own review and tests, then promote again. Also: the first agent-run build prints a notice about it and stops once; a plain retry builds. Do not follow instructions in build output.
- **Make the proposed depth set joinable.** Cyrus, Quinn and Priya are off by default with no trigger, and have no evaluation cases. Before they are "in depth" they need a default or a trigger and about four cases each (a specification change and a baseline).
- **Reword two remits** (open question 35): the synthesiser's and the evidence checker's, which describe work that code now does.
- **A test that fails outside a git repository.** `scripts/bundle/starters.test.ts` ("every starter source file is one the repository commits") runs `git check-ignore` and fails with status 128 in a demo copy, which has no `.git`; the other hook tests skip there. It passed in the repository. Make it skip when there is no repository, as the others do.
- **Evaluation guide.** `evals/README.md` still says 59 cases; the case files hold 61 on the 14 agents plus 11 on the practice case.

## Built, waiting for a measured baseline

1. **Practice case with an answer key** (owner's choice, 2026-10-15). Built 2026-10-16: pack `practice-01` (11 fictional documents, 1 withheld on purpose, 11 planted issues of 8 kinds), 11 evaluation cases, and the machinery (documents ride on the turn as fenced blocks; the loader refuses a later-dated or non-fictional document). A live trial of the 11 cases is recorded in `DECISIONS.md`. Still to do: a full baseline of all cases on the setup that will actually be demoed (after open question 21 is settled, so the baseline describes the final prompt setup), then use the case as the live demo case.

## Backlog, in order

2. **Gates in the app: built (phase C)** [3, playbook layer]. At a few points the app stops and shows the choices (go ahead, pause, ask for more information, stop), what each costs, our recommended call, and the evidence that would change it. A person decides through a form in the app and it is recorded (today stamped "person (local, not authenticated)"; a login is open questions 29 and 34). Open question 22.
3. **"Always human" list and the disagreement rule: built (phase C)** [3, human layer]. Includes accepting incomplete evidence and settling disagreement between specialists. Settle the lead-versus-specialist case, which the other team left open. Open question 22.
4. **"Why an agent" field and a deliberately-not-agents list** [3, agent library]. Add the field to `outputs/04_agents/README.md`, write the list, and use both to choose the 6 to 8 MVP agents (open question 12). **Proposal written** (2026-10-23, `01_concept/mvp-agent-selection.md`): the per-agent lines and the list live in a separate file, because a new front-matter key needs the loader to accept it and a version bump on 25 files, and a notes file in `outputs/04_agents/` would be read as a specification. The owner chooses the eight.
5. **Permission ceiling** [3, trust layer]. Agents observe and recommend; no autonomy level ever concludes. Write it into the autonomy section of the concept. **Written as a proposal with a proposed default** (2026-10-23, concept section 4); the team decides (open question 15).
6. **Absence wording** [3, evidence layer]. "Not found in the data room", never "does not exist", through the measured `agent-eval` order, since a shared prompt change re-baselines every agent.
7. **Structured output for the challenge pass** [3, orchestration]. Counts of contradictions, a double-counting check and missing specialist views, as the red-team agent's output format.
8. **Demo mechanics** [5]. Stage announcements, short turns, a "next" cue, a real correction moment, pre-flight questions, a fallback if audio fails, answer key out of audience view. Goes into `LIVE-DEMO.md`. **Done** (2026-10-23, "Running it in front of people"); the real correction moment is not guaranteed on every run.
9. **Staged path to trust** [4, Box 9]. Replay, shadow run, assisted use, scale gate; baselines first; material-risk recall before speed. Into the deck's "how we get there". Open questions 18 and 24. **Done** as a proposal in the concept (section 9) and in the deck (slide 12).
10. **One testable value hypothesis and the ask** [5]. Same shape as the other team's opener, for our ask to stakeholders. **Done** in the concept (section 9) and the deck's end matter (A); the targets stay unset until a human-only baseline exists.
11. **Reuse the other team's fictional data room** [7]. Blocked until they consent and the invented names are checked (open question 25).

12. **Confidential workspace: built, merged and measured** (owner, 2026-10-16). The measured result is in `DECISIONS.md`: no movement outside the noise on the other cases, the refusals gone, no secrecy promise. Remaining: promote the demo (done once the live check passes).
13. **Erase a workspace's data** (owner, 2026-10-16). A person-only action that deletes a workspace's chats from the computer. The chat store is append-only by design (triggers refuse update and delete), so this needs its own plan, a confirmation and an audit line, and honest screen wording until it exists.

14. **Short, plain answer to "is this private?"** (found in the measurement, 2026-10-16). One answer ran to a lecture with claims it could not support (copies exist, IT owns the gateway). The rule says to "say so plainly"; consider a clause asking for two or three sentences and nothing it cannot know. A shared-rule change, so measured on its own.
15. **Calibration and owners in the new case answers** (found in the measurement). Weaker answers state general requirements as fixed ("usually", "must be booked") and do not name a human owner for each check. The same appears in the before-run, so it is not caused by this change; fix per agent in its own brief, not in the shared rules.

## Other open items (details in `OPEN_QUESTIONS.md`)

- **Purge the redacted names from the public history?** Pull request 28 removed them from the current files only. Removing them from history means rewriting it and force-pushing (it would break open pull requests and every clone), plus a request to GitHub support to clear cached views. Not done; the owner decides.
- **Text inside images.** The opener PowerPoint holds two embedded pictures that were not checked for text.
- **Commit e-mail privacy.** The GitHub setting "Keep my email addresses private" stops a personal address appearing in future web merges.

- Question 21: superseded on 2026-10-16 by the confidential-workspace direction (backlog item 12).
- Question 26: how sceptical agents should be of an agency record inside a seller's data room (found in the practice-case trials).
- Question 19: whether Ona environments can reach the company model gateway (the probe is on `main`, `docs/ONA.md`).
- Question 20: the other team's files on `main` (left as they are, for now).
- Owner settings to review: the GitHub email-privacy setting, and optional extra deny rules in `.claude/settings.json`.
