# Digital Human Hybrid Team: the merged concept (draft)

**Status:** draft for the team, updated 2026-10-23 (first written 2026-10-19). Prepared by the first team for the merge with the other team. Nothing here is agreed until the team says so. Sections 3, 5, 7 and 8 now describe the checklist, the briefing and the gates as built.
**Audience:** senior stakeholders, about half in Regulatory Affairs (RA), the rest in technical development, CMC and medical affairs.
**Markers:** "(to verify, Vn)" flags something unconfirmed; every one is listed in Appendix B. "My reasoning" marks a view of the drafter, not a team decision. Section IDs (for example `[L1]`) are stable so the other team's material can be merged against them.

## 1. Vision and central message [C1]

**The idea.** Human domain experts and AI agents work as one team to deliver a specific regulatory activity or milestone. In the long run, some activities may be run by a largely digital team, always with an accountable person behind every agent and every decision.

**The umbrella.** Fast answers to unexpected regulatory questions. Due diligence (DD) of an external asset is the first and only example we build. The other cases are shown as concepts to prove the model scales.

**The central message (suggested, not yet agreed; to verify with the team, V1).** Under pressure, teams trade inclusion for speed: functions are left out, and inputs go unconfirmed with the responsible function. The team's own canvas names this as a current behaviour (Box 5, worst). The hybrid team aims to remove the trade-off (not yet shown): the goal is that every functional view is available quickly, and an accountable human owner stands behind each agent. Reactive DD stops being a panic and becomes predictable.

**What we are not claiming.** The output is not a buy or don't-buy decision, and we make no efficiency claim: there is no baseline yet (see [M1]).

## 2. One clean layer model (a proposal for the team to confirm) [A0]

The team says "five layers" but lists six things: trust, evidence and knowledge, agent library, orchestration, playbook, and humans.

**Proposal: five layers plus a frame.** Count five layers, bottom to top: trust; evidence and knowledge; agent library; orchestration; playbook. Draw human accountability as a frame around all five, because people do not sit at one level. They own agents, playbooks and decisions at every level. This matches how the recording introduced it, and keeps the team's number of five. If the team prefers "six layers", draw the human layer as a vertical band beside the five. The content is identical. (My reasoning.)

```
 HUMAN ACCOUNTABILITY (frame): agent owners, playbook owners, decision owners, the person who activates the team
 +---------------------------------------------------------------+
 | L5 Playbook        one per use case (DD first)                |
 | L4 Orchestration   plan, assign, assess, challenge, combine,  |
 |                    escalate, decide, learn                    |
 | L3 Agent library   domain, team-role, stakeholder-perspective |
 | L2 Evidence and knowledge   findings with sources             |
 | L1 Trust           decision rights, audit, data walls         |
 +---------------------------------------------------------------+
```

**Canvas map (my mapping, to confirm).** Boxes 1 to 3 (initiative, results, why now) are covered by [C1]. Boxes 4 to 6 describe the problem each layer answers. Boxes 7 to 9 describe what changes.

| Layer | Answers (Boxes 4 to 6) | Changes behaviour (Box 7) | Changes mindset (Box 8) | How (Box 9) |
|---|---|---|---|---|
| L1 Trust | Functions or information left out for speed; confidentiality | Controlled sharing of information | Suggested: "confidentiality through governance, not exclusion" | Suggested: name governance partners (BD, Legal, data protection) |
| L2 Evidence | Missing information; overlooked risks | Feedback loops from DDs | Trust but verify | Validation on past DDs |
| L3 Agents | Overloaded people; time-consuming tasks | Agents maintained continuously; performance monitored | Agent owners invest in improving agents | Agents as partners |
| L4 Orchestration | Inputs not confirmed with the right function | Stakeholder identification | Suggested: "no one decides alone" | Move from aggregation to strategic oversight |
| L5 Playbook | DD practice varies by therapeutic area | One checklist so nothing is missed | Use the tool by default | Standardise, then tailor |
| Human frame | RA answering without the responsible function | Humans move from gathering data to oversight | AI amplifies people and does not decide | Identity shift to "Digital Accelerator" |

## 3. The layers

### L1 Trust [L1]
Decision rights, audit trail, data rules, policies, privacy and a red team. The new capability is **controlled sharing of information**: each agent and each person sees only what the people working on a given DD are cleared for ("data walls"). The intention is to set these once for every playbook, so that no use case needs its own trust rules. This is the scalability hypothesis (section 4, [A2]), not a demonstrated fact.
- **Rules I propose (my reasoning):** data walls cover learning too (lessons from a walled DD stay inside it unless cleaned and approved); one audit record per finding (versions, model, sources with dates, human sign-off).
- **Owner:** a governance lead, proposed (nobody owns this yet; OQ 14).
- **Today:** a confidential-workspace rule (agents use what a person shares and never promise secrecy or deletion), a label on every reply, an append-only chat store, a record of what agents saw each turn, and an append-only record of every human decision (accept or reject, tag, checklist state, gate decision, dissent), each kept with the facts as they were. The Gates page lists what only a person decides: deal-breakers, the overall assessment, the recommendation, going ahead on incomplete evidence, settling a disagreement between specialists, and stopping the DD. **No login and no data walls between people:** every decision is stamped "person (local, not authenticated)".

### L2 Evidence and knowledge [L2]
A verified knowledge base with one finding format: **claim, evidence, source, confidence, assumptions, owner, status**. Rule: **"No source, no finding."** Only primary public sources support a finding. Agent output, summaries and the seller's own statements are never evidence; a seller's document gives an attributed claim to test.
- **Wording rule (adopted from the other team, to be measured):** an agent says "not found in the data room", never "does not exist".
- **Owner:** knowledge base owner.
- **Today:** a data room with an as-of date and cited document ids, and a **findings register (built and merged, in demo version 8)**. In an agent's own room a person asks for findings; code keeps a claim only if it comes with a quote that appears word for word in a document the agent was shown, and the rest become open questions. One draft per quote. A person accepts or rejects each draft once; the app has no login, so the decision is stamped "person (local, not authenticated)". "No source, no finding" is therefore enforced in code for findings only. Chat replies remain unsourced model output, and the rule is still a design rule, not a guarantee, outside the register. On top of the register sit a checklist of six regulatory items in four states kept apart (checked; checked, not applicable; not checked; could not check), where "checked" needs an accepted finding behind it (code and database both refuse it otherwise); a tag that says which item a finding supports and whether it is a positive, a risk or neutral; and a briefing that code assembles from them.

### L3 Agent library [L3]
Agents are built separately from playbooks, so one agent serves many playbooks and a new capability needs no playbook change. Each is defined by role, knowledge sources, tools, guardrails, human owner and autonomy level. Three kinds:
- **Domain agents:** RA strategy, clinical/label, CMC/TD, quality, safety/PV, medical affairs.
- **Team-role agents:** orchestrator, red team, synthesiser, evidence checker, and a sanitiser for questions going to people outside the wall.
- **Stakeholder-perspective agents:** health authority, patient, inspector. Payer/HTA is listed as agreed in principle in the brief, but is not in the current list. **Open owner decision (my proposal):** leave it out of the MVP, because HEOR is out of scope: DD flags reimbursement risks to HEOR and does not assess them.

**A critical point.** The app carries 25 named agents, but the brief asks for a small MVP of 6 to 8 (OQ 12). Many personas are hard to justify; the other team's red team made the same point about its roster. My reasoning: present the 25 as a catalogue, build 6 to 8 in depth, and add a "why an agent, not a rule or template" line to each spec to choose them. My proposal (to verify, V2): seven agents (RA strategy, CMC and technical development, quality and inspection history, safety/PV, evidence checker, red team and synthesiser) plus the orchestrator as the eighth. The alternative is clinical regulatory strategy as the eighth, with the orchestrator counted on top. **Open point:** whether the orchestrator counts inside the 6 to 8 or comes on top needs an owner decision (OQ 12). The proposal in full, with a "why an agent, not a rule, a template or a person" line for each of the 25 and a list of things that are deliberately not agents, is in `outputs/01_concept/mvp-agent-selection.md` (my proposal; the owner chooses).
- **Today:** 25 specifications with persona, guardrails, escalation lines and a human owner role. Only the red team's health-authority-reviewer stance exists as a stakeholder perspective. Agents have no tools and no connected public sources. Two planned remits no longer match what is built: the synthesiser's says it writes the briefing, but code assembles the briefing; the evidence checker's says it enforces "No source, no finding", which code enforces for findings (OQ 35).

### L4 Orchestration [L4]
Sends the right agent to the right task. Standard workflow: **plan, assign, assess, challenge, combine, escalate, decide, learn.** "Decide" is always a person. The orchestrator is the engine of this layer, not one of the specialists. Whether it counts in the "6 to 8" MVP agents is an open point (see [L3], OQ 12).
- **Owner:** the person who activates the team, with a platform owner (proposed).
- **Today:** routing in code (@mentions, up to four; then topic terms, at most three specialists), a synthesiser that summarises after two or more contributions without making a call, and a visible record of who was asked and why. People can add or remove agents from the team chat itself, and an agent the router left out because they are not selected is named with an Add button. The three gates are where a person decides: they are the "escalate" and "decide" steps, for the DD only. **The eight-step workflow is not coded as a workflow:** assign and combine exist in chat form, escalate and decide exist as the gates, and plan and learn do not exist as steps; "challenge" happens only when someone @mentions the red team.

### L5 Playbook [L5]
One per use case. It defines the key questions, agents, sources, outputs, decisions reserved for humans and the autonomy ceiling. It doubles as a checklist, so nothing is missed. New guidance reaches it as a proposal from an agent; **the playbook owner approves every change** (my reasoning: the recording suggests agents update playbooks, which would remove the human owner).
- **Today:** the DD playbook is a description (section 5) plus what is built for it: a setup (development stage and asset classification) that decides which agents join, a checklist of six items in four states, a briefing, and three gates (scope and activation, the evidence is enough, release the briefing). All of it is written for DD. There is no general playbook object that a second use case could fill in, so the scalability test (section 4) has not been tried in code.

### Human accountability frame [H1]
Four roles, which differ by playbook: **agent owner** (keeps the agent's brief and evaluation current; my proposal, needing an owner decision: the agent owner is not read into a live DD unless cleared like anyone else), **playbook owner**, **decision owner**, and **the person who activates the team** for a task. Decisions reserved for humans: deal-breakers, the overall assessment, the recommendation. An executive sponsor above the frame appoints the governance lead (my reasoning).
- **Today:** owners exist as roles on every agent. There are no named people and no login. Recorded human decisions are accept or reject and a tag on a draft finding, the checklist states, and the decision and dissent at each gate, all stamped "person (local, not authenticated)". The owner's rule for disagreement is built into the gates: the lead decides, and a dissent is recorded under the decision and never blocks it. The app cannot yet tell who the lead is or tie a decision to a named person (OQ 29, 34), so there are no per-person decision rights.

## 4. Autonomy levels and the scalability test

### Autonomy [A1]
| Level | Meaning | Where used |
|---|---|---|
| 1 Assist | Explains and drafts; a person checks everything | Inspections (planned); a few support agents today |
| 2 Collaborate | Proposes draft findings; a person keeps or rejects | DD starts here |
| 3 Delegate under oversight | Does bounded work; a person reviews outcomes | Concept only; no agent uses it |

This answers the team's "intern or equal?": **specialist teammates under expert direction** (a suggested phrase, not agreed), earning more autonomy through evidence. I propose a **permission ceiling**, taken from the other team: no level ever reaches a conclusion; agents observe, recommend and carry out bounded actions. In the app it is already visible in three places: the always-human list on the Gates page, an agent brief that says it makes no reserved decision, and a briefing that says it is not a decision. The ceiling remains a proposal, and it sits in tension with two things: the long-term vision of a largely digital team for some activities, and level 3 "Delegate under oversight", where an agent does bounded work with outcomes reviewed after the fact.

**My proposal for the default (the team decides; to verify, V14).** The ceiling holds for the whole MVP and no agent runs at level 3. The scale gate of the staged path (section 9) is where to ask whether a bounded task may move up a level, on evidence from replay on closed DDs (for example material-risk recall at least as good as the human-only run), with the sponsor and the governance lead agreeing. Today each agent's level is set in its specification and nothing in the app changes it. Whether the ceiling is permanent or only applies to the MVP, and who grants an upgrade, is open (OQ 15).

### Scalability test [A2]
A new use case should need only **a new playbook and a few new agents**, never a new trust or evidence layer. **This is a hypothesis.** It is untested beyond RA use cases, and the brief also wants other functions. We claim no reuse percentages before DD is built. Cheap test (my reasoning): draft the inspection playbook on paper using only existing layers and list what is missing.

## 5. Playbook 1: due diligence, the MVP [P1]

Regulatory and technical DD of an external asset. **Two modes:** planned (time to prepare) and reactive (urgent, short turnaround). The value is most visible in reactive DD. (The app's setup does not yet distinguish the modes.)

**Regulatory checklist**
- Applicable guidance for the therapeutic area and product type.
- Special designations: orphan, breakthrough, paediatric requirements and others.
- Regional differences: FDA, EMA, Japan, China, global access, tailored to the product.
- Bottleneck hunt: what could make approval hard in any region.
- Inputs to the regulatory part of the probability of technical and regulatory success (PTRS), checking that the right information feeds the calculation. Agents describe inputs as factors; the number belongs to the calculation's owner.
- Reimbursement and HTA risks: flag and hand to HEOR; do not assess.
- Every item ends in one of **four distinct states: checked; checked, not applicable; not checked; could not check.** "Not checked" must never look like "checked".

**Other workstreams:** CMC and technical maturity; quality and inspection history; safety/PV; inherited commitments.

**Stakeholder identification.** The playbook suggests which functions and experts to bring in, within data walls, so DD owners do not answer cross-functional questions alone. The mindset to change: "I have enough in my area to make the call". Separate who is *read in* (should be complete) from who *does the work* (can shrink). The canvas's "4 people become 2" was said off the cuff; it is not a target (V3).

**Output:** a structured briefing, not a decision: what was checked, what was considered, positives, risks, possible mitigations, open questions, and PTRS inputs. It prepares the regulatory lead for the cross-functional discussion and does not replace it.

**Gates (built).** Three points where the app stops and a person decides: scope and activation, the evidence is enough, and release the briefing. Each shows facts that code builds from what is in the app (no model), a recommended call, what would move that call, and what each option costs: go ahead, pause, ask for more information, stop. Choosing something other than the recommended call needs a recorded reason; a decision taken on facts that have since changed shows as such; a scope gate that was stopped or paused leads the later gates to recommend pause. The gates concern the process, not the deal.

**Reserved for humans:** deal-breakers, the overall assessment, the recommendation. **Out of scope:** valuation, commercial, market access. Settled by the owner on 2026-10-22 (OQ 22): when the lead and a specialist disagree, the lead decides and the dissent is recorded under the decision; going ahead on incomplete evidence is allowed, with a reason recorded. Still open: who counts as "the lead" once there is a login (OQ 34), and whether a decision can be corrected (OQ 33).

**Demo and validation.** Public sources only (FDA review documents, EPARs, ClinicalTrials.gov, publications, FDA inspection data and warning letters, EudraGMDP, company disclosures). The intended demo: a public asset with a known outcome, agents given only what existed before it, an honest reveal including misses. Three risks to this plan (my reasoning):
- The model may already know the outcome from training. Test that before choosing the asset (V4).
- FDA review documents and EPARs usually appear at or after the decision (to verify), so pre-outcome evidence may be thin; check each source's date (V5).
- The rubric of issues to find must be frozen before any run.

Validation on past DDs and after-action reports is for each company to do internally. **Those documents never enter this repository** (OQ 18).

## 6. Expansion playbooks, concepts only [P2]

They show that the same layers and agents can be reused. They are not built, and no reuse figure is claimed.

| Playbook | Core idea | Caveat |
|---|---|---|
| **Inspections** (GMP, GCP, PV) | Shared core: readiness workflow, an inspector-perspective agent configured per type, a mock-inspection red team, a vulnerability heat map, likely questions, human sign-off. Modules: GMP (quality system, data integrity, CAPAs, dossier-to-site consistency); GCP (TMF, vendor and site oversight, consent, risk-based quality management); PV (ICSR timeliness, signals, PSMF, QPPV, vendor oversight) | Overlaps Quality's remit. **Position it as working with Quality, not taking over:** Quality is a named governance partner and is involved in the sign-off (my proposal; who signs off is for the team and Quality to decide). Module contents are a starting list to check with the owning functions (V6); an inspector agent configured per type is an untested intention (V13) |
| **Disaster response** (for example a new impurity found in manufacturing) | A playbook for fast cross-functional assessment, reusing CMC/TD, quality, safety and the red team | Needs rules for acting before all facts are known |
| **Rapid response** to unexpected health authority or internal questions | The umbrella case: intake, route, evidence, draft answer, human sign-off | Planned DD is not "unexpected"; the reactive mode is the closest fit |

**Mirror link to DD:** DD assesses the target's GMP, GCP and PV compliance; the same agents can later prepare our own inspections. Inspections start at autonomy level 1 (my reasoning: shared ownership with Quality, low tolerance for error).

## 7. What is built and what is planned (as of 2026-10-23) [S1]

Source: `outputs/DECISIONS.md`, `ORIENTATION.md`.

| Capability | Status | Detail |
|---|---|---|
| 25 named agents with personas and human owners | **Built** | One specification file each; owners are roles, not people |
| 1:1 rooms and a team chat with routing | **Built** | @mentions and topic terms choose agents in code; people can add or remove agents from the team chat itself; the record of each turn shows why |
| DD setup (stage and asset classification) | **Built** | Decides who is on the team; the team chat uses the same team |
| Confidential-workspace rule | **Built, measured** | No movement outside the noise on the other cases; no promise of secrecy or deletion |
| Data room | **Built, merged** | Documents with an as-of date that never changes; a rule that refuses and never shows a later-dated document; withdrawal with a reason; agents cite document ids and say "not found in the data room" |
| Fictional practice case with answer key | **Built** | 11 invented documents (one withheld on purpose), 11 planted issues; the key stays out of the app |
| Evaluation harness, judge from another model family | **Built** | 72 cases, counted from the case files on 2026-10-23: 61 on 14 agents and 11 on the practice case (V8); results are small samples (section 8) |
| Findings register | **Built, merged** | A person asks for findings in an agent's own room; code keeps a claim only with a quote word for word in a document the agent was shown, the rest become open questions; one draft per quote; a person accepts or rejects each draft once. "No source, no finding" is enforced in code for findings only; chat replies remain unsourced model output |
| Checklist with four distinct states, and tags | **Built, merged** | Six items. "Checked" only with an accepted finding behind it (code and database refuse it otherwise); "checked: not applicable" and "could not check" need a reason; "not checked" is the default and stays visible. A tag says which item a finding supports and whether it is a positive, a risk or neutral |
| The briefing | **Built, merged** | Assembled by code on the spot, with no model, from accepted, tagged findings and the checklist. Says first what is missing; drafts and rejected findings never appear; the mitigations section is empty on purpose; Markdown download; says it is not a decision. A gate decided on facts that have since changed is warned about |
| Gates with a recorded human decision | **Built, merged** | Three gates, facts and recommended call from code, a reason whenever the choice differs, dissent recorded and never blocking, the always-human list on the page. Stamped "person (local, not authenticated)". Not yet in the stable demo copy below |
| Stable demo copy | **Built** | Version 11 (commit b1282e1), kept apart from development. It includes everything above except the gates and the briefing's warning about gate decisions; promoting a newer version needs the owner's word |
| Downloadable ZIP of the demo | **Built, merged** | A build tool that makes a ZIP a colleague can start on their own computer, in practice mode or with their own key. A first double-click on a colleague's Mac or Windows computer has not been tried |
| Known-outcome demo on a public asset | **Not yet built** | Asset not chosen (OQ 5); the demo asset is fictional today |
| Public sources, tools for agents | **Not yet built** | Agents have no tools; documents ride on each turn; no retrieval for long documents yet |
| Real login, per-person decision rights and data walls between people | **Not yet built** | One local user |
| Provisional findings, correcting a decision, a dated snapshot of the briefing | **Not yet built** | Provisional findings are a backlog item; correcting a decision is open question 33 and a snapshot is question 32, which would need the login first |
| Pre-recorded demo fallback | **Not yet built** | |

## 8. Risks and honest limits [R1]

**Named by the team**
1. **Adoption and change management (the biggest).** "If we can't convince people to use it, what is the point?" The recording calls this "probably beyond the scope" of the project; it needs an owner (V9).
2. **The hidden effort to maintain agents.** Agents must be kept current between DDs. No estimate exists. Count it honestly before promising smaller human teams.
3. **Friction with Quality on inspections.** Expected, not yet tested (OQ 6).
4. **Confidentiality.** Data walls must hold. They are a design today, not a feature.

**Limits I can see (my reasoning)**
- **Single local user, no login.** Accepting or rejecting a finding, setting a checklist state and deciding a gate are local, unauthenticated actions today; the stamp says who clicked on this computer, not which person. Real approval, and a real "the lead decides", need a real identity (OQ 29, 34).
- **A recommended call nobody has measured.** The gates' recommended call comes from fixed rules and is tested, not measured: whether it matches what leads would decide needs real past DDs, which each company can run internally.
- **Agent output is never evidence.** The reader still has to check every claim. A person who checks nothing makes the oversight decorative; the risk of rubber-stamping needs a measure.
- **Evaluation results are small.** Runs use three repetitions and a model judge. After the data room was added, two practice-case scores were lower in both runs; the likely cause is a test-design gap and is unproven. The first baseline was 4.33 on a 1 to 5 scale, which is a measurement, not a quality grade.
- **Confidential versus public.** Real use needs a confidential workspace, but this repository, the demo and the practice case use only public or invented material, because attendees come from several companies. The chats go to the company model gateway; no one should read "confidential workspace" as "private".
- **25 agents versus 6 to 8.** More agents means more owners and more upkeep.

## 9. Measuring, the path to trust and the ask [M1]

**Measures (suggested, from the brief).** Issues found earlier and more completely; turnaround time; findings traceable to sources; all functions covered. From the other team: material-risk recall first, speed second. No baselines exist and no targets are set. Do not publish numbers until measured.

**Testable value hypothesis (our own words; not a business case).** We expect that, for a reactive DD of an external asset, a regulatory lead working with the hybrid team will get a structured briefing that covers every checklist item, with each finding traced to a public source and accepted by a named person, in less elapsed time than a human-only team and without missing more of the risks that mattered. We would test it side by side on closed DD packages inside one company, scored against a list of material issues that people who know the outcome write down and freeze before either run. We would measure, in this order: material-risk recall; the share of findings that are traceable and accepted; elapsed time and person-hours, including the upkeep of the agents. Targets: none set; the human-only baseline comes first. The full wording, and what would make us stop, is in the deck's end matter (A).

**Staged path to trust (adopted in principle from the other team; wording open, OQ 24).** Replay on closed past DDs, inside each company; a shadow run beside the normal review; assisted use; a scale decision. Capture human-only baselines first. The team's side-by-side idea (human-only versus hybrid, comparing time and quality) fits here.

**The ask to stakeholders (proposal, to confirm; audience and decision unknown, V10).**
1. An executive sponsor and a governance lead.
2. Named owners for the trust, evidence and orchestration layers.
3. Governance partners: BD, Legal, data protection and, for inspections, Quality.
4. Reviewers released to validate the agents on past DDs inside their own company.
5. Agreement on the staged path and its scale gate.

## 10. Merging with the other team [X1]

We are merging with the other team; the merge is not done. Their material (folder `hybrid-regulatory-dd-team/`) is summarised in `outputs/01_concept/learnings-from-the-other-team.md`, but the team has not yet reviewed it. In the drafter's reading (my reasoning), their strength is process; ours is the running team. The concept proposes to adopt, with credit, subject to the team's agreement: the permission ceiling, the absence wording, gates with options and a recommended call, an explicit always-human list, the staged path, and the evidence-first measures. Two are already built from their ideas, with the owner's answers of 2026-10-22 (OQ 22): gates with options and a recommended call, and the always-human list. The rest are still proposals, and the absence wording is still to be measured. **One real difference to resolve:** their canvas has the regulatory lead recommend whether to acquire an asset; our concept stops at a briefing and leaves the recommendation to the decision owner. We should settle this before the stakeholder meeting (OQ 3, V11). Their counts of agents and reserved decisions come from their architecture page (11 and 8, checked against that page); other details come via the learnings file (V12).

## Appendix A: open questions this concept depends on (`outputs/OPEN_QUESTIONS.md`)

| # | Why it matters here |
|---|---|
| 2 | Slot and date of the presentation |
| 3 | What the other team produced; the merge |
| 4 | The layer model (section 2 is the proposal) |
| 5 | Public asset with a known outcome |
| 6 | Inspections alongside Quality |
| 7 | Stakeholders, the decision we want, the sponsor |
| 11 | Which brief items the team actually agreed |
| 12 | Which 6 to 8 agents form the MVP |
| 14 | Who owns trust, evidence and orchestration; who approves playbook updates |
| 15 | Agent monitoring and who grants autonomy |
| 18 | Validation on past DDs without bringing them into the repository |
| 22 | Answered 2026-10-22: gate format, always-human list, the lead decides and a dissent is recorded |
| 23 | Further evaluation case types; a public asset |
| 24 | "Experiment" or "pilot" |
| 29 | When the app needs a login, so that decisions are tied to a named person |
| 32 | Whether a person can save a dated, named snapshot of the briefing |
| 33 | Whether a gate decision can be corrected |
| 34 | Who counts as "the lead" once there is a login |
| 35 | Two planned remits (synthesiser, evidence checker) no longer match what is built |

## Appendix B: statements marked "to verify"

- **V1:** The central message and the suggested Box 8 phrases are suggestions; the team has not agreed them (OQ 11).
- **V2:** The MVP roster (seven agents plus the orchestrator, or plus clinical as the eighth) is my proposal, not a team decision (OQ 12).
- **V3:** "4 people become 2" is an off-the-cuff remark, not a measured or agreed target.
- **V4:** Whether the chosen model already knows the asset's outcome.
- **V5:** Whether enough public sources predate the outcome of the chosen asset.
- **V6:** The GMP, GCP and PV module contents are a starting list for the owning functions to check.
- **V7:** Closed on 2026-10-19: the stable demo copy was version 8 (commit 6d8a2bd) and included the data room and the findings register; it is now version 11 (commit b1282e1, see section 7). Kept here so the numbering stays stable.
- **V8:** The number of evaluation cases: 72 counted from the case files on 2026-10-23. The evaluation guide in the app folder still says 59 for the general cases, which is out of date (the general cases now number 61).
- **V9:** Who owns change management; the recording is ambiguous.
- **V10:** Who the senior stakeholders are and what decision we want from them (OQ 7).
- **V11:** Whether the other team's framing (the lead recommends acquisition) can be reconciled with ours.
- **V12:** The other team's details beyond their architecture page's headline counts, taken from the learnings file's spot checks.
- **V13:** An inspector-perspective agent that works for GMP, GCP and PV by configuration alone is a design intention, untested.
- **V14:** The default proposed for the permission ceiling (it holds for the whole MVP; the scale gate is where to ask for a level up) is mine, not agreed (OQ 15).
