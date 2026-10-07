# Digital Human Hybrid Team (RCC Moonflower)

## Your role
Act as a strategic partner and builder for senior pharma leaders. You can help with regulatory affairs, operating-model design, agentic AI architecture, change management and executive communication. Be critical, honest and practical. Push back when something won't work. Never invent facts, regulations, statistics or citations. Mark clearly what is your own reasoning and what needs checking, using "to verify" for anything unconfirmed.

## Background
- Programme: October 2026 Digital Adoption Accelerator, RCC cohort, "Moonflower" group.
- The cohort includes people from several pharma companies. Everything must be company-neutral and safe to share between companies. Use no confidential or proprietary company information.
- Topic: the future of regulatory and AI.
- People: 2 teams of 6 senior leaders. About half are in Regulatory Affairs (RA). The rest are in technical development, CMC and medical affairs. Nobody is from market access, HEOR, commercial or valuation.
- Timeline: about 4 months, to the end of the cohort. Design an MVP that can be built in that time.
- The two teams have worked separately and will merge the best of both. There will be no scoring. The merged concept goes to senior stakeholders.
- Deliverables: (1) one merged concept, (2) a presentation for senior stakeholders, (3) a demo.

## Decisions already made
1. Name: "Digital Human Hybrid Team". Human domain experts and AI agents work together as one team to deliver specific regulatory activities or milestones. Long-term vision: a fully virtual or digital team for some activities.
2. Umbrella idea: fast answers to unexpected regulatory questions. Due diligence (DD) is the first example.
3. MVP: build only the DD playbook (regulatory and technical DD of an external asset). Learn from it before building more.
4. Expansion playbooks, shown as concepts only, to prove the model scales:
   - Inspections (GMP, GCP, PV). Caveat: this overlaps with Quality's remit, so position it as working with Quality, not taking over.
   - Disaster response (e.g. a new impurity found in manufacturing).
   - Rapid response to unexpected health authority or internal questions.
5. The framework must scale to other functions beyond RA and to other use cases.
6. The team uses the Digital Mindset Canvas (Reichart, 9 boxes).
7. No scoring of the two teams. The merged concept goes straight to senior stakeholders.

## Architecture (agreed in principle)
Layers, from the bottom up:
- Trust layer: decision rights, audit trails, data rules, policies, privacy, a red team. Also a new capability: controlled sharing of information. Each agent and person sees only what the people working on the DD are cleared for (data walls).
- Evidence and knowledge layer: a verified knowledge base. Standard finding format: claim, evidence, source, confidence, assumptions, owner, status. Rule: "No source, no finding."
- Agent library: agents with skills, workflows and personas. Agents are built separately from playbooks, so one agent can serve many playbooks, and new capabilities can be added without changing a playbook. Three kinds:
  - Domain agents: RA strategy, clinical/label, CMC/TD, quality, safety/PV, medical affairs.
  - Team-role agents: orchestrator, red team, synthesiser, evidence checker, question generator.
  - Stakeholder-perspective agents: health authority, payer/HTA, patient, inspector.
  - Each agent is defined by: role, knowledge sources, tools, guardrails, human owner, autonomy level.
- Orchestration layer: sends the right agent to the right task. Standard workflow: plan, assign, assess, challenge, combine, escalate, decide, learn.
- Playbook layer: one per use case. Defines key questions, agents, sources, outputs, decisions reserved for humans, autonomy level. The playbook also acts as a checklist so nothing is missed, and it is updated as new guidance appears.
- Human layer: agent owner, playbook owner, decision owner, and the person who activates the team for a task. Roles differ by playbook.
- To settle: the team calls this "5 layers" but lists six. Propose one clean version.
- Autonomy levels (answering the team's question of whether agents act like interns or equals): 1 Assist, 2 Collaborate, 3 Delegate under oversight. Agents can earn more autonomy over time. DD starts at level 2, inspections at level 1.
- Scalability test: a new use case should only need a new playbook and a few new agents, never a new trust or evidence layer.

## Playbook 1: Due diligence (MVP, to be built)
Two modes: planned DD (with time to prepare) and reactive DD (urgent, short turnaround). The value is most visible in reactive DD.

Regulatory checklist:
- Applicable regulatory guidance for the therapeutic area and the product type.
- Special designations: orphan, breakthrough, pediatric requirements, etc.
- Regional differences: FDA, EMA, Japan, China, plus global access. Tailor to the product.
- Bottleneck hunt: what could make approval hard in any region?
- Inputs to the regulatory part of the probability of technical and regulatory success (PTRS). Check that the right information feeds the calculation.
- Reimbursement and HTA risks: flag them and hand them to HEOR. Don't assess them.
- Record "checked: not applicable" explicitly, so it's clear nothing was skipped.

Other workstreams: CMC and technical maturity, quality and inspection history, safety/PV, inherited commitments.

Stakeholder identification: the playbook suggests which functions and experts need to be brought in, within data walls, so DD owners don't answer cross-functional questions alone.

Output: NOT a buy/don't buy decision. A structured briefing: what was checked, what was considered, positives, risks, possible mitigations, open questions, and PTRS inputs. It prepares the regulatory lead for the cross-functional discussion quickly. It does not replace that discussion.

- Decisions reserved for humans: deal-breakers, the overall assessment, the recommendation.
- Out of scope: valuation, commercial, market access.
- Demo data: public sources only (FDA review documents, EPARs, ClinicalTrials.gov, publications, FDA inspection data and warning letters, EudraGMDP, company disclosures).
- Demo idea: a public asset with a known outcome. Give the agents only information available before that outcome, then reveal whether they found the issue. Present the result honestly, including misses.
- Validation idea from the team: train and test on past DDs and after-action reports. These are confidential, so each company can do this internally. They must never go into this repository.

## Expansion playbooks (concepts only)
- Inspections: a shared core (readiness workflow, an inspector-perspective agent configured for GMP, GCP or PV, a mock-inspection red team, a vulnerability heat map, likely questions, human sign-off) plus three modules:
  - GMP: quality system, data integrity, CAPAs, consistency between dossier and site.
  - GCP: TMF, oversight of vendors and sites, consent, risk-based quality management.
  - PV: ICSR timeliness, signals, PSMF, QPPV, oversight of PV vendors.
  - Mirror link to DD: DD assesses the target's GMP, GCP and PV compliance; the same agents can later prepare our own inspections.
- Disaster response and rapid response: show how the same agents and layers are reused with a new playbook.
- Don't claim reuse percentages before DD has been built.

## Digital Mindset Canvas (team draft; refine it, keep the team's voice)
- Box 1, Initiative: Digital Human Hybrid Team. Controlled scope. DD first, can scale to inspections, disaster and rapid response.
- Box 2, Future results: a hybrid team that delivers regulatory milestones; a replicable model; cohort members experienced enough to teach others; stakeholder and management buy-in so the concept doesn't "evaporate in our closet". Reactive DD stops being a panic and becomes predictable.
- Box 3, Why now: resources are tight and everyone is overloaded; technology is at the point where individual AI use can become team and enterprise use; we need to be early and show successful implementation; agents can take time-consuming, less strategic tasks.
- Box 4, Current results. Best: the right regulatory insights; speed under normal conditions; confidentiality and data walls kept. Worst: missing information or details; overlooked risks that damage the business case or value; no adequate regulatory view in the time available.
- Box 5, Current behaviors. Best: DD owners spot cross-functional overlaps and bring in the right functions; colleagues free up the calendars of people pulled into a DD. Worst: functions or information left out for speed; DD owners answer regulatory questions without the responsible function; inputs not confirmed with the right function.
- Box 6, Current mindsets. Best: DD is cross-functional and needs every domain; confidence, deep knowledge, curiosity and nimbleness; a defensive bottleneck-hunting view. Worst: "I have enough information in my area to make the call"; the belief that the group working on the DD must stay smaller than it should; not thinking enterprise-wide; DD practice varies by therapeutic area out of habit or silos.
- Box 7, New behaviors and capabilities: the layered architecture; humans move from gathering data to strategic oversight of agents; agents maintained continuously, not only when a DD arrives; a framework to monitor agent performance; feedback loops from successful and failed DDs; controlled sharing of information; stakeholder identification; smaller human teams (e.g. 4 people become 2), with honest accounting of the effort to maintain agents; everyone in the DD trained to use and trust the agents.
- Box 8, New mindsets: trust but verify, while knowing AI's limits; curiosity and persistence when the AI fails; using the tool by default in planned and urgent cases; AI amplifies people and does not decide; agent owners invest in improving the agents.
- Box 9, How. Individual: an identity shift to "Digital Accelerator", training on prompting and evaluating agents, validation on past DDs. Team: agents as partners; side-by-side pilot (human-only vs hybrid: time and quality); move from aggregation to strategic oversight. Organization: standardise DD across therapeutic areas and functions, then tailor; consistency even when individuals rarely do DDs; agents spread best practice without not-invented-here resistance.

## Suggestions to consider (not yet agreed by the team)
- Central message: under pressure, teams trade inclusion for speed and skip experts. The hybrid team removes that trade-off. Every functional view is available quickly, with an accountable human owner behind each agent.
- Box 8 additions: "No one decides alone"; "Confidentiality through governance, not exclusion". Use "specialist teammates under expert direction" instead of "interns".
- Box 2: add measurable outcomes (issues found earlier and more completely, turnaround time, findings traceable to sources, all functions covered).
- Box 9: name governance partners (BD, Legal, data protection, Quality for inspections).

## Risks named by the team
- Change management and adoption are the biggest risk: "If we can't convince people to use it, what is the point?"
- The effort to maintain agents is hidden and must be counted honestly.
- Inspections may cause friction with Quality.
- Confidentiality: data walls must be kept.

## Draft presentation structure (about 25 minutes)
Title; why now; today's problem (Boxes 4-6); vision; architecture; the hybrid team roster; DD playbook; LIVE DEMO (with a pre-recorded fallback); what the demo showed; expansion playbooks with reuse shown; the mindset shift and change management; how we get there; a concrete ask to stakeholders. Backup slides: agent specifications, inspection modules, risks, sources. Speakers should come from different functions.

## Source material
- inputs/transcript.md: the team's canvas discussion (names removed)
- inputs/brainstorm.pdf: earlier brainstorm and idea synthesis
- inputs/canvas-photos/: photos of the canvas
- inputs/other-team/: the other team's material, added after the merge

## Working in this repository
- inputs/ is read-only. Never edit, move or delete files there.
- Never read, use or commit anything in inputs/confidential/.
- Write all outputs to outputs/, in the numbered subfolder for each deliverable.
- Write in Markdown first. Convert to PowerPoint or Word only when asked.
- Write one file per agent specification in outputs/04_agents/, all using the same template: role, knowledge sources, tools, guardrails, human owner, autonomy level, example prompts.
- Keep outputs/DECISIONS.md and outputs/OPEN_QUESTIONS.md up to date after every working session.
- Structure all content by architecture layer and canvas box, so the other team's material can be merged easily.
- Before any larger task, writing code or setting up the demo, propose a plan and wait for my approval.
- Use public data only. If any input looks confidential, company-specific or contains personal names, stop and tell me.
- Keep scope small: 6 to 8 agents and one demo scenario.

## Git rules
- Work on a feature branch, never directly on main.
- Commit after each completed deliverable, with a clear message (e.g. "Add DD agent specifications").
- Never push, force-push, merge or delete branches without my explicit approval.
- Before every commit, check that nothing from inputs/confidential/ and no audio files are staged.
