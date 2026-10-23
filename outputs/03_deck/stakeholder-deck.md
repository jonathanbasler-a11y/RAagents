# Stakeholder deck: Digital Human Hybrid Team (draft 2)

**Status:** draft for the owner, updated 2026-10-23 (first written 2026-10-19). Slide-by-slide Markdown; no PowerPoint yet (Markdown first, by repository rule). Nothing here is agreed by the team unless a line says so.
**Audience:** senior stakeholders. Who they are, and what we want from them, is not known yet (open question 7), so the ask slide offers options.
**Slot length: unknown (open question 2).** The deck is designed for 25 minutes of speaking. It is not known whether questions fall inside or outside the slot. If the slot includes questions, plan for about 20 minutes of talk and cut as shown in "If the slot is 15 minutes" below.

## How to read this file

- `(V#)` points to the list "Statements marked to verify" at the end of the file.
- `[to decide with the owner]` marks a choice the owner has not made. `[placeholder: ...]` marks a result that does not exist yet. Neither may be filled with an invented value.
- `(my proposal)` marks my own reasoning, not a team decision.
- Status tags on slides: **Built** (exists and was shown working), **Designed** (described, not built), **Concept** (shown only to prove the model scales).
- Speaker functions are roles. No slide names a person. Hand-overs between speakers are planned at about 15 seconds each (a planning estimate of mine, not timed: V19); keep to four or five speakers at most.

## Honesty ledger: what the deck may claim (as of 2026-10-23)

| Built (may be shown) | Not built yet (must be said as "next", never as done) |
|---|---|
| 25 named AI teammates, each with a written specification, a human owner role and an autonomy level | Login and per-person decision rights (the app has no login: decisions are stamped "person (local, not authenticated)") |
| One-to-one rooms, and a team chat that routes a question to the right teammates; people can add or remove teammates from the chat itself | Data walls between people |
| A DD setup (stage and asset type) that decides who is on the team | A known-outcome run on a public asset (no asset chosen: open question 5) |
| A confidential-workspace rule and labels: every reply says "Model output, not sourced"; the rule that no agent decides a reserved question is briefed in the prompts, not enforced in code | A recorded fallback of the live demo (to be made, V4) |
| A data room with an as-of date; a document dated after that date is refused and never shown to the agents; a withdrawal keeps the record | Public sources and tools for the agents (today documents ride on each turn, and only when a data room is loaded) |
| A fictional practice case with an answer key, and an evaluation harness with a judge from a different model family | A check that a claim follows from its quote (open question 28): the quote is proved real, not that the claim follows from it |
| A demo copy that is kept stable while development goes on (version 11, commit b1282e1: the data room, the findings register, the checklist and the briefing; the gates are on `main` but not yet in the stable copy: V3) | Provisional findings; correcting a decision once made; a dated snapshot of the briefing |
| A findings register (about 2 minutes in the demo, step 9b, needs the real model): a person asks an agent in its own room to propose findings; code keeps a claim only with a quote word for word in a document the agent was shown, and the rest become open questions; a person accepts or rejects each draft once | |
| A checklist of six items in four distinct states (checked, checked: not applicable, not checked, could not check): "checked" is possible only with an accepted finding behind it, and code and database both refuse it otherwise | |
| A briefing assembled by code, with no model, from accepted, tagged findings and the checklist: it says first what is missing and says it is not a decision; the inputs for the probability of technical and regulatory success (PTRS) are listed, and the app computes no number | |
| Three gates where a person decides (scope and activation, the evidence is enough, release the briefing): the facts and the recommended call come from code, a reason is required when the choice differs, a dissent is recorded and never blocks, and a person decides, not the app | |

Two facts to keep in mind on every slide: (1) today the agents have no tools; documents ride on the turn only when a data room is loaded. (2) The demo asset is fictional. Attendees come from several companies, so no confidential material is used live.

## Minute budget (main slides add up to 25)

| # | Slide | Min | Speaker function |
|---|---|---|---|
| 1 | Title | 0.5 | RA lead |
| 2 | Why now | 1.5 | Technical development |
| 3 | Today's problem | 2.5 | Medical affairs |
| 4 | Vision | 1.5 | RA lead |
| 5 | Architecture | 2.5 | Technical development |
| 6 | The hybrid team roster | 1.5 | Medical affairs |
| 7 | The DD playbook | 2.5 | RA lead |
| 8 | LIVE DEMO | 4.5 | RA lead at the keyboard, CMC reads the replies |
| 9 | What the demo showed | 2.0 | Technical development |
| 10 | Expansion playbooks | 1.5 | CMC |
| 11 | Mindset shift and change management | 1.5 | Medical affairs |
| 12 | How we get there | 1.5 | Technical development |
| 13 | The ask | 1.5 | RA lead |
| | **Total** | **25.0** | |

### If the slot is 15 minutes (what to cut)

Merge slides 2 and 4 (1.5 min together). Fold slide 6 into slide 5 (one sentence on the roster, 0 min). Cut slide 3 to 1.5 min, slide 5 to 2 min, slide 7 to 1.5 min. Run the demo's 3-minute core (steps 1, 3, 5, 6, 7 and 10 of `outputs/05_demo/app/LIVE-DEMO.md`) in 3 min and keep slide 9 at 1.5 min. Cut slide 10 to one spoken sentence (0.5 min). Merge slides 11 and 12 (1.5 min). Keep the ask at 1.5 min. Total: 0.5 + 1.5 + 1.5 + 2 + 1.5 + 3 + 1.5 + 0.5 + 1.5 + 1.5 = 15.0. Never cut slide 9 or the "not built yet" line: they are what makes the rest believable.

Note on this cut (my proposal): the 3-minute core leaves out steps 9 to 9e (the data room, the findings, the checklist, the briefing and the gates), so in the 15-minute version slide 9's "Shown working" line must list only what the core shows: the team assembling from the setup, routing by name and by topic, the trace of every turn, and decisions left to people. Say that the data room, the findings register, the checklist, the briefing and the gates exist but were not shown. The budget above has no slack to keep any of them, and I have not re-cut it.

---

# MAIN SLIDES

## Slide 1: Title

**Minutes:** 0.5 | **Speaker function:** RA lead
**Slide purpose:** say what we are and set the tone: a concept with a working demo, not a finished product.

**On the slide**
- Digital Human Hybrid Team
- Human experts and AI agents working as one team on a regulatory milestone
- First example: regulatory due diligence (DD) of an external asset
- Moonflower group, Digital Adoption Accelerator, October 2026

**Speaker note:** We are a group of senior leaders from regulatory affairs, technical development, CMC and medical affairs. Two teams worked separately and are merging their best ideas into one concept. Today we show the idea, a working demo on a fictional asset, and what we need from you. We will say clearly what exists and what does not.

---

## Slide 2: Why now

**Minutes:** 1.5 | **Speaker function:** Technical development
**Slide purpose:** give the stakeholder a reason to care this year, in the team's own words and without invented numbers.

**On the slide**
- Everyone is overloaded; resources are tight
- Technology has reached the point where one person's use of AI can become a team's, and then the enterprise's
- Agents can take the time-consuming, less strategic tasks
- We need to be early, and to show a successful implementation, not a slide

**Speaker note:** These four points come from the team's own canvas discussion; we have no market statistics and we are not quoting any. The practical point is capacity: urgent regulatory questions arrive without warning and pull scarce experts off their planned work. The technology question is no longer "can one person use it" but "can a team use it with clear owners and rules". We want to answer that on a contained example before anyone scales it.

---

## Slide 3: Today's problem (canvas boxes 4 to 6)

**Minutes:** 2.5 | **Speaker function:** Medical affairs
**Slide purpose:** show that the real problem is behaviour under time pressure, not a missing tool. Result, behaviour, mindset, in that order.

**On the slide**
- **Results (box 4).** Best today: the right regulatory insight, delivered fast, with confidentiality kept. Worst: missing information, overlooked risks that damage the business case, and no adequate regulatory view in the time available
- **Behaviours (box 5).** Best: the DD owner spots cross-functional overlaps and brings in the right functions. Worst: functions or information left out for speed; the DD owner answers a question that belongs to another function
- **Mindsets (box 6).** Best: DD is cross-functional and needs every domain. Worst: "I have enough information in my area to make the call"; keeping the read-in group smaller than it should be; DD practice varying by therapeutic area out of habit
- **Our reading** [suggested, not yet agreed by the team]: under pressure, teams trade inclusion for speed and skip experts

**Speaker note:** This comes from experience, not measurement; we have no baseline numbers and we say so. Notice that the worst results trace back to the worst behaviours: when the clock runs, the owner narrows the circle and answers alone. The good news, in our experience and not measured, is that the best behaviours already exist in people. Our aim is to make the inclusive choice the fast choice. Confidentiality matters: the people read in must stay few, so inclusion has to come with controlled access, not with a wider circle.

---

## Slide 4: Vision

**Minutes:** 1.5 | **Speaker function:** RA lead
**Slide purpose:** define the concept in one sentence and show where it could grow, with outcomes we could measure.

**On the slide**
- Human domain experts and AI agents work as one team to deliver a specific regulatory activity or milestone
- Umbrella: fast, well-founded answers to unexpected regulatory questions. DD is the first example
- Long term: some activities run by a mostly digital team, always with an accountable person [wording: my proposal]
- What we aim to change: reactive DD stops being a panic and becomes predictable [an aim, not yet shown]
- What we could measure [suggested, not yet agreed]: issues found earlier and more completely; turnaround time; findings traceable to sources; all functions covered

**Speaker note:** The name says what it is: humans and agents on one team, each agent with a named human owner. We chose DD because every regulatory organisation does it, in planned and in reactive form, and the value is most visible when the request is urgent. The long-term idea of a largely digital team for some activities needs one condition: a person stays accountable, and decisions such as deal-breakers, the overall assessment and the recommendation stay with people. We name the measures now so we can be held to them later.

---

## Slide 5: Architecture (one clean layer model)

**Minutes:** 2.5 | **Speaker function:** Technical development
**Slide purpose:** show that new use cases are cheap because the foundations are built once. Proposes one clean answer to "5 or 6 layers" for the audience (the team's decision is still open, open question 4).

**Diagram** (bottom to top; people drawn as a frame around the layers) [my proposal: five layers plus a human frame]
- **1. Trust:** decision rights, data rules, privacy, audit record, a red team, and controlled sharing of information (data walls)
- **2. Evidence and knowledge:** a verified knowledge base; standard finding format (claim, evidence, source, confidence, assumptions, owner, status); "No source, no finding"
- **3. Agent library:** agents built separately from playbooks, so one agent serves many playbooks
- **4. Orchestration:** sends the right agent to the right task: plan, assign, assess, challenge, combine, escalate, decide, learn
- **5. Playbook:** one per use case: key questions, agents, sources, outputs, decisions reserved for people
- **Frame, the human layer:** agent owner, playbook owner, decision owner, and the person who activates the team

**Bullets on the slide**
- The test: a new use case needs a new playbook and a few new agents, never a new trust or evidence layer
- Autonomy is a dial per agent: 1 Assist, 2 Collaborate, 3 Delegate under oversight. DD starts at 2; agents can earn more
- Status: parts of each layer are **Built**, including the findings register, the checklist, the briefing and the gates (a person decides each; no login yet); data walls and login are not (see backup B5)

**Speaker note:** The team said "five layers" but listed six; our proposed clean version (not yet decided by the team) is five layers with the human role as a frame around them, because people sit around every layer rather than on top of one. Trust and evidence are built once and serve every playbook. That is where the scalability claim stands or falls, and we say plainly that it is a claim to test, not a result: it has so far been tried only on regulatory use cases. Be clear about status: the layers exist in part. "No source, no finding" is enforced in code for findings only (every chat reply is still unsourced model output); the pieces that keep walls between people and tie each decision to a named person are not built.

---

## Slide 6: The hybrid team roster

**Minutes:** 1.5 | **Speaker function:** Medical affairs
**Slide purpose:** make "agents" concrete: who they are, who owns them, and what they may not do.

**On the slide**
- **Humans:** the person who activates the team (the RA DD lead), the DD decision owner, the playbook owner, one owner per agent, and the domain experts cleared for this DD
- **Agents, three kinds:** domain (regulatory strategy, clinical, CMC, quality, safety, medical affairs, and specialists by asset type); team roles (orchestrator, red team, evidence checker, synthesiser, a sanitiser that prepares questions for cleared experts); stakeholder views (a health-authority reviewer through the red team; patient, payer and inspector views are **Concept**)
- **Built:** 25 named agents, each with a written specification: role, sources, tools, guardrails, human owner, autonomy level. 14 are on by default; the DD setup adds or removes specialists, and people can add or remove an agent from the team chat itself
- **Still open:** which 6 to 8 we build in depth, with real sources (open question 12). A proposal of eight, with its open points, is written (`outputs/01_concept/mvp-agent-selection.md`)

**Speaker note:** Every agent has a human owner role, and the owner is a role, not a named person. Today the 25 are working teammates in a chat with no tools and, unless the practice data room is loaded, no sources, so every reply is labelled as unsourced model output. We will not claim they are "experts"; we call them specialist teammates under expert direction. Reimbursement and health-technology-assessment risks are flagged to health economics (HEOR) and not assessed by us, so there is no payer agent in the MVP.

---

## Slide 7: The DD playbook (the MVP)

**Minutes:** 2.5 | **Speaker function:** RA lead
**Slide purpose:** show that the playbook is a checklist that stops anything being forgotten, and that its output prepares a human discussion instead of replacing it. Status: **Built** for the DD setup and the team, the checklist with four states, the briefing and the gates; the two modes (planned and reactive) are not told apart in the app yet.

**On the slide**
- Two modes: planned DD (time to prepare) and reactive DD (urgent). The value is most visible in reactive DD
- Regulatory checklist: guidance for the area and product type; special designations (orphan, breakthrough, paediatric); regional differences (FDA, EMA, Japan, China, global access); bottleneck hunt; inputs to the regulatory part of PTRS; reimbursement and HTA risks flagged to HEOR. Every item ends as checked, checked: not applicable, not checked, or could not check
- Other workstreams: CMC and technical maturity, quality and inspection history, safety/PV, inherited commitments
- Output: a structured briefing, **not** a buy or don't-buy: what was checked, positives, risks, mitigations, open questions, PTRS inputs
- Reserved for people: deal-breakers, overall assessment, recommendation. Out of scope: valuation, commercial, market access
- Three gates where a person decides (scope and activation, the evidence is enough, release the briefing): the facts and a recommended call come from code, and a reason is needed when the choice differs from it

**Speaker note:** The playbook also identifies which functions and experts to bring in, inside the data walls, so the DD owner never answers a cross-functional question alone; that is the worst behaviour on slide 3. Writing "checked: not applicable" explicitly is how a reader knows an item was not skipped. The briefing gets a regulatory lead ready for the cross-functional discussion fast. It does not replace that discussion. Say which pieces exist today: the team assembles itself from the DD setup, the checklist keeps its four states apart, the briefing is built by code from what people accepted, and three gates show where a person decides. The planned and reactive modes are not told apart in the app yet.

---

## Slide 8: LIVE DEMO

**Minutes:** 4.5 | **Speaker function:** RA lead at the keyboard; CMC reads out and comments on the replies
**Slide purpose:** let the audience see the team work. Honest frame first, then proof of routing, challenge, data room and human-reserved decisions.

**On the slide**
- Label, top corner: **LIVE** (or **PRE-RECORDED** if the fallback is used; never unlabelled)
- Fictional asset only; every reply says "Model output, not sourced"
- Today's route (steps from `LIVE-DEMO.md`), one of two [to decide with the owner]. **Route A, the team first:** workspace and honest frame (1); team question with two @mentions and a summary (3); "Should we buy this asset?" and who answers (6); what a claim would need as a source (7); the data room with its as-of date (9); close (10). **Route B, the human decisions:** steps 1, 3 and 6, then the Gates page (9e); close (10)
- One thing to watch for: a person, not an agent, owns every decision

**Speaker note:** Say the frame before any reply: this is a confidential workspace, no agent promises secrecy, and no sources are connected unless we load the practice data room. Show the team picking itself: name two teammates, watch only them answer, and read the trace "How this turn ran", which is written from the record, not by the model. Ask "Should we buy this asset?" and point to the orchestrator naming the humans who decide. Then load the fictional data room and show an agent cite a document by id and say a missing document was "not found in the data room" and not "does not exist". If time allows (step 9b), press "Propose findings from this answer": code keeps only claims whose quote is word for word in a document the agent was shown, the rest become open questions, and a person accepts or rejects each draft. Say plainly that the app has no login, so decisions are stamped "person (local, not authenticated)". If a reply slips (states something as checked, or makes a call), say so; that is why replies are labelled and people decide. On Route B, open Gates instead of the data room: show that the facts and the recommended call come from code and no model is involved, that nothing is preselected, that choosing differently needs a reason, and that a dissent is recorded under the decision and changes nothing. Say plainly that the app has no login, so the decision is stamped "person (local, not authenticated)".

**Run plan** (refer to `outputs/05_demo/app/LIVE-DEMO.md`; do not copy it onto slides)
- Route A: steps 1, 3, 6, 7, 9, 10 add up to about 4 minutes of the guide's own estimates; the remaining 30 seconds is for hand-overs and slack. Route B: steps 1, 3, 6, 9e, 10 also add up to about 4 minutes (30, 60, 20, 120 and 15 seconds). Estimates are not yet timed with the real model (V2, V20)
- Steps 9b to 9d (findings, checklist, briefing: about 2, 1.5 and 2 minutes, and they need the real model) add to either route and do not fit the 4.5-minute slot unless something else is cut (my arithmetic from the guide's estimates)
- Do step 9 (data room) last but one, with 9b straight after it in the same room: a data room, once started, cannot be removed from that workspace. The briefing (9d) and the gates (9e) say the most after the findings (9b) and the checklist (9c)
- Before going on: smoke check shows OK, warm-up question answered by the real model (a reply starting "Fake reply from" means rehearsal mode), "New conversation" in each room, one browser tab per room, DD setup back at Phase 2
- The stable demo copy is version 11 (commit b1282e1). It includes steps 9 to 9d (data room, findings, checklist, briefing) but **not the gates (step 9e)**: the gates are on `main`, and promoting them into the stable copy needs the owner's word (V21). Route B needs that promotion first. Confirm on the day which version is shown (V3)

**Pre-recorded fallback**
- A screen recording of one full rehearsed run on the real model, labelled **PRE-RECORDED** on screen and announced aloud [placeholder: recording to be made, V4]
- Switch rule (from the guide): if a reply fails twice after waiting half a minute, switch to the recording and say so
- Never show a stand-in-model run as the demo or as the fallback

---

## Slide 9: What the demo showed

**Minutes:** 2.0 | **Speaker function:** Technical development
**Slide purpose:** say plainly what the demo proved, where the known-outcome test stands, and what is still missing. This is the slide where credibility is won or lost.

**On the slide**
- **Shown working** (only what the chosen route showed): the team assembles from the DD setup; routing by name and by topic; a trace of every turn; and, if shown, the as-of date wall on documents, the findings register (claims kept only with a quote checked in code, a person accepts or rejects each draft), the checklist, the briefing (built by code) and the gates (facts and the recommended call from code, a reason when the choice differs, a dissent recorded); decisions left to people (briefed in the prompts for the agents; at the gates a person decides, not the app)
- **The known-outcome test** (public asset whose outcome is known; agents given only sources dated before the outcome): asset [placeholder: asset not yet chosen; to decide with the owner, open question 5]
- **Result:** no known-outcome run exists yet. We have not run the test; it is our next step, and the demo was shown on the fictional case. How we will score it: issues the answer key listed / found / missed / false alarms [fill in only if a run is done before the presentation]
- Results will be shown honestly, including misses
- **Not built yet:** login and per-person decision rights (every decision is stamped "person (local, not authenticated)"), data walls, a check that a claim follows from its quote, a public known-outcome asset and a recorded fallback of the demo

**Speaker note:** Separate three things for the audience: what you just saw (a working team on an invented case), what we will test (a real, public asset with a known outcome), and what we do not have yet. For the test, the answer key is written and frozen before the run, and we report the hits, the misses and the false alarms from the same run. [Default wording for now: "We have not run the known-outcome test yet; it is our next step, and here is how we will score it." Only if a run is done before the presentation, replace it with the results.] A miss is useful news: it shows where an agent or a source is weak before anyone relies on it.

---

## Slide 10: Expansion playbooks (reuse shown, no percentages)

**Minutes:** 1.5 | **Speaker function:** CMC
**Slide purpose:** show that the same layers and agents serve a new playbook. Status: **Concept** for all three.

**On the slide** (a small table: playbook, what is new, what is reused)
- **Inspections (GMP, GCP, PV), working with Quality:** new = readiness workflow, an inspector-perspective agent, mock-inspection red team, vulnerability heat map, likely questions. Reused = trust and evidence layers, red team, evidence checker, synthesiser, orchestrator, quality, safety and CMC agents
- **Disaster response** (for example a new impurity found in manufacturing): new = the playbook and a few agents; reused = same layers and team roles
- **Rapid response to a health-authority or internal question:** new = a playbook; reused = same layers and agents
- Mirror link to DD: DD assesses a target's GMP, GCP and PV compliance; the same agents can later prepare our own inspections
- We make **no reuse percentage claim** until DD has been built and measured

**Speaker note:** The point is the shape: a new use case needs a new playbook and a few new agents, not a new trust or evidence layer. Inspections overlap with Quality's remit, so we position it as working with Quality. Our proposal, not yet discussed with Quality: we would not start without Quality's agreement. We start inspections at autonomy level 1, Assist. Reuse is something we will count after DD is built; today it is a design intention we have not tested.

---

## Slide 11: The mindset shift and change management

**Minutes:** 1.5 | **Speaker function:** Medical affairs
**Slide purpose:** say that adoption is the biggest risk and show what we do about it.

**On the slide**
- Biggest risk, in the team's words: if we cannot convince people to use it, what is the point (V5)
- From gathering data to strategic oversight of agents; "trust but verify", knowing AI's limits; AI amplifies people and does not decide
- New suggested lines [not yet agreed by the team]: "No one decides alone"; "Confidentiality through governance, not exclusion"
- Honest accounting: agents must be maintained between DDs, and that effort counts; smaller human teams are not a promise
- Everyone in a DD is trained to use and trust the agents; agent owners invest in improving them; identity shift to "Digital Accelerator"

**Speaker note:** The team named change management as its biggest risk, and it has not yet owned the plan; we say so. Under pressure people go back to what they know, so the tool has to be used by default in planned and in urgent cases, with owners who feel it is theirs. We do not promise that four people become two. Someone has to maintain each agent, and that effort must be counted honestly; no estimate of it exists yet. Governance partners (business development, Legal, data protection, Quality for inspections) are named in the ask.

---

## Slide 12: How we get there

**Minutes:** 1.5 | **Speaker function:** Technical development
**Slide purpose:** show a step-by-step path to trust that fits 4 months and does not ask for a leap. The staged idea is adopted from the other team in our cohort (V12).

**On the slide** (four stages)
- **1. Replay on closed packages:** run the team on past, finished DDs inside each company and compare with what happened. Past DDs are confidential, so this happens inside each company and nothing enters our repository (open question 18)
- **2. Shadow run:** work a live DD beside the normal team; its output informs no decision
- **3. Assisted use:** the regulatory lead uses the briefing in a real DD; people own every decision
- **4. Scale gate:** criteria agreed in advance decide whether to extend to a second playbook or another function, fix, or stop
- Rules: baselines first; measure whether material risks were found before measuring speed

**Speaker note:** The cohort ends in about 4 months (V6). My own reasoning, not agreed by the team: only stage 1 looks schedulable inside it; stages 2 and 3 depend on a live DD arriving and on sponsor agreement, so we do not promise dates. Each stage will have a written exit test (not yet written), and stopping is an allowed result. Call it a staged path in the room; whether we say "experiment" or "pilot" is still undecided (open question 24). The findings register, the checklist, the briefing and the gates are built. Login is a backlog item whose order is not decided; data walls are not in the backlog. Both are dependencies for a shadow run on a real DD and are not yet planned.

---

## Slide 13: The ask

**Minutes:** 1.5 | **Speaker function:** RA lead
**Slide purpose:** end with a concrete decision. The sponsor and the decision wanted are not known (open question 7), so these are options for the owner to choose from.

**On the slide** (pick one lead option; show the rest as "later")
- **Option A, lowest risk [to decide with the owner]:** name an executive sponsor and a governance partner (for example Legal, data protection, business development), and release a few closed DD packages for replay inside each company
- **Option B [to decide with the owner]:** agree that a side-by-side shadow run, human-only against hybrid, may take place on the next live DD at one company. Dependency (my reasoning): data walls, which are not built and not yet planned
- **Option C [to decide with the owner]:** name an owner for the foundations (trust, evidence, orchestration), (open question 14). A second playbook is not asked for now: per decision 3 we learn from the DD build first, so it becomes a decision after the staged path's scale gate (stage 4), with Quality's agreement for inspections
- What we give back each time: the results of the staged path, shown honestly, including misses
- What would make us stop: see the value hypothesis at the end of this file

**Speaker note:** Choose the one option that matches the room before you speak; do not read all three. Be clear about what each option costs the stakeholder: time of named people, access to closed packages, and a decision on ownership. We are not asking for a budget figure because we do not have one, and we will not invent one. End by repeating the honest frame: a working concept on a fictional case, with the evidence still to come.

---

# BACKUP SLIDES (no minutes; use if asked)

## Slide B1: Agent specifications (the roster)

**Speaker function:** CMC
**Slide purpose:** answer "who are these agents and what exactly can each do".

**On the slide**
- 25 specifications, one per agent, all on one template: role, knowledge sources, tools, guardrails, human owner, autonomy level, example prompts
- Groups: regulatory function (9), specialists by asset (7), team roles (5), other functions (4: CMC and technical development, quality and inspection history, safety and PV, medical affairs)
- Default team: 14. The orchestrator, evidence checker, red team, sanitiser and synthesiser are always on
- Sources are listed as "planned, not connected"; no agent has tools today

**Speaker note:** The specification file is the single source of truth: the app reads it at run time, so what we describe is what runs. Each agent's guardrail and escalation lines name a human reviewer. Autonomy levels are set per agent: three agents sit at level 1 (Assist), the medical writing agent, the sanitiser and the synthesiser; the other 22, including the orchestrator, evidence checker and red team, sit at level 2 (Collaborate).

## Slide B2: One specification in full (example: the regulatory lead)

**Speaker function:** RA lead

**On the slide**
- Role: holds the overall regulatory view, pulls the specialists' views into one picture, hands specialist depth to the teammate who owns it
- Guardrails: flags reimbursement and HTA risks for HEOR; describes PTRS inputs as factors; deal-breakers, overall assessment and recommendation stay with people
- Escalation line (exact): "Have the RA DD lead check this before it goes into any briefing."
- Human owner: regulatory lead agent owner. Autonomy: level 2 (Collaborate)

**Speaker note:** Use this to show what "an agent with a human owner" means on paper. Today the agent answers in chat only and marks anything about a specific asset "to verify". When a data room is loaded, a person can ask it in its own room to propose draft findings from its answer; a person accepts or rejects each one.

## Slide B3: Inspection modules (concept, working with Quality)

**Speaker function:** CMC
**Slide purpose:** show the shape of the inspections playbook without taking over Quality's remit. Status: **Concept**; all module content is from the project brief and has not been checked against current guidance (V15).

**On the slide**
- Shared core: readiness workflow, an inspector-perspective agent configured for GMP, GCP or PV, a mock-inspection red team, a vulnerability heat map, likely questions, human sign-off
- **GMP module:** quality system, data integrity, CAPAs, consistency between dossier and site
- **GCP module:** TMF, oversight of vendors and sites, consent, risk-based quality management
- **PV module:** ICSR timeliness, signals, PSMF, QPPV, oversight of PV vendors
- Positioning: working with Quality, not taking over; the team supports Quality's inspection readiness and starts at autonomy level 1. Our proposal, not yet discussed with Quality: we would not start without Quality's agreement

**Speaker note:** The inspections idea came up in the team's discussion with the warning that it "steps on Quality's toes". Our answer is to work with Quality and to treat the agents as support; whether Quality would co-own the playbook is a question for Quality [to verify]. The mirror link to DD is the useful part: the same agents that assess a target's compliance can later prepare our own inspections.

## Slide B4: Risks

**Speaker function:** Medical affairs

**On the slide**
- **Adoption** (the biggest): if people do not use it, nothing else matters
- **Hidden maintenance effort:** agents need continuous upkeep; count it honestly
- **Friction with Quality** on inspections: position as working with Quality
- **Confidentiality:** data walls must hold. Today there is no login and no wall between people
- **Agents are wrong or overstate:** chat replies are labelled unsourced model output; for findings, code keeps a claim only with a quote word for word in a shown document and a person accepts each draft, but the quote proves the text is real, not that the claim follows from it (open question 28), and the accepting person is not authenticated
- **A demo outcome the model already knows:** a well-known asset may be in the model's training data (open question 5)

**Speaker note:** Owners for these risks are still to be named (open question 14; change management in particular has no owner yet), and some mitigations are still to build. The last risk is specific to our test: we must check, with no documents given, whether the model already knows the asset's outcome, and pick another asset or say so if it does.

## Slide B5: What is built and what is not (detail by layer)

**Speaker function:** Technical development

**On the slide**
- Trust: confidential-workspace rule, labels on every reply, an append-only record of every human decision with the facts as they were, the always-human list on the Gates page, the rule that no agent decides a reserved question (briefed in the prompts for the agents); login, walls between people, a recorded human decision tied to a named person (not built)
- Evidence: data room with as-of wall and withdrawal (built); findings register with "No source, no finding" enforced in code for findings (built and merged; in the stable demo copy, version 11); a check that the claim follows from the quote (not built, open question 28)
- Agent library: 25 specifications with owners and autonomy levels (built); real sources and tools (not built)
- Orchestration: routing by name and topic, summary after two or more contributions, a trace of each turn, adding and removing agents from the team chat, three gates for DD (built); the full eight-step workflow (not built)
- Playbook and human layers: DD setup decides the team, owner roles on each card (built); accept or reject and tag of each draft finding, checklist states, and a decision and dissent at each gate, all by a person (built, stamped "person (local, not authenticated)"); four-state checklist and briefing built by code from accepted findings (built); a general playbook object a second use case could use (not built)

**Speaker note:** This is the honest answer to "how much is real". The foundations that can be shown are real; the register that makes a finding traceable is built; the parts that make it safe to rely on that are still missing are the login, so that each decision is tied to a person, and the walls between people. The evaluation harness exists and has produced baselines; those are measurements of how the agents behave in tests, not a quality grade, and we do not quote them here.

## Slide B6: Sources

**Speaker function:** RA lead

**On the slide**
- Demo data is public only: FDA review documents, EPARs, ClinicalTrials.gov, publications, FDA inspection data and warning letters, EudraGMDP, company disclosures
- Pre-outcome availability: FDA review documents and EPARs often appear at or after the decision, so each source's date must be checked per asset (V17)
- The live demo asset and the practice case are fictional; no past DD or confidential document enters the project
- The Digital Mindset Canvas is a third-party framework; box names are used and its questions paraphrased, credit line to be agreed (V16)
- Ideas on staging, hypothesis and gates were adopted from the other team in our cohort, credited to the team and not copied

**Speaker note:** A "source" in our rule means a primary public document with a link and a date; an agent's own text is never evidence. Where a source is unavailable we say "could not check" and not "does not exist".

---

# END MATTER

## A. Testable value hypothesis (our own words; not a business case)

We expect that, for a reactive DD of an external asset, a regulatory lead working with the hybrid team will get a structured briefing that covers every item on the checklist, with each finding traced to a public source and accepted by a named person, in less elapsed time than a human-only team, and without missing more of the risks that mattered. We would test this in a side-by-side on closed DD packages inside one company: the same package, handled once by a human-only team and once by the hybrid team, scored against a list of material issues that people who know the outcome write down and freeze before either run. We would measure, in this order: (1) material-risk recall, the share of the frozen list each side found; (2) the share of findings that are traceable to a source and accepted by a person; (3) elapsed time and person-hours to the briefing, including the time spent preparing, checking and maintaining the agents. We capture the human-only baseline first and set the targets with it [targets: to decide with the owner; we state none now]. We would stop or redesign if the hybrid team finds fewer of the material risks than the human-only team, if too many findings fail the source check, if the maintenance effort uses up the time saved, or if the people who must use it will not.

## B. What could go wrong on stage

- The model gateway is unreachable because the VPN is off or dropped: ask again after reconnecting; after a second failure switch to the labelled recording
- A reply starts "Fake reply from": the app is on rehearsal settings; stop and restart the live demo before going on
- The demo copy shown is older than the step needs: version 11 has no Gates page (step 9e), and an earlier copy lacks the checklist or the briefing (9c, 9d), the findings register (9b) or the data room (9). The stable copy was version 11 on 2026-10-23 (V3). Steps 9 to 9d also need the real model: never show them in rehearsal mode
- A step shows an empty or thin page because the step before it was skipped: the checklist, the briefing and the gates build on the findings you accepted in step 9b
- A turn with a summary makes three model calls in a row and runs long: talk while it streams; ask for a short answer
- The model slips: states something as checked, gives a figure, or makes a call. Say so out loud; it is the reason replies are labelled
- A teammate that is expected to answer has "nothing to add", or the wrong teammates answer: use the demo buttons, not typed prompts
- The warm-up or a rehearsal left the DD setup at Phase 3, or a data room already started: check before going on
- The same room is open in two tabs and a question is refused
- An attendee asks "is this private?": answer honestly that chats stay on this computer and go to the company's model gateway, and that no agent can promise secrecy or deletion
- An attendee asks how much faster or what percentage is reused: we have no such numbers, and we say so
- An attendee asks "will this replace us?": decisions stay with people; we do not promise smaller teams; maintenance effort is counted
- The known-outcome run result is a miss: show it as planned (slide 9), do not explain it away
- Over-run from hand-overs between speakers (planned at about 15 seconds each, an untimed estimate: V19): keep to four or five speakers
- The audience includes several companies: no confidential material live, fictional asset only

## C. Statements marked "to verify"

- **V1.** Slot length and whether questions fall inside it (open question 2). The deck assumes 25 minutes of talk.
- **V2.** Demo timings are the guide's estimates. The guide says its prompts were not yet run end to end with the real model, while the decision log records later live checks; confirm with one timed rehearsal on the real model.
- **V3.** The stable demo copy is version 11 (commit b1282e1), which includes the data room, the findings register, the checklist and the briefing (steps 9 to 9d of `LIVE-DEMO.md`) but not the gates (step 9e). On 2026-10-22 the running copy answered real questions (see `DECISIONS.md`). A running copy can be restarted or replaced, so confirm on the day which version is shown before using steps 9 to 9e.
- **V4.** No pre-recorded fallback exists yet; the guide lists it as a checklist item.
- **V5.** The quote "if we can't convince people to use it, what is the point" is taken from the project brief's risk list; I did not find it word for word in the transcript.
- **V6.** "About 4 months" to the end of the cohort comes from the transcript ("let's say 4 months"); the exact end date is not known.
- **V7.** Canvas boxes 4 to 6 content comes from the brief's team draft; the canvas photos are blank templates, so the filled-in canvas is not confirmed on tape or paper (open question 17).
- **V8.** Autonomy levels, the finding format, the three agent kinds, the inspection modules and the demo design were proposed, not agreed on tape (open question 11); the deck presents them as the working concept.
- **V9.** The layer model of "five layers plus a human frame" is my proposal; the team has not decided between five and six (open question 4).
- **V10.** Whether a public asset exists with a known outcome that the model does not already know, and with enough sources dated before the outcome (open question 5). Per-source availability dates are not checked.
- **V11.** That smaller human teams will follow: not claimed. The "4 to 2" figure was an off-the-cuff remark in the discussion and is not used.
- **V12.** The staged path (replay, shadow run, assisted use, scale gate) is adopted from the other team's idea as a proposal; the team has not yet agreed it or the words "experiment" or "pilot" (open question 24), and past-DD replay is untested (open question 18).
- **V13.** The audience, the sponsor and the decision wanted are unknown (open question 7); the three options on slide 13 are mine.
- **V14.** Whether each company will release closed DD packages for replay, and whether a shadow run is possible within the cohort's time: not known.
- **V15.** The GMP, GCP and PV module contents (slide B3) come from the brief and are not checked against current guidance; check with Quality.
- **V16.** The canvas template is third-party copyright; get permission and agree a credit line before any publication.
- **V17.** The statement that review documents are often published at or after the decision comes from my kickoff note and is not checked for each source.
- **V18.** Several claims in this deck about what the agents do in tests (for example that an agent said "not found in the data room" and cited documents by id) come from the decision log, not from my own run; I did not run the app.
- **V19.** The "about 15 seconds" per speaker hand-over is my planning estimate; it has not been timed.
- **V20.** Slide 8's two routes (A, the team first; B, the human decisions) and their timings are my arithmetic from the guide's estimates, not timed on the real model, and the choice between them is the owner's.
- **V21.** The gates were merged into `main` on 2026-10-23 but are not in the stable demo copy; promoting them needs the owner's word.
