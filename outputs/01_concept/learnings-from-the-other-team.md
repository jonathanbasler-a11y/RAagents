# Learnings from the other team's work (draft for the merge)

**Status:** draft, 2026-10-15. Nothing here is agreed by the team.
**Source:** the other team's folder `hybrid-regulatory-dd-team/` on `main` (33 files, added 2026-10-08). It was read with AI help. The structural claims below were spot-checked against the files; anything that was not is marked *to verify*.
**Credit and handling:** ideas and structure only, credited to the other team in our cohort. No wording is copied. Names, tool names and links that appear in their files are deliberately left out (see open question 20 and section 8).

## 1. In one paragraph

They built the *process* first. A fixed due-diligence workflow of 12 stages with 5 human gates. 11 job-doing agents, each answering to a named human specialist. 8 kinds of decision that always stay human. A short list of things deliberately **not** made into agents. A fictional data room with 10 planted issues and an answer key. A demo that is a rules file turning a coding assistant into a voice co-presenter. A one-hypothesis opener deck. We built the *team* first: 25 named persona agents that really run, an evaluation harness, a trust layer. The two halves fit together.

## 2. At a glance

| Topic | Their approach | Ours today | Take |
|---|---|---|---|
| Unit of design | Workflow stages with gates; agents are jobs inside stages | Personas in chat rooms; the playbook is described in the brief and the mockup | Add a real workflow with gates around our agents |
| Humans | A named specialist per agent; 8 decisions always human | Owners per agent and playbook; reserved decisions | Adopt their explicit "always human" list |
| Challenge | A red-team agent in a separate context that cannot change findings | Red team and evidence checker as team-role agents | Adopt the structured output of the challenge pass |
| Evidence rules | Cite or stay silent; fact, inference and recommendation kept apart | Chat answers are model output and never evidence. Since the findings register (2026-10-19), "no source, no finding" is enforced in code for findings: a claim becomes a draft only with a verbatim quote from a document the agent was shown, and a person accepts or rejects each one. Before that, this cell said the rule was enforced in code; it was not. | Add the wording rule for absence |
| Testing | A planted-issue case with an answer key; a staged path to trust | 59 evaluation cases with a judge from another model family | Add their case types to our harness |
| Demo | A voice co-presenter on a fictional case; the "run" is prewritten (*to verify*) | A live chat app and an illustrative workspace | Borrow the stage mechanics, keep ours real |
| Scope | One use case | DD first, expansion playbooks as concepts | Keep ours |

## 3. By architecture layer

**Trust layer**
- *Permission ceiling.* Three tiers: observe, recommend, act, where "act" never covers reaching a conclusion. Adopt it as an explicit cap on our autonomy levels: no level ever concludes.
- Their trust layer is thin (a read-only, logged workspace). Ours (data walls, audit trail) stays.

**Evidence and knowledge layer**
- *Absence wording.* An agent says a document was not found in the data room; it never says the document does not exist, and it never guesses what a missing document contains. It fits our rule that absence is never stated without listing and reading first. Changing the shared prompt re-baselines every agent, so this goes through the measured order in the `agent-eval` skill: a case and a check first.
- *Coverage report.* Before claiming completeness, reconcile the counts like for like against a minimum pack and list the gaps.
- Keep fact, inference and recommendation visibly apart in every finding.

**Agent library**
- *Define jobs before agents.* Each agent gets a short "why an agent, and why not a template or a rule" line. Add this as a field to the agent spec template (`outputs/04_agents/README.md`).
- *Deliberately not agents:* triage rules, a library of known traps, the report template, the glossary. Write our own list. It also helps the 6 to 8 agent MVP choice.
- Their red team warns that many personas are hard to justify. That applies to our 25 more than to their 11.

**Orchestration layer**
- Their 12-stage ladder is one concrete instance of our generic eight steps (plan, assign, assess, challenge, combine, escalate, decide, learn). A playbook should name its own stages.
- Findings that depend on an open gate are marked provisional, and ranges are widened until the gate clears.
- The challenge pass reports counts: contradictions found, a double-counting check, missing specialist views. Use this as the output format for our red-team agent.

**Playbook layer (the DD playbook)**
- *Gate template.* At each gate: the choices open to the decider (go ahead, pause, ask for more information, or stop), what each one costs, a recommended call, and the evidence that would change the call.
- Show a draft range, the challenged range, then the lead's own position in the lead's words. "The machine said so" is not a reason. Never add the low ends of several ranges together (*their material does; to verify*).
- A plain statement of what a source cannot inform (for example an interim analysis after the cut-off) mirrors our as-of date rule.

**Human layer**
- A responsibility chart where agent support is never accountable.
- An "always human" list, including accepting incomplete evidence and settling disagreement between specialists.
- They leave open what happens when the lead and a specialist disagree. We should settle it instead of copying the gap.

## 4. By canvas box (suggestions only; the canvas stays in the team's voice)

- **Box 7, new behaviours:** define jobs before agents; agents observe and recommend, people conclude.
- **Box 8, new mindsets:** "experiment, not pilot" as a way of speaking (the team decides); "the machine said so is not a rationale".
- **Box 9, how:** a staged path: replay on closed packages, shadow run beside the normal review, assisted use, a scale gate. Capture baselines first. Measure material-risk recall first and speed second.
- **Box 2, measurable outcomes:** their material has no numbers either; our suggestion in the brief (issues found earlier and more completely, turnaround, traceable findings) still stands.

## 5. Demo and presentation

- The presenter announces the stage and the agent speaks only to that stage. Turns of 20 to 40 seconds, a "next" cue, and a spoken fallback if audio fails.
- A moment where the agent overstates and a person corrects it. Theirs is scripted; ours can be real, with the evidence checker catching a planted unsupported claim.
- Pre-flight questions before going live; check that tools and connectors are off; keep the answer key out of anything the audience can read.
- Opener deck: one testable value hypothesis, stated as "not a business case", with success criteria and conditions. Use the same shape for our ask to stakeholders.

## 6. What not to copy

- An animated "run" of prewritten text instead of agents that actually run (*to verify*: read from the demo page's script).
- Invented baselines and numbers; counts and versions that disagree between files (9 versus 11 agents, plan v3 versus v4); most thresholds and all 8 decisions left undecided.
- The full answer key shipped inside the audience-visible page.
- A scripted agent line that states a recommendation while the same kit says the agent never makes the call.
- Efficiency claims in the canvas and deck with no evidence.

## 7. Decisions needed from the team

Also in `OPEN_QUESTIONS.md` (22 to 25): the gate format and always-human list; which extra evaluation case types to add and whether to write our own fictional case or use a public asset; "experiment" versus "pilot"; whether their fictional data room can be reused (their consent and a check for accidental real-world matches first).

## 8. Handling notes

- Their files are already public on `main`. A review found, in kinds only: the accelerator programme name, personal first names and one full name, internal tool and storage names, shared links, and author metadata in the decks (not checked). The owner decided on 2026-10-15 to leave the files as they are for now (open question 20).
- Do not copy their text into our outputs. Credit "the other team", not individuals.
