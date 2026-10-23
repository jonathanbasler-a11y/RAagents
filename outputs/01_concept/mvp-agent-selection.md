# Which agents the MVP builds in depth (proposal)

**Status:** proposal for the owner, 2026-10-23. Nothing here is decided. It answers backlog items 4 and 5 and prepares open question 12 (which 6 to 8 agents form the MVP). It lives here and not in `outputs/04_agents/` on purpose: the app reads every Markdown file in that folder except `README.md` as an agent specification. None of the 25 specifications was changed.
**Markers:** "my reasoning" is the drafter's view, not a team decision. "To verify" marks something unconfirmed.

## 1. What "in depth" means, and why choose

The project brief asks for 6 to 8 agents and one demo scenario. The app carries a catalogue of 25. "In depth" would mean, for each chosen agent: public sources connected, tools it can use, evaluation cases that measure it, and a named human owner who keeps it current. Today none of the 25 has sources or tools, so every agent is equally shallow; the choice is about where to spend the build time first. More agents means more owners and more upkeep, which the team named as a risk (concept, section 8).

## 2. The test: why an agent, and not a rule, a template or a person

My reasoning. A task earns an agent only if all three are true:

1. **The material varies and the answer needs judgment.** If the same steps always give the answer, it is a rule or a piece of code.
2. **The output can be wrong without anyone being hurt before a person looks.** If a wrong output would act by itself, it needs a person or a check in code.
3. **A fixed form would not do.** If the answer is always the same shape, it is a template.

Everything that fails the test is listed in section 5, with what it is instead.

## 3. The proposal

**Eight agents in depth** (my reasoning; the owner chooses):

| # | Agent | Why this one |
|---|---|---|
| 1 | **Rosa**, Regulatory lead (`reglead`) | Weighs guidance, designations, bottlenecks and inherited commitments across a package, then hands each part to the teammate who owns it. The DD's regulatory checklist is hers |
| 2 | **Cyrus**, CMC and technical development (`o-cmc`) | The DD names "CMC and technical maturity" as its own workstream: drug substance, drug product, manufacturing and supply |
| 3 | **Quinn**, Quality and inspection history (`o-qa`) | The DD names "quality and inspection history" as its own workstream; the public sources for it exist (FDA inspection data and warning letters, EudraGMDP) |
| 4 | **Priya**, Safety and PV (`o-pv`) | The DD names safety and PV as its own workstream: published signals and later data that confirm or resolve them |
| 5 | **Emeka**, Evidence checker (`ev`) | Keeps "No source, no finding" visible in the team's replies. Code enforces the rule for findings; Emeka's job is to say what each claim would need |
| 6 | **Ruben**, Red team (`red`) | Challenges findings the way a health authority reviewer would: judgment and imagination that no rule has |
| 7 | **Sofia**, Synthesiser (`syn`) | Sums up where views agree and differ, with open checks and the role that owns each. No call, no new facts |
| 8 | **Oskar**, Orchestrator (`orc`) | Answers when no routing term matches and names who fits |

**The orchestrator question (open since question 12).** The list above counts Oskar inside the eight, which stays inside the brief's limit. The alternative is to count him on top of seven specialists and add Clara (Clinical regulatory strategy, `clin`) as the eighth, for an asset whose approval turns on its clinical path. I recommend the first, because it keeps to the owner's own limit, and Clara is the first agent to add if the demo asset needs her. Routing is done by code, so Oskar adds little beyond naming who fits; the owner may prefer to spend his seat on a specialist.

**Points I want the owner to see:**

- **Three of the eight have no evaluation cases yet.** Cyrus, Quinn and Priya are not among the 14 agents with cases (the case files cover Rosa, Clara, Carlos, Ravi, Lena, Ines, Dara, Oona, Pia, Oskar, Saskia, Emeka, Ruben and Sofia). Before any of them is called "in depth", it needs about four cases like the others, and a baseline.
- **Carlos or Cyrus.** The demo's steps 3 and 5 use Carlos (CMC regulatory), and he is on by default. His remit (quality module readiness, manufacturing sites and their compliance status, comparability) overlaps with both Cyrus and Quinn. I put Cyrus in the set because the DD workstream is named for technical maturity, and keep Carlos in the catalogue, on by default, so the demo flow does not change. This is the call I am least sure of.
- **Medical affairs (Malik) is not in the set.** Half the cohort is not in RA, and medical affairs is one of the functions that built this concept. DD flags medical questions to the right function; my reasoning is that a regulatory DD needs medical affairs for disease context and evidence gaps, which Clara and Rosa can open, but the owner may want the function represented.
- **Two remits need rewording before these agents go in depth.** The synthesiser's specification says it writes the briefing, and the evidence checker's says it enforces "No source, no finding". Code now does both for the DD (the briefing is assembled by code; the register checks each quote). What a model adds is a summary of unverified views (Sofia) and a list of what each claim would need (Emeka). The specifications were not changed here (open question 35).
- **The depth set is a build order, not a team.** In a live DD the team still follows the DD setup: the other 17 agents stay in the catalogue and join by the stage and the asset's classification.

## 4. The catalogue: one line per agent

Order and names follow the roster in `outputs/04_agents/README.md`. "Set" is my proposal: **Depth** (the eight above), **Catalogue** (stays as it is, on or off by the setup), **Later** (build only when sources or a second playbook need it).

| Agent | Level | What it does | Why an agent (my reasoning) | Set |
|---|---|---|---|---|
| Rosa, `reglead` | 2 | Overall regulatory strategy: guidance, designations, bottleneck hunt, PTRS inputs, inherited commitments | Weighs varied material across topics and routes it | Depth |
| Clara, `clin` | 2 | The clinical path against guidance: design, endpoints, safety signals as they affect approval | Reads trial design against guidance: judgment on varied material | Catalogue; first to add if the asset needs it |
| Carlos, `cmcreg` | 2 | Quality module readiness, sites and their compliance status, comparability | Comparability and readiness vary by product; overlaps Cyrus and Quinn | Catalogue (on by default) |
| Ravi, `regional` | 2 | Regional differences, local requirements and bottlenecks, one expert per region | The region checklist is a template; the agent adds interpretation of how a region's rules bite on this asset | Catalogue |
| Lena, `label` | 2 | Target label claims against the evidence and comparable labels | Compares claims with evidence: reading and judgment | Later (matters when a filing is near) |
| Ines, `intel` | 2 | New guidance, precedents and health authority positions | Needs retrieval of current guidance; with no tools today she can only explain how she would look | Later (needs connected sources) |
| Dara, `comp` | 2 | Trial registration, results postings, public disclosure obligations | Mostly a lookup and a rule check: closer to a checklist item plus a registry lookup. In the demo script she is the one expected to have nothing to add (step 5) | Later; consider a rule instead |
| Olu, `ops` | 2 | Dossier structure, submission history, readiness to file | Structure and history are a template plus a person; joins late | Later |
| Mira, `mw` | 1 | Content inputs for a filing-readiness gap check | Drafting needs judgment, kept at level 1; joins late | Later |
| Oona, `sp-orphan` | 2 | Orphan designation status and conditions per region | Needed only when the asset is orphan; depth sits in the classification | Catalogue |
| Pia, `sp-paed` | 2 | Paediatric plans and waivers | Needed only when the classification applies | Catalogue |
| Eitan, `sp-exp` | 2 | Breakthrough, accelerated and priority pathways per region | Needed only when the classification applies | Catalogue |
| Chen, `sp-combo` | 2 | Device and drug-device requirements | Needed only for combination products | Catalogue |
| Dev, `sp-cdx` | 2 | Companion diagnostic co-development and approval | Needed only for companion diagnostics | Catalogue |
| Rhea, `sp-rm` | 2 | Risk management plans and minimisation measures | Judgment on a plan's adequacy; no trigger yet | Later |
| Paolo, `sp-promo` | 2 | Promotional claims and materials | Not needed before a filing | Later |
| Oskar, `orc` | 2 | Planning and assigning; answers when nobody matches | Free questions need a reader; routing itself is code | Depth |
| Saskia, `san` | 1 | Drafts sanitised questions for cleared experts | Deciding which details identify the asset is judgment; she only drafts and a person approves | Catalogue |
| Emeka, `ev` | 2 | Evidence checker | See section 3 (remit to reword) | Depth |
| Ruben, `red` | 2 | Challenges like a health authority reviewer | Needs judgment no rule has | Depth |
| Sofia, `syn` | 1 | Synthesiser | See section 3 (remit to reword) | Depth |
| Cyrus, `o-cmc` | 2 | Technical maturity: substance, product, manufacturing, supply | A named DD workstream; needs reading of varied technical material | Depth |
| Quinn, `o-qa` | 2 | Inspection history and GMP status of the named sites | A named DD workstream; interpretation of inspection records | Depth |
| Priya, `o-pv` | 2 | Published safety signals and later data | A named DD workstream; interpretation of varied literature | Depth |
| Malik, `o-ma` | 2 | Disease context, standard of care, evidence gaps | Varied material; kept for the owner to decide (section 3) | Catalogue |

## 5. Deliberately not agents

My reasoning, from what exists today. Each of these already runs as code, as a template, or with a person, and should stay there.

| Thing | What it is instead | Why not an agent |
|---|---|---|
| The as-of date wall on documents | Code: a rule refuses and never shows a later-dated document | Must never depend on a model's judgment |
| "No source, no finding" for findings | Code: a claim is kept only if its quote is word for word in a document the agent was shown | A check, not an opinion |
| The four checklist states and "checked needs an accepted finding" | Code and database | The same rule every time |
| Routing a question to agents | Code: @mentions, then topic terms, at most three specialists | Repeatable, and must be explainable ("How this turn ran") |
| Assembling the briefing | Code, with no model | A fixed form built from accepted, tagged findings |
| The gates' facts and recommended call | Code, from fixed rules | A person must be able to see exactly why |
| Who sees what (data walls) | Platform access control; not built | Access cannot be decided by a model |
| Deal-breakers, the overall assessment, the recommendation, going ahead on incomplete evidence, stopping the DD | People (the always-human list) | Accountability |
| The probability of technical and regulatory success (PTRS) | The calculation's owner; agents describe inputs only | A number with an owner |
| Reimbursement and HTA assessment | HEOR; flagged and handed over, out of scope | Outside the DD's remit |
| Approving a sanitised question before it leaves | The RA DD lead | Accountability |
| Approving a playbook update | The playbook owner | Accountability |
| Standard forms and region checklists | Templates | Always the same shape |

## 6. What I did not do

- I changed no specification and no app code. A `why_agent` field in each specification would need the loader to accept a new key (it refuses unknown keys) and a version bump on 25 files. If the owner picks the set, that is a small follow-up; this file holds the lines until then.
- I did not decide anything. Open question 12 stays "Partly answered" until the owner chooses.

## 7. What the owner decides

1. The eight (section 3), and whether the orchestrator is inside the eight.
2. Carlos or Cyrus for the CMC place.
3. Whether medical affairs must be represented.
4. Whether the synthesiser's and the evidence checker's specifications are reworded now (needs a version bump and a new baseline for those two agents).
