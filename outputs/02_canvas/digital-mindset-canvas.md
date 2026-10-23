# Digital Mindset Canvas: Digital Human Hybrid Team

**Status:** draft for team review, updated 2026-10-23 (first written 2026-10-19). Nothing here is signed off. Only the dated "Where we are" blocks, the status line and the "what the team still has to decide" list changed in this update; the team's points and the marked suggestions are as they were.
**Framework:** the Digital Mindset Canvas by Reichart (9 boxes). We use the box names and paraphrase the box questions; we do not copy the template or its guide.
**Sources:** the team's canvas draft (`CLAUDE.md`), the recording of the team's canvas discussion (`inputs/transcript.md`), and the two photos of the blank template and its guide. The photos show no filled-in boxes, so they confirm the structure only (open question 17).

## How to read this

Every point in the nine boxes carries one of these markers.

- **(team)** The team's own point, from its canvas draft and the recording. I tightened the wording, merged duplicates and kept the team's voice. A dagger (†) means the point is in the recording but was missing from the written draft, so I added it back. We tried to keep everything the team said.
- **(decided)** A decision already recorded in the project brief (`CLAUDE.md`). It is not a point from the canvas discussion, and it is shown so the scope is clear.
- **(suggested, not agreed)** An addition from the project brief, from me, or from reading the other team's material. The team has not seen or agreed it. It stays out of the canvas unless the team adopts it.

Two further kinds of line are not content points:

- **Where we are, 2026-10-23** says what already exists in the repository and the demo app, and what does not. It is drawn only from `outputs/DECISIONS.md` and `ORIENTATION.md`.
- **Note** flags a place where the team's draft and the recording disagree, or a question to settle.

**Box 9 is the team's box.** On tape the team said "We do" write it (recording, line 253). Whether the AI may only tidy Box 9 or may also add to it is still open (question 16). Until it is answered, every Box 9 addition below is a suggestion only.

**Order.** The boxes follow the canvas's own numbering. The guide groups them in three stages: context (1 to 3), problem and opportunity (4 to 6), and solution (7 to 9). Mindsets are the "see" axis (boxes 6, 8), behaviors the "do" axis (boxes 5, 7), results the "grow" axis (boxes 4, 2).

**Scope of the "current" boxes (4 to 6).** The team filled these in for due diligence (DD), the first use case, not for regulatory work in general.

---

## Stage I. Context

### Box 1. Initiative (name and scope)

- **Digital Human Hybrid Team.** Human domain experts and AI agents work together as one team to deliver specific regulatory activities or milestones. (team)
- **Controlled scope.** We keep it within our group, so we can control it. (team)
- **Umbrella idea:** fast answers to unexpected regulatory questions that need a quick turnaround. DD is the first example, not the only one. (team)
- **First use case: DD.** Chosen because it is "one we all know" and common to regulatory affairs (RA) organisations. We build only this one first, and learn from it before building a second. (team)
- **It can scale.** Inspections, disaster response (for example, a new impurity found in manufacturing) and rapid response to unexpected questions are shown as examples of how the framework abstracts out of DD. They are concepts, not builds. (team)
- **Note on inspections.** The team named the risk that inspections "step on Quality's toes". (team)
- **Suggested wording:** inspections are positioned as working with Quality, not taking over its remit. (suggested, not agreed; open question 6)
- **Out of scope for DD:** valuation, commercial and market access. Reimbursement and HTA risks are flagged and handed to the right partners, not assessed. (decided)
- **Not a verdict.** The output is a structured briefing, not "buy" or "don't buy". (team; this is the team's own line in Box 8 discussion, repeated here so the scope is clear)

**Where we are, 2026-10-23.** The DD workspace is built. It is the app's landing page. Its DD setup (stage and asset classification) decides which of the 25 agents are on the team, and the team chat uses the same team; people can also add or remove agents from the team chat itself. The inspections, disaster and rapid-response playbooks are concepts only; nothing for them is built. The set of 6 to 8 agents the MVP builds in depth is not chosen (open question 12); a proposal is in `01_concept/mvp-agent-selection.md`.

### Box 2. Future results

- **A hybrid team that delivers regulatory milestones.** People create agents, and use them as part of a team, to accomplish specific regulatory activities or milestones. (team)
- **Long term, a virtual or digital team** for some of these activities. (team)
- **A replicable model.** Designed so it can be reused for other uses and other functions. (team)
- **Stakeholder and management buy-in,** so the concept does not "evaporate in our closet". (team)
- **Cohort members who can teach others:** experienced enough to build a hybrid team and show others how. (team)
- **Reactive DD stops being a panic** and becomes predictable. The team asked to see the "my goodness, it's dropped in my lap" feeling shrink over time. (team; the recording puts this under Box 7, the draft under Box 2)
- **Measurable outcomes, to be defined with baselines:** (suggested, not agreed)
  - issues found earlier and more completely
  - turnaround time
  - findings traceable to their sources
  - all relevant functions covered
- **Say it honestly:** no numerical targets or baselines exist yet. Past DDs cannot enter this repository, so each company would measure its own baseline internally (open question 18). (suggested, not agreed)

**Where we are, 2026-10-23.** Nothing here is measured on real DDs. A fictional practice case exists (a made-up data room with 11 planted issues and an answer key) so that "issues found" can be measured without real data. A public asset with a known outcome is not chosen (question 5).

**Note.** "Cohort members teach others" began as the facilitator's paraphrase. A team member redirected the point to getting management buy-in. The draft keeps both. Confirm that the team wants both.

### Box 3. Why now

- **Resources are tight.** Everyone is overloaded; capacity is the constraint. Moving work from live people to agents helps. (team)
- **The technology is at a turning point.** We are at the edge of moving from individual use of AI to team and enterprise use. (team)
- **We need to be early** and to show that we can implement technology successfully. (team)
- **The right work for agents:** time-consuming, less strategic tasks. For example, an agent collects external intelligence and a person analyses it. (team)
- **Pace:** the team set a horizon of about 4 months, to the end of the cohort. (team)
- **Message for stakeholders:** under pressure, teams trade inclusion for speed and skip experts. The hybrid team removes that trade-off: every functional view is available quickly, with an accountable human owner behind each agent. (suggested, not agreed)

**Where we are, 2026-10-23.** The agents have no tools and no public sources connected. Documents reach them only when someone starts a data room, and every reply is still labelled model output, not a source. So the claim "agents can take the time-consuming work" is a plan today, not a result.

---

## Stage II. Problem and opportunity (today, for DD)

### Box 4. Current results

**Best (three)**

- We give the **right regulatory insights** for the DD. (team)
- We can do it **quickly**, under normal conditions. (team)
- **Confidentiality and the data walls hold:** information stays within the limited group that is cleared to see it. (team)

**Worst (three)**

- We **miss information or details.** (team)
- We **overlook risks** that ruin the business case or reduce its value. (team)
- We **cannot give an adequate regulatory view in the time available.** The team stressed that DD comes in two forms: planned, with time to prepare, and reactive, with an immediate turnaround. The worst case is mostly reactive. (team)

**Where we are, 2026-10-23.** This box describes today's practice, not the product. Nothing to point to.

### Box 5. Current behaviors (what drives those results)

**Best**

- The DD owner knows exactly who is read in. When a topic is cross-functional, the owner **brings in the right functions** and makes the linkages. (team)
- The people invited are **ready, willing and able** to take part. (team) †
- Colleagues **free up the calendars** of people pulled into a DD, even when the content cannot be discussed. Prioritisation works. (team)

**Worst**

- For speed, we **leave out functions or information.** (team)
- The DD owner **answers a regulatory question alone** and does not go to the responsible function. (team)
- The owner's **inputs are not confirmed** with the right function. (team; the recording calls this a worst behavior while discussing Box 6, the draft puts it here)

**Where we are, 2026-10-23.** Describes today's practice. Nothing to point to.

### Box 6. Current mindsets (what drives those behaviors)

**Best**

- **"DD is cross-functional and needs every domain."** The team called this a collaborative mindset. (team)
- **Confidence, deep knowledge, curiosity and nimbleness.** If a DD is "dropped in your lap", you must dive in, digest a lot of data, and synthesise it quickly. (team)
- **Knowing what is applicable and checking it:** the right guidance for the therapeutic area and product type; designations such as orphan, breakthrough or paediatric requirements; regional differences (FDA, EMA, Japan, China, global access); and the right inputs to the regulatory part of the probability of technical and regulatory success. (team) †
- **A defensive, bottleneck-hunting view:** what could make approval hard, in any region. (team; see the note below)

**Worst**

- **"I have enough information in my area to make the call."** An individualistic stance. (team)
- **The belief that the group on the DD must stay smaller than it should,** and not thinking enterprise-wide. (team)
- **DD practice varies by therapeutic area** out of habit or silos, not because the product differs. (team; the recording puts this under Box 9, the draft under Box 6)

**Where we are, 2026-10-23.** Describes today's practice. The checklist items listed under "knowing what is applicable" are the content of the DD playbook's checklist, which is now built: six items, each in one of four states kept apart (checked; checked, not applicable; not checked; could not check).

**Note.** On tape the "defensive" remark was an observation ("almost defensive"), not clearly a best mindset. Ask the team whether it belongs on the best side.

---

## Stage III. Solution

### Box 7. New behaviors and capabilities

**Behaviors**

- **People move from gathering data to strategic oversight of agents.** The DD lead uses the hybrid workforce. (team)
- **Agents are maintained continuously,** not only when a DD arrives: knowledge and feedback are added, and performance is checked. (team)
- **A framework to monitor agent performance,** so we know the agents perform as expected. The team did not yet know what it looks like. (team)
- **Feedback loops from successful and unsuccessful DDs** improve the agents. Each agent has an owner who maintains it. (team)
- **Smaller human teams,** for example from 4 people to 2, with the rest hybrid. The team immediately added the honest counterpoint: count the effort to maintain the agents, because that effort lands on a person. (team; "4 to 2" was the team's off-the-cuff example, caveated at once, not a target, and the concept and deck treat it the same way)
- **Everyone brought into a DD is trained** to use, trust and interact with the agents, and to take information from them. (team)

**Capabilities**

- **The layered architecture.** The team called it "five layers" but listed six: trust (decision rights, audit trails, data rules); evidence and knowledge; the agent library (agents with skills, workflows and personas); orchestration; playbooks; and the human layer (agent owner, playbook owner, decision owner, the person who activates the team). Agents are built apart from playbooks, so one agent can serve many playbooks. (team)
- **Layer count.** The count is open (question 4). The drafter's proposal is five layers plus a human frame. (suggested, not agreed)
- **Controlled sharing of information.** A new capability that does not exist in today's digital workforce: each agent and person sees only what the people working on the DD are cleared for. (team)
- **Stakeholder identification.** The playbook suggests which functions and experts to bring in, within the data walls. (team)
- **The playbook as a checklist,** so nothing is missed, updated as new guidance appears. (team)
- **A briefing as the output:** what was checked, what was considered, positives, risks, possible mitigations, open questions, and inputs to the regulatory part of the probability of technical and regulatory success. It prepares the regulatory lead for the cross-functional discussion and does not replace it. (team)
- **A rule for who may change the playbook:** agents propose updates; the playbook owner approves them. (suggested, not agreed; open question 14)
- **Separate "who is read in" from "who does the work."** The first should be complete; only the second can shrink. This resolves the tension with the Box 6 worst mindset about keeping the group small. (suggested, not agreed)
- **"Define the job before the agent":** each agent has a short reason for being an agent, and the agents have a ceiling: they observe and recommend, and people conclude. (suggested, not agreed; learned from the other team's material, see `outputs/01_concept/learnings-from-the-other-team.md`)

**Where we are, 2026-10-23**

| Capability | Status |
|---|---|
| Data room and findings register | **Built and merged.** Accepting or rejecting a draft finding is **not authenticated**: the app has no login, so each decision is stamped "person (local, not authenticated)". |
| Agent library | **Built (as specifications and a chat app).** 25 named agents, each with a role, planned sources, guardrails, a human owner (a role, never a person) and an autonomy level. They have no tools and no public sources connected. |
| Orchestration | **Partly built.** The app routes a question to agents by @mention or topic, an orchestrator answers when nobody fits, a synthesiser summarises, and people can add or remove agents from the team chat. The three gates are the "escalate" and "decide" steps for DD. The full workflow (plan, assign, assess, challenge, combine, escalate, decide, learn) is **not built** as a workflow. |
| Playbook layer | **Built for DD only.** The DD setup (stage and asset classification) decides who is on the team; the checklist keeps "checked", "checked: not applicable", "not checked" and "could not check" apart; a briefing and three gates exist. There is no general playbook object that a second use case could fill in. |
| Evidence and knowledge | **Partly built.** The data room is built: a fictional practice case or an empty room, an as-of date that is enforced, documents that never change and can only be withdrawn, and documents shown to the agents as attributed claims. The findings register is built and merged. A person asks an agent, in its own room, to propose findings; code keeps a claim only if it carries a quote word for word from a document the agent was shown, and the rest become open questions; a person accepts or rejects each draft once and tags it to a checklist item. "No source, no finding" is therefore enforced in code for the register, at document level. The check proves a quote is real, not that the claim follows from it, so the person still judges. No public sources are connected. |
| Trust layer | **Partly built.** Every reply is labelled as unsourced model output. The app is a confidential workspace and agents never promise secrecy or deletion. Every human decision (accept, reject, tag, checklist state, gate decision, dissent) is kept in an append-only record with the facts as they were, but it is unauthenticated. The Gates page lists what only a person decides. Per-person decision rights are **not built** (no login). |
| Controlled sharing (data walls) | **Planned, not built.** The only related pieces are the data room's as-of date and a sanitiser agent that drafts a cleaned-up question for a cleared expert. It only drafts; nothing is sent. |
| Stakeholder identification | **Partly.** The setup chooses which specialist agents join. Naming the human functions to involve is not built. |
| Briefing, gates, recorded human decisions | **Built.** The briefing is assembled by code, with no model, from accepted, tagged findings and the checklist; it says it is not a decision. The three gates (scope and activation, the evidence is enough, release the briefing) show facts and a recommended call built by code; a person decides, a reason is required when the choice differs from the recommended call, and a dissent is recorded and never blocks. Decisions are **not authenticated**; whether a decision can be corrected is open (question 33). |
| Monitoring agent performance | **Partly.** An evaluation harness exists (72 cases, a judge from a different model family, case-by-case comparison against the noise). There is no ongoing monitoring routine and no owner for it (questions 14 and 15). |
| Feedback loops, smaller teams, training | **Not built, not tested.** |

### Box 8. New mindsets

- **Trust but verify.** Trust the AI, and have the expertise to know its limits so you use it appropriately. (team)
- **Curiosity and persistence when the AI fails.** Not "it didn't work, so we're done", but keep going. (team)
- **Use the tool by default,** in planned and urgent cases alike. (team)
- **AI amplifies people.** The expected output is information (what was checked, considered, the risks and the mitigations), not "buy" or "don't buy". The human, with experience and the cross-functional team, makes the call. (team)
- **Agent owners invest in improving the agents.** When the output falls short and a person brings it up to standard, the accountable owner helps train the agent for next time. (team)
- **Identity shift.** You are the person who pilots, tests and uses technology to open things up. (team)
- **"No one decides alone."** (suggested, not agreed)
- **"Confidentiality through governance, not exclusion."** The answer to a secret DD is controlled access with a named owner, not a smaller circle. (suggested, not agreed)
- **"Specialist teammates under expert direction"** rather than "interns" for the agents. The team asked whether agents are equals or interns who grow into the role; it did not settle this on tape. Autonomy levels (1 Assist, 2 Collaborate, 3 Delegate under oversight, with agents earning more over time) are the answer the project brief records as agreed in principle: DD starts at level 2, inspections at level 1. The owner still has to confirm this (question 11). (decided in principle; owner to confirm)
- **"The machine said so" is not a reason.** A recommendation needs a human's reasoning. (suggested, not agreed; from the other team's material)

**Where we are, 2026-10-23.** The app already shows trust-but-verify in practice: every agent reply is labelled "Model output, not sourced", agents mark uncertain points "to verify", and a seller's statement is treated as a claim, not a fact. The Gates page keeps each decision with a person and records a dissent under it; its recommended call carries its reasons, and choosing differently needs a reason. These are habits of the tool, not yet a measured change in people's mindsets.

### Box 9. How (individual, team, organization)

*This is the team's box. Everything marked "suggested" is a suggestion only until question 16 is answered.*

**Individual**

- **Identity shift to "Digital Accelerator":** the tech-savvy person on the cutting edge who pilots and leverages technology. (team)
- **Validate on past DDs.** Run completed DDs and their after-action reports through the agents to check the tool. Past DDs are confidential, so each company does this internally and nothing goes into this repository. (team)
- **Training on prompting and evaluating agents.** (team; the recording only asks that everyone be trained, so "prompting" comes from the written draft)

**Team**

- **Embrace the agents as partners** and work with them. (team)
- **Side-by-side comparison:** one human-only run against one hybrid run on the same discrete activity, to see time saved and any difference in quality, as proof of concept for people. (team)
- **Move from aggregation to strategic oversight:** people step away from gathering data to the strategic thinking. (team)

**Organization**

- **Standardise DD across therapeutic areas and functions, then tailor.** Make sure the same considerations are checked everywhere, even when the answer is "not applicable". (team)
- **Consistency even when individuals rarely do a DD.** (team)
- **Agents spread best practice** across the organisation without "not invented here" resistance. (team)
- **Change management is the biggest risk:** "if we can't convince people to use it, what is the point?" The team called it possibly beyond this project's scope; it is named here as the top risk. (team)
- **Name the governance partners:** BD, Legal and data protection; Quality for inspections. (suggested, not agreed)
- **A staged path to trust,** replacing a single big launch: replay on closed past DDs, then a shadow run next to the normal review, then assisted use, then a decision point to scale. Capture baselines first. Measure whether material risks were found before measuring speed. (suggested, not agreed; adapted from the other team's idea; wording "pilot" versus "experiment" is open, question 24)
- **Give the open roles owners:** trust, evidence, orchestration and the approval of playbook updates (question 14). (suggested, not agreed)

**Where we are, 2026-10-23.** Built: a fictional practice case with an answer key and an evaluation harness, which are the start of "validate before you trust", and a downloadable ZIP so that a colleague can run the practice demo on their own computer (a first real double-click on a colleague's Mac or Windows computer is untried). Not done: any side-by-side comparison, any training, any contact with the governance partners (to verify whether any has started), any stakeholder decision on the ask (question 7).

---

## The canvas on one page

For a slide. Team content only, in short form. A plus sign (+) marks the main suggested additions, so drop them if the team does not adopt them.

| Box | In one or two lines |
|---|---|
| 1. Initiative | **Digital Human Hybrid Team:** human experts and AI agents as one team for specific regulatory milestones. Controlled scope. Fast answers to unexpected questions; due diligence first, then inspections, disaster and rapid response as concepts. |
| 2. Future results | A hybrid team that delivers milestones, a replicable model, management buy-in so it does not "evaporate in our closet", and reactive DD that is predictable, not a panic. (+) Measured: issues found, turnaround, traceable findings, functions covered. |
| 3. Why now | Resources are tight; AI is ready to move from individual to team use; we must show we can implement it; agents can take the time-consuming, less strategic work. |
| 4. Current results | **Best:** the right insights, quickly, with confidentiality kept. **Worst:** missed information, overlooked risks that hurt value, and no adequate regulatory view in the time available. |
| 5. Current behaviors | **Best:** the DD owner brings in the right functions; colleagues clear calendars. **Worst:** functions left out for speed; the owner answers alone; inputs not confirmed. |
| 6. Current mindsets | **Best:** DD is cross-functional; confidence, deep knowledge, curiosity. **Worst:** "I know enough to make the call"; keeping the group small; practice varies by silo. |
| 7. New behaviors and capabilities | People move from gathering to oversight; agents kept up to date with feedback and monitoring; controlled sharing of information; stakeholder identification; trained users; the effort to maintain agents counted honestly. |
| 8. New mindsets | Trust but verify; curiosity when the AI fails; use it by default; AI amplifies people and a person makes the call. (+) No one decides alone; confidentiality through governance, not exclusion. |
| 9. How | **Individual:** Digital Accelerator identity; validate on past DDs. **Team:** agents as partners; side-by-side comparison. **Organization:** standardise, then tailor; best practice without "not invented here"; change management first. (+) Governance partners; staged path to trust. |

**Honest status line for the slide (2026-10-23):** the agents, the DD setup, a fictional data room, the findings register, the four-state checklist, the briefing and the three gates exist and run. A person accepts or rejects each draft finding, sets each checklist state and decides each gate, but the app has no login, so those decisions are not authenticated. Per-person decision rights and controlled sharing (data walls) do not exist yet.

---

## What the team still has to decide, with my proposed default for each

The last column is **my proposal** for the team to confirm or change. None of it is decided. Where the owner has already answered, the row says so.

| # | Decision | Open question | My proposal (to confirm) |
|---|---|---|---|
| 1 | Does the AI only tidy the team's Box 9 wording, or may it also add to it? Until then every Box 9 addition is a suggestion. | 16 | The AI tidies wording and adds only lines marked "suggested, not agreed", which the team accepts or deletes one by one. This is how Box 9 is handled now. |
| 2 | Is there a record of the team's own filled-in canvas, and notes from the discussion before the recording started? | 17 | Ask the team for its photo or notes before the merge. Until then the written draft and the recording are the source, as now. |
| 3 | The layer count: five layers plus a human frame, or six. | 4 | Five layers plus a human frame (concept, section 2). The content is the same as six; only the drawing differs. |
| 4 | Which brief items did the team actually agree (autonomy levels, agent kinds, finding format)? The Box 7 and Box 8 additions depend on this. | 11 | Present them as the working concept, say so on the deck (its statement V8), and confirm at the next team session. Do not claim they were agreed. |
| 5 | Who owns the trust layer, the evidence layer and orchestration, and who approves playbook updates? | 14 | An executive sponsor appoints a governance lead for trust; a knowledge base owner for evidence; the person who activates the team, with a platform owner, for orchestration; the playbook owner approves every update (concept, section 3). |
| 6 | How agent performance is monitored, and who grants more autonomy. | 15 | The agent's owner reviews its evaluation results between DDs. A level goes up only at the scale gate of the staged path, on evidence from replay on closed DDs, with the sponsor and the governance lead agreeing (concept, section 4). |
| 7 | How inspections are positioned next to Quality. | 6 | A concept only. Do not start without Quality's agreement; Quality is a named governance partner and takes part in the readiness sign-off. |
| 8 | How validation on past DDs and the side-by-side comparison happen when past DDs can never enter this repository. | 18 | Each company replays its closed packages inside the company against a list of material issues that people who know the outcome write and freeze first. Only scores and counts come back to the group, never document content (to verify with each company's compliance function). |
| 9 | Whether to use the words "pilot" or "experiment" for the staged path. | 24 | Say "staged path" in the room and use "experiment" in documents, as the other team deliberately avoids "pilot", until the sponsor says otherwise. |
| 10 | The rules for decisions only people make, and for disagreement between the lead and a specialist. | 22 | **Answered by the owner on 2026-10-22 and built in the gates:** the lead decides; a dissent is recorded under the decision and never blocks it; going ahead on incomplete evidence is allowed with a recorded reason. What is left: who counts as "the lead" once there is a login (question 34). |
| 11 | Who the senior stakeholders are, and the decision we ask them for. | 7 | Ask the cohort facilitator who will attend. Until then the deck's default ask is its Option A: an executive sponsor, a governance partner, and closed DD packages released for replay. |
| 12 | Which 6 to 8 agents the MVP builds in depth. | 12 | The eight in `01_concept/mvp-agent-selection.md`, with the open points listed there (the orchestrator, Carlos or Cyrus, medical affairs). |
| 13 | Which public asset with a known outcome the demo uses (a measurable "issues found" depends on it). | 5 | Choose by three tests: the model does not already know the outcome (try it with no documents), enough public sources are dated before the outcome, and the outcome is not a headline. Agree the tests first, then list candidates. No asset is named here. |

**Points to settle in the canvas itself (new; not yet in `OPEN_QUESTIONS.md`)**

- Is "a defensive, bottleneck-hunting view" a best mindset (Box 6)? On tape it sounded like an observation. *My proposal:* keep it on the best side, worded as "a bottleneck-hunting view: what could make approval hard in any region", and drop "defensive".
- Does the team want the "4 people become 2" example in Box 7? It was said off the cuff and was caveated at once. Even so, it can be read as a target. *My proposal:* drop the number and keep "smaller human teams, counting the effort to maintain the agents", as the concept and the deck already do.
- Do we keep both "cohort members who teach others" and "buy-in" in Box 2? *My proposal:* keep both; one speaks to the people in the cohort, the other to management.
- Should the measurable outcomes in Box 2 go into the canvas, given that no baseline can be shown in public? *My proposal:* yes, as outcomes without numbers ("to be defined with baselines"), as Box 2 reads now.

**For the merge with the other team (to verify; their material is not reviewed in full)**

- Their initiative has the regulatory lead recommending whether to acquire. Ours says the briefing is not a "buy" or "don't buy" decision. Settle which wording the merged canvas uses. *My proposal:* keep "a briefing, not a decision" for the output of the DD, and treat the recommendation to acquire as a separate human decision, taken by the decision owner outside the DD playbook.
- Their current-state boxes stress missed risks, regulatory input being ignored, business pressure beating judgment, and blame-shifting after a loss. Our boxes do not name these. The team may want to adopt them as worst-case items. *My proposal:* offer them to the team as optional additions to Boxes 5 and 6, marked "suggested, not agreed".
- Their Box 8 says humans own every final decision. This matches ours.
- Questions 3, 13 and 20 (what the other team contributes, when, and what happens to their files) decide how far we can merge.
