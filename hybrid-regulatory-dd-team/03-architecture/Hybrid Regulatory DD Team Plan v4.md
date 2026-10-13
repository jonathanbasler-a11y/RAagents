---
type: project-plan
date: 2026-10-08
project: Moab Digital Accelerator
status: draft-for-discussion
version: v4
supersedes: 2026-1007 Hybrid Regulatory DD Team Plan v3
audience: multi-client workshop group (no client-specific content)
drafted_by: Part A generated from the architecture page data; Part B is plan v3 prose (Codex), QA by Claude
---

# Hybrid Regulatory Due-Diligence Team Plan, v4

This plan has two parts. **Part A is exactly what the architecture page shows**, tab by tab; use it when presenting the page. **Part B is the written plan behind it**: rationale, workshop input, capability building, red-team responses and open decisions. Part B is background and is not on the page; if the two ever differ, Part A matches the screen.

# Part A: What the architecture page shows

Everything in Part A appears on the published architecture page (https://claude.ai/artifact/V9iZfos2wBG21Z4UFGsiBM), in the order a viewer meets it. It is generated from the page's own data, so the wording matches the screen. When presenting, point to Part A. Part B is background that is not on the page.

## Page header
- Title: **Hybrid Regulatory Due-Diligence Team**, labeled **Proposal**
- Subtitle: Proposed architecture for a regulatory due-diligence team, from the Moab Digital Accelerator Digital Mindset Canvas, October 7, 2026. Regulatory agents gather, organize and check evidence. Regulatory specialists validate it, and the regulatory lead sets materiality, owns the rPTS position for Phase III assets and signs the recommendation.
- Headline counts: **11** regulatory agents · **7** regulatory specialists · **8** decisions that stay human · **4** deliberately not agents
- Tabs: Team architecture · Agent roster · Agents vs humans · Technical architecture · Decision rights · Experiments and measures

## Tab 1: Team architecture
A layered diagram. Lines connect each agent to the person it answers to. Clicking any box opens a side panel showing what it owns, why it exists, its traits, who it answers to, inputs, outputs and control.

### Layer 1: The deal
- **Deal governance committee** (Human)
  - Makes the acquisition decision and records the enterprise risks accepted with it
  - Owns: Go/no-go decision and accepted enterprise risk
  - Inputs: Deal recommendation, signed regulatory assessment, other workstream findings
  - Outputs: Acquisition decision, risk-acceptance record
  - Control: Dissent stays visible in the record
- **Executive deal sponsor** (Human)
  - Owns the deal thesis and timeline, then brings the recommendation to the governance committee
  - Owns: The deal: thesis, timeline, and the recommendation to the committee
  - Inputs: Signed regulatory assessment and other workstream findings
  - Outputs: Deal recommendation
  - Control: Asks the regulatory team for its assessment; does not set it

### Layer 2: Regulatory lead
- **Regulatory due-diligence lead** (Human)
  - Sets regulatory scope and materiality, owns the Phase III rPTS position, and signs the regulatory recommendation
  - Owns: The regulatory assessment, materiality, the rPTS position for Phase III assets, and the signed recommendation
  - Inputs: Validated specialist findings, risk register, issues list
  - Outputs: Signed regulatory recommendation
  - Control: Human sign-off; 'the machine said so' is not a rationale

### Layer 3: Regulatory specialists
- **Clinical regulatory documentation specialist** (Human)
  - Validates the clinical regulatory record and determines whether the evidence supports the proposed pathway
  - Owns: Conclusions on the clinical regulatory record and pathway
  - Inputs: Clinical regulatory documentation agent output
  - Outputs: Validated clinical regulatory findings
  - Control: Time-boxed, risk-tiered review
- **CMC regulatory specialist** (Human)
  - Determines CMC regulatory readiness for the next milestone and reviews every material gap
  - Owns: CMC regulatory readiness conclusions
  - Inputs: CMC regulatory agent output
  - Outputs: Validated CMC findings
  - Control: Reviews every CMC red flag
- **Regulatory intelligence specialist** (Human)
  - Interprets agency history, guidance and precedent to determine what applies to the assessment
  - Owns: Agency history, guidance and precedent interpretation
  - Inputs: Regulatory intelligence agent output
  - Outputs: Validated history and precedent view
  - Control: Judges applicability; the agent only retrieves
- **Medical device specialist (as needed)** (Human)
  - Assesses device constituents, combination-product requirements and classification questions when a device is in scope
  - Owns: Device constituent and combination-product conclusions
  - Inputs: Medical device agent output
  - Outputs: Validated device findings
  - Control: Engaged when the asset includes a device
- **Labeling specialist** (Human)
  - Judges whether current and proposed labeling claims are supported and identifies implications for label strategy
  - Owns: Labeling claims and label-strategy conclusions
  - Inputs: Labeling agent output
  - Outputs: Validated labeling findings
  - Control: Owns any judgment on claim strength
- **Regional / country specialist** (Human)
  - Sets regional filing strategy and validates country-specific requirements, commitments and agency positions
  - Owns: Regional filing strategy and country-specific requirements
  - Inputs: Regional / country agent output
  - Outputs: Validated regional findings
  - Control: Engaged for the regions in scope
- **Commercial regulatory specialist** (Human)
  - Assesses post-approval obligations, promotional exposure and pending lifecycle changes for marketed or near-launch assets
  - Owns: Post-approval, promotional and lifecycle regulatory conclusions
  - Inputs: Commercial regulatory agent output
  - Outputs: Validated commercial regulatory findings
  - Control: Engaged for marketed or near-launch assets

### Layer 4: Regulatory agents
- **Data room manager agent** (Agent, act); answers to Regulatory due-diligence lead
  - Maps the data room to the regulatory evidence pack, tracks coverage and routes requests through the portfolio team
  - Owns: Maps the data room to the regulatory evidence pack, tracks coverage, and routes regulatory requests through the portfolio DD team
  - Why an agent: Data rooms are large, uneven and change during diligence. An agent can reconcile the inventory, trace missing cross-references and batch requests continuously while accountable reviewers confirm coverage
  - Traits: Answers 'did it pull everything?' with a coverage report; Says 'not found in the data room', never 'does not exist'; Reconciles document counts like-for-like; Turns missing cross-referenced documents into requests; Batches and de-duplicates requests so the seller is not swamped; Logs who reviewed each document
  - Inputs: Data-room documents, regulatory evidence pack
  - Outputs: Regulatory evidence inventory, coverage score, request list
  - Control: Read-only on documents; may only raise requests
- **Clinical regulatory documentation agent** (Agent, recommend); answers to Clinical regulatory documentation specialist
  - Builds cited clinical regulatory fact tables and checks document versions, registry entries and alignment with agency advice
  - Owns: Extracts and checks the clinical regulatory record: protocols, CSRs, investigator brochure, briefing documents, agency advice and registry entries
  - Why an agent: The clinical regulatory record spans versions, registries, agency advice and study documents that must be checked together. An agent can maintain cited fact tables and surface gaps for specialist validation
  - Traits: Phase-aware expectations; Separates what the data show from what the sponsor claims; Checks endpoints and design against agency advice; Checks core document versions and registry entries against the submission record; Labels every inference as inference
  - Inputs: Clinical regulatory documents
  - Outputs: Cited fact tables, advice-alignment check, version and registry gaps
  - Control: No citation, no claim; specialist validates
- **CMC regulatory agent** (Agent, recommend); answers to CMC regulatory specialist
  - Builds the cited CMC gap list against the next milestone, including commitments, inspection exposure and evidence gaps
  - Owns: Assesses CMC regulatory readiness against the next milestone: Module 3, specifications, stability, comparability, sites and inspection history
  - Why an agent: CMC readiness depends on patterns across Module 3, stability, specifications, sites, deviations, commitments and inspection records. An agent can track those links at scale while the specialist judges each red flag
  - Traits: Conservative: treats missing CMC evidence as a risk; Phase-appropriate: judges readiness against the next milestone; Reads deviation and out-of-spec history over time; Tracks open CMC commitments and CAPAs; Treats procedures as written, not as proof of practice
  - Inputs: Module 3, specifications, stability, site and inspection records
  - Outputs: Cited CMC gap list, open commitments, inspection exposure
  - Control: Every CMC red flag goes to the specialist
- **Regulatory intelligence agent** (Agent, observe); answers to Regulatory intelligence specialist
  - Builds the agency chronology and commitment ledger, retrieves dated precedent and monitors approved sources during diligence
  - Owns: Builds the agency-interaction chronology and commitment ledger, and retrieves dated guidance and precedent
  - Why an agent: Agency history changes with each correspondence, commitment, guidance version and jurisdiction. An agent can maintain a dated chronology and monitor approved sources while the specialist decides what applies
  - Traits: Quotes agency language; does not paraphrase it; Tracks every commitment to closure or 'open'; Date-, version- and jurisdiction-stamps every source; Flags superseded or draft guidance; Keeps watching during the deal and alerts on new agency actions
  - Inputs: Correspondence, meeting minutes, submissions, approved external sources
  - Outputs: Chronology, commitment ledger, holds, dated precedent set
  - Control: Approved sources only; specialist judges applicability
- **Medical device agent (conditional)** (Agent, recommend); answers to Medical device specialist (as needed)
  - Maps device and combination-product evidence to classification questions when the assessment includes a device
  - Owns: Checks device constituent, combination-product and classification evidence
  - Why an agent: Device review is conditional and requires evidence to be connected across constituent, combination-product and classification files. An agent can activate when needed, build the cited map and route classification questions to the specialist
  - Traits: Dormant by default to save cost and noise; Maps each classification question to the evidence; Flags missing device documentation as a request
  - Inputs: Device files, design documentation, scope flag
  - Outputs: Cited device findings and classification questions
  - Control: Runs only when the asset includes a device
- **Labeling agent** (Agent, recommend); answers to Labeling specialist
  - Maps each labeling claim to supporting evidence and agency positions, then flags unsupported or exposed claims
  - Owns: Maps current and proposed labeling claims to supporting evidence and agency positions
  - Why an agent: Labeling review requires each claim to be traced across evidence, agency positions and regional versions. An agent can maintain that map and flag unsupported claims while the specialist judges claim strength
  - Traits: Maps every claim to its evidence; Compares label versions across regions; Flags claims without support; Never rewrites label language
  - Inputs: Current and draft labeling, clinical evidence, agency advice
  - Outputs: Claim-to-evidence map, unsupported or at-risk claims
  - Control: Specialist owns any judgment on claim strength
- **Regional / country agent** (Agent, recommend); answers to Regional / country specialist
  - Builds a dated region-by-region view of filing status, approvals, commitments and divergent agency positions
  - Owns: Maps filing status, approvals, commitments and country-specific requirements by region
  - Why an agent: Regional diligence repeats the same status checks across jurisdictions while requirements and agency positions diverge. An agent can keep a dated comparison table current while the specialist owns filing strategy
  - Traits: One row per region in scope; Surfaces country-specific requirements and local commitments; Flags where agencies have taken different positions; Date-stamps every status
  - Inputs: Regional submissions, approvals, agency correspondence
  - Outputs: Region-by-region status table and divergent agency positions
  - Control: Specialist owns regional filing strategy
- **Commercial regulatory agent** (Agent, recommend); answers to Commercial regulatory specialist
  - Tracks post-approval obligations, promotional exposure and pending lifecycle changes for marketed or near-launch assets
  - Owns: For marketed or near-launch assets, reviews post-approval obligations, promotional history and pending lifecycle changes
  - Why an agent: Post-approval obligations, promotional history and lifecycle filings form a moving record for marketed or near-launch assets. An agent can track status and exposure continuously while the specialist assesses regulatory risk
  - Traits: Activated by asset stage; Tracks post-marketing commitments to closure; Flags agency enforcement history on promotion; Lists pending lifecycle changes and their filing status
  - Inputs: Post-marketing commitments, promotional materials and correspondence, variation filings
  - Outputs: Post-approval obligations ledger, promotional exposure, pending changes
  - Control: Runs for marketed or near-launch assets
- **Regulatory risk assessment agent** (Agent, recommend); answers to Regulatory due-diligence lead
  - Drafts the regulatory risk register, mitigations and Phase III rPTS drivers, incorporating validated findings and recorded red-team challenges
  - Owns: Drafts the regulatory risk register and mitigations; for Phase III assets only, drafts the rPTS drivers
  - Why an agent: Risk synthesis requires consistent treatment of validated findings, mitigations and uncertainty across the assessment. The lead judges materiality, resolves red-team challenges and owns the final rPTS position.
  - Traits: Limits rPTS drivers to Phase III assets; Uses qualitative risk views for earlier phases; Uses ranges and drivers, never a lone number; Separates fact, inference and recommendation; Receives red-team challenges for lead resolution
  - Inputs: Validated findings from every specialist, red-team challenge log
  - Outputs: Draft risk register, mitigations, rPTS driver table (Phase III)
  - Control: Never outputs go/no-go; the lead owns materiality and the rPTS position
- **Operational readiness agent** (Agent, recommend); answers to Regulatory due-diligence lead
  - Builds a phased readiness view covering obligations, transfer data, clinical supply, safety systems, knowledge, inspections, quality systems and contracts
  - Owns: Builds the operational readiness view and identifies transfer-gating gaps
  - Why an agent: Readiness checks repeat across phases and transfer types, with evidence, ownership and timing to reconcile. The lead judges readiness, and the integration team owns execution.
  - Traits: Organizes checks by risk category and guiding question; Filters checks by phase and transfer type; Requires evidence, named ownership and due dates; Tracks every open application, commitment and report to a post-transfer owner; Checks data, sequencing, knowledge, inspection and contractual dependencies
  - Inputs: Transfer scope, obligations, seller data, authority records, contracts, inspection plans and knowledge maps
  - Outputs: Readiness heatmap, dependency list, incomplete-item log, integration handoff
  - Control: Red or amber without evidence, owner or due date is incomplete
- **Red-team agent** (Agent, recommend); answers to Regulatory due-diligence lead
  - Independently challenges draft findings, the risk register and Phase III rPTS drivers, then records contradictions, unsupported claims, dissent and missing specialist views
  - Owns: Records independent challenges to findings, the risk register and Phase III rPTS drivers
  - Why an agent: Independent challenge benefits from a separate context that is not invested in the draft conclusion. The lead decides whether each challenge changes the assessment.
  - Traits: Works in a separate context from synthesis; Argues against the draft findings and risk register; Tests claims for contradictions and evidentiary support; Seeks missing specialist views and opposite recommendations; Records challenges and dissent without editing findings
  - Inputs: Draft findings, risk register, Phase III rPTS drivers, specialist record
  - Outputs: Challenge log, dissent record, missing-view requests
  - Control: Cannot change findings; the lead resolves or records each challenge

### Layer 5: Outside the regulatory team
- **Portfolio DD team** (Outside the team)
  - Coordinates the full diligence portfolio, including data-room operations, timeline, program management and its coordinator agent
  - Owns: Deal coordination, data-room operations, timeline, and its own coordinator agent and program management
  - Inputs: Requests from every workstream
  - Outputs: Data-room access, schedule, consolidated status
  - Control: Outside the regulatory team; the data room manager agent works through it
- **Other diligence workstreams** (Outside the team)
  - Conduct legal, safety, quality, commercial and financial diligence and share findings that overlap with regulatory review
  - Owns: Legal, safety and pharmacovigilance, quality, commercial and finance diligence
  - Inputs: Shared data room, regulatory findings where relevant
  - Outputs: Their own findings to the deal sponsor
  - Control: Outside the regulatory team; findings shared where they overlap
- **Integration team** (Outside the team)
  - Plans post-signing transfer of regulatory applications, registrations and commitments using the regulatory team’s handoff
  - Owns: Post-signing transfer of applications, registrations and commitments
  - Inputs: Regulatory transfer-gating items
  - Outputs: Integration plan
  - Control: Outside the regulatory team; receives the regulatory handoff

## Tab 2: Agent roster
One card per agent: permission tier, name, why an agent, traits, and who it answers to.

- **Data room manager agent** (act), answers to Regulatory due-diligence lead
- **Clinical regulatory documentation agent** (recommend), answers to Clinical regulatory documentation specialist
- **CMC regulatory agent** (recommend), answers to CMC regulatory specialist
- **Regulatory intelligence agent** (observe), answers to Regulatory intelligence specialist
- **Medical device agent (conditional)** (recommend), answers to Medical device specialist (as needed)
- **Labeling agent** (recommend), answers to Labeling specialist
- **Regional / country agent** (recommend), answers to Regional / country specialist
- **Commercial regulatory agent** (recommend), answers to Commercial regulatory specialist
- **Regulatory risk assessment agent** (recommend), answers to Regulatory due-diligence lead
- **Operational readiness agent** (recommend), answers to Regulatory due-diligence lead
- **Red-team agent** (recommend), answers to Regulatory due-diligence lead

**Traits every agent shares:** Cite or stay silent · Read-only on deal data · No cross-deal or cross-client memory · Every action logged · Human sign-off on every agent draft before it informs a conclusion

**Deliberately not agents** (rules or tools instead):
- **Intake and triage rules**: why not an agent: Rules are predictable and auditable; nothing here needs judgment an agent would add (Classifies asset stage, modality and question set; applies deal-breaker screen; activates agents and specialists)
- **Trap library and evidence-pack checklists**: why not an agent: This is expert knowledge; experts write it and agents apply it (Expert-written red-flag traps and minimum evidence packs by stage)
- **Report template and traceability matrix**: why not an agent: Assembly is templated; an agent adds risk without adding value (Assembles the validated assessment: issue, implication, action, owner, status, with claim-to-source links and a stated evidence limit)
- **Shared glossary**: why not an agent: Ambiguous terms produce confident wrong answers; fixing the vocabulary is cheaper than fixing the model (Plain definitions of roles and terms used across organizations)

## Tab 3: Agents vs humans
| Step | Agent does | Human keeps |
|---|---|---|
| Scope | Data room manager maps the data room to the regulatory evidence pack | Lead confirms asset stage, regions in scope and which specialists engage |
| Evidence inventory | Data room manager scores coverage and raises regulatory requests through the portfolio DD team | Lead accepts coverage or escalates gaps |
| Clinical regulatory documentation | Agent extracts the clinical regulatory record and checks it against agency advice | Specialist validates and rates materiality |
| CMC regulatory | Agent drafts the CMC gap list, open commitments and inspection exposure | Specialist validates and rates materiality |
| Regulatory intelligence | Agent builds the agency chronology and retrieves dated precedent | Specialist judges what the agency meant and what applies |
| Medical device and labeling | Agents map device evidence and labeling claims to their support | Specialists judge classification and claim strength |
| Regional / country | Agent builds the region-by-region status table | Specialist judges regional filing strategy |
| Commercial regulatory | Agent lists post-approval obligations, promotional exposure and pending changes | Specialist judges commercial regulatory risk |
| Operational readiness | Agent builds the phased readiness view and flags incomplete obligations, ownership gaps and transfer dependencies | Lead validates readiness and hands the view to the integration team |
| Risk assessment | Risk agent drafts the register and, for Phase III, the rPTS drivers; red-team challenges remain visible for lead resolution | Lead sets materiality and, for Phase III, the rPTS position |
| Red-team challenge | Agent challenges the draft findings, risk register and Phase III rPTS drivers, then records dissent | Lead resolves each challenge and retains judgment over any change |
| Recommendation | None; the template assembles the validated record | Lead signs; the deal sponsor and committee decide |

**Always human:** Domain conclusions and materiality · The rPTS position (Phase III assets) · The signed regulatory recommendation · Regional filing strategy · Judgment on labeling claim strength · Resolution of specialist disagreement · Acceptance of incomplete evidence · Deal go/no-go and risk acceptance

## Tab 4: Technical architecture
Stacked tiers, top to bottom:
- **People**: Executive deal sponsor · Regulatory DD lead · Regulatory specialists (7)
- **Workspace**: Isolated deal workspace · Review and sign-off queue · Regulatory issues list
- **Regulatory agents**: Data room manager · Clinical regulatory documentation · CMC regulatory · Regulatory intelligence · Medical device · Labeling · Regional / country · Commercial regulatory · Operational readiness · Risk assessment · Red team
- **Tools**: Document index and search · Citation enforcer · Regulatory evidence packs and trap lists · Glossary · Report template
- **Data**: Deal data room (read-only) · Approved regulatory sources · Buyer's own regulatory history (where permitted)
- **Interfaces**: Portfolio DD team and its coordinator agent · Other diligence workstreams · Integration team

**Guardrails across every tier:** Cite or stay silent · Read-only on deal data · No cross-deal or cross-client memory · Every action logged · Human sign-off on every agent draft before it informs a conclusion

**Agent permission tiers:**
- **observe**: Reads and reports only
- **recommend**: Drafts and proposes; a human accepts or rejects
- **act**: Executes bounded workflow actions (routing, requests, status); never conclusions

## Tab 5: Decision rights
| Activity | Deal committee | Deal sponsor | Reg DD lead | Reg specialists | Reg agents | Portfolio DD team |
|---|---|---|---|---|---|---|
| Set deal scope and timeline | C | A/R | C | I | I | R |
| Provide data-room access | I | I | C | I | S | A/R |
| Set regulatory scope: stage, regions, specialists | I | C | A/R | C | S | I |
| Gather and index regulatory evidence | I | I | A | C | S | C |
| Validate domain findings | I | I | A | R | S | I |
| Assess regulatory risks and mitigations | I | I | A/R | R | S | I |
| Set the rPTS position (Phase III assets) | I | C | A/R | C | S | I |
| Sign the regulatory recommendation | I | I | A/R | C | S | I |
| Decide go/no-go and accept risk | A | R | C | I | I | C |

Key: A Accountable · R Responsible · C Consulted · I Informed · S Agent support (never accountable)

## Tab 6: Experiments and measures
- **PHASE 0: Set up**: Name the lead and specialists, write regulatory evidence packs and trap lists, agree the data boundary with the portfolio DD team, build a known-trap test set, capture the baseline. Proves: Accountable people, approved inputs, a measurable starting point. (Duration: decision needed)
- **PHASE 1: Retrospective replay**: Run the regulatory agents on 2-3 closed diligence packages with known outcomes. Proves: Evidence coverage, citation accuracy, known-risk recall, visible misses. (Duration: decision needed)
- **PHASE 2: Shadow run**: Run alongside the standard regulatory review on 1-2 live assessments; the standard review still decides. Proves: Works inside a live deadline without steering the recommendation. (Duration: decision needed)
- **PHASE 3: Assisted use**: Use the hybrid team on live assessments with full specialist validation and lead sign-off. Proves: Measured effect on elapsed time and specialist effort. (Duration: decision needed)
- **GATE: Scale decision**: Regulatory leadership and the deal sponsor review the scorecard. Proves: Quality, adoption and efficiency thresholds met. (Duration: decision needed)

**Measures:** Material-risk recall on known cases (primary) · Claim-level citation accuracy (primary) · Evidence coverage vs minimum pack (primary) · Elapsed time to signed assessment (primary) · Specialist hours on search/assembly vs judgment (primary) · Reviewer rework rate (secondary) · Lead and committee confidence (secondary) · Assessments completed per quarter (secondary). Baselines and targets: decision needed.

**Experiment hypothesis:** A bounded hybrid workflow can reduce elapsed time and specialist search and assembly effort while maintaining material-risk detection and evidence traceability.

**Scale gate:** Expand only if predefined quality, adoption and efficiency thresholds are met. Throughput stays secondary.

Page footer: Sources: the six-person Digital Mindset Canvas, the red-team pressure test, with no client, product or deal details. Everything here is a proposal for the group to agree, revise or reject. Canvas © Reichart Effectiveness Solutions 2024.

# Part B: Background from the written plan (not shown on the page)

Nothing below appears on the architecture page. Use it to answer deeper questions.

> Updated 2026-10-08, after this text was written: the team now also has an **operational readiness agent** and a **red-team agent** (see Part A). The red-team agent runs the challenge pass that Part B still attributes to the regulatory risk assessment agent. Where Part A and Part B differ, Part A is current.



## The written plan

Everything in this plan is a proposal unless marked **Workshop input** or **Decision needed**.

### 1. Summary

The proposed team combines a regulatory due-diligence lead, seven regulatory specialists, and nine bounded regulatory agents. The agents gather, organize, compare, and challenge evidence inside an isolated deal workspace. Specialists validate domain findings. The regulatory lead sets materiality, owns the regulatory Probability of Technical Success position for Phase III assets, and signs the regulatory recommendation.

The executive deal sponsor owns the deal thesis, timeline, and recommendation to the deal governance committee. The committee makes the go/no-go decision and accepts enterprise risk. Portfolio coordination, program management, data-room operations, and the portfolio coordinator agent remain outside the regulatory team.

The experiment should test whether this model reduces elapsed time and specialist effort spent on search and assembly while maintaining material-risk detection and evidence traceability. Regulatory leadership owns the scale decision. The executive deal sponsor owns funding and priority.

### 2. Purpose, Boundary, Experiment Hypothesis, and Scale Gate

- Purpose: Produce a faster, traceable regulatory assessment for acquisition diligence
- Boundary: Regulatory agents support evidence work, risk drafts, and structured challenge; accountable people own conclusions and decisions
- Experiment hypothesis: A bounded hybrid workflow can reduce elapsed time and specialist search and assembly effort while maintaining material-risk detection and evidence traceability
- Scale gate: Expand only if predefined quality, adoption, and efficiency thresholds are met; throughput stays secondary

The design applies to regulatory due diligence. It does not define an enterprise AI governance structure. Its controls are practical rules for how the regulatory team handles evidence, review, and sign-off.

### 3. Workshop Input and De-identified Practice

**Workshop input** Demand is increasing across asset stages while products, modalities, CMC requirements, and regulatory expectations are becoming more complex. Diligence requests can arrive unexpectedly with one-to-two-week deadlines. Scarce specialists are pulled from existing work, and the regulatory lead may lack immediate access to every discipline required for the assessment.

**Workshop input** The desired result is a supported regulatory lead who can make a concise recommendation using clinical regulatory, CMC regulatory, regulatory intelligence, device, labeling, regional, commercial, business, and patient context as required. Participants also wanted stronger organizational confidence and greater assessment capacity.

The workshop record synthesizes participant perspectives. The group did not formally prioritize or approve the findings as consensus.

De-identified practice adds a staged funnel: an initial deal-breaker screen, detailed functional review, negotiation and planning, then go/no-go. It also adds document-level accountability, explicit evidence gaps, issue-to-action tracking, contradiction checks, and early identification of items that could affect transfer after signing.

The working rule is direct: accept nothing, believe no one, check everything. Agents accelerate the evidence work. Experienced operators validate the findings and own the judgment.

### 4. The Team

#### The deal

The deal governance committee makes the acquisition decision and records accepted enterprise risk. Dissent remains visible in the decision record.

The executive deal sponsor owns the deal thesis, timeline, and recommendation to the committee. The sponsor asks the regulatory team for its assessment and does not set that assessment.

#### Regulatory lead

The regulatory due-diligence lead sets regulatory scope and materiality, owns the rPTS position for Phase III assets, and signs the regulatory recommendation. The lead confirms asset stage, regions in scope, and the specialists required for each assessment.

#### Seven regulatory specialists

| Specialist | Accountability |
|---|---|
| Clinical regulatory documentation specialist | Conclusions on the clinical regulatory record and pathway |
| CMC regulatory specialist | CMC regulatory readiness conclusions |
| Regulatory intelligence specialist | Interpretation of agency history, guidance, and precedent |
| Medical device specialist, as needed | Device constituent, combination-product, and classification conclusions |
| Labeling specialist | Labeling claims and label-strategy conclusions |
| Regional / country specialist | Regional filing strategy and country-specific requirements |
| Commercial regulatory specialist | Post-approval, promotional, and lifecycle regulatory conclusions |

Specialist review is time-boxed and risk-tiered. The medical device specialist engages when a device is in scope. The regional / country specialist covers the regions included in the assessment. The commercial regulatory specialist supports marketed or near-launch assets, subject to a decision on the final activation rule.

#### Outside interfaces

The portfolio DD team owns deal coordination, data-room operations, the overall timeline, program management, and its coordinator agent. The regulatory data room manager agent routes requests through this team.

Other diligence workstreams own legal, safety and pharmacovigilance, quality, commercial, and finance diligence. They share findings when those findings overlap with the regulatory assessment.

The integration team owns post-signing transfer planning for regulatory applications, registrations, and commitments. The regulatory team provides the relevant handoff.

### 5. Regulatory Agents

#### Data Room Manager Agent

Maps the data room to the regulatory evidence pack, tracks coverage, and routes regulatory requests through the portfolio DD team.

Why an agent: Data rooms are large, uneven, and change during diligence. Continuous reconciliation is required to trace missing cross-references, maintain review coverage, and batch requests as new documents arrive.

Traits:

- Answers “did it pull everything?” with a coverage report
- Uses “not found in the data room” when evidence is missing
- Reconciles document counts like-for-like
- Turns missing cross-referenced documents into requests
- Batches and de-duplicates requests so the seller is not swamped
- Logs who reviewed each document

Answers to: Regulatory due-diligence lead  
Permission tier: Act

#### Clinical Regulatory Documentation Agent

Extracts and checks protocols, clinical study reports, investigator brochures, briefing documents, agency advice, and registry entries.

Why an agent: The clinical regulatory record spans document versions, registries, agency advice, and study records that must be checked together. The agent maintains cited fact tables and exposes gaps for specialist validation.

Traits:

- Applies phase-aware expectations
- Separates what the data show from sponsor claims
- Checks endpoints and design against agency advice
- Checks document versions and registry entries against the submission record
- Labels every inference as inference

Answers to: Clinical regulatory documentation specialist  
Permission tier: Recommend

#### CMC Regulatory Agent

Assesses CMC regulatory readiness for the next milestone across Module 3, specifications, stability, comparability, sites, and inspection history.

Why an agent: CMC readiness depends on patterns across technical records, commitments, deviations, and inspection evidence. The agent can maintain those links at scale while the specialist judges every red flag.

Traits:

- Treats missing CMC evidence as a risk
- Judges readiness against the next milestone
- Reads deviation and out-of-specification history over time
- Tracks open CMC commitments and CAPAs
- Treats written procedures as evidence of design rather than proof of practice

Answers to: CMC regulatory specialist  
Permission tier: Recommend

#### Regulatory Intelligence Agent

Builds the agency-interaction chronology and commitment ledger, retrieves dated guidance and precedent, and monitors approved sources during diligence.

Why an agent: Agency history changes with each correspondence, commitment, guidance version, and jurisdiction. The agent can keep the chronology current while the specialist decides what the agency meant and what applies.

Traits:

- Quotes agency language
- Tracks each commitment to closure or open status
- Date-, version-, and jurisdiction-stamps every source
- Flags superseded or draft guidance
- Alerts the team to new agency actions during the deal

Answers to: Regulatory intelligence specialist  
Permission tier: Observe

#### Medical Device Agent, Conditional

Checks device constituent, combination-product, and classification evidence when the assessment includes a device.

Why an agent: Device review is conditional and requires evidence to be connected across constituent, combination-product, and classification files. The agent activates when needed and routes classification questions to the specialist.

Traits:

- Remains dormant by default
- Maps each classification question to its evidence
- Turns missing device documentation into a request

Answers to: Medical device specialist  
Permission tier: Recommend

#### Labeling Agent

Maps current and proposed labeling claims to supporting evidence and agency positions.

Why an agent: Labeling review requires each claim to be traced across evidence, agency positions, and regional versions. The agent maintains that map while the specialist judges claim strength.

Traits:

- Maps every claim to its evidence
- Compares label versions across regions
- Flags claims without support
- Leaves label language unchanged

Answers to: Labeling specialist  
Permission tier: Recommend

#### Regional / Country Agent

Maps filing status, approvals, commitments, and country-specific requirements by region.

Why an agent: Regional diligence repeats the same status checks across jurisdictions while requirements and agency positions diverge. The agent keeps a dated comparison table current for specialist review.

Traits:

- Uses one row per region in scope
- Surfaces country-specific requirements and local commitments
- Flags different agency positions
- Date-stamps every status

Answers to: Regional / country specialist  
Permission tier: Recommend

#### Commercial Regulatory Agent

Reviews post-approval obligations, promotional history, and pending lifecycle changes for marketed or near-launch assets.

Why an agent: Post-approval obligations, promotional history, and lifecycle filings form a moving record. The agent can track status and exposure continuously while the specialist assesses regulatory risk.

Traits:

- Activates according to asset stage
- Tracks post-marketing commitments to closure
- Flags agency enforcement history on promotion
- Lists pending lifecycle changes and filing status

Answers to: Commercial regulatory specialist  
Permission tier: Recommend

#### Regulatory Risk Assessment Agent

Drafts the regulatory risk register and mitigations. For Phase III assets only, it drafts the rPTS drivers. It also runs the challenge pass.

Why an agent: Risk synthesis requires reconciliation across validated findings, contradictions, mitigations, and missing specialist views. A separate challenge context helps expose unsupported claims and inconsistencies before the lead sets the final position.

Traits:

- Produces rPTS drivers only for Phase III assets
- Gives earlier phases a qualitative risk view
- Uses ranges and drivers instead of a lone number
- Separates fact, inference, and recommendation
- Tests contradictions, unsupported claims, and missing specialist views
- Keeps patient and business context visible

Answers to: Regulatory due-diligence lead  
Permission tier: Recommend

### 6. Deliberately Not Agents

| Tool | Role | Reason |
|---|---|---|
| Intake and triage rules | Classify asset stage, modality, and question set; apply the deal-breaker screen; activate specialists and agents | Deterministic rules are predictable and auditable |
| Trap library and evidence-pack checklists | Hold specialist-authored red-flag traps and minimum evidence packs by stage | Specialists write the knowledge; agents apply it |
| Report template and traceability matrix | Assemble validated findings, evidence limits, and claim-to-source links | Templated assembly does not require agent discretion |
| Shared glossary | Define regulatory roles and terms used across organizations | Controlled vocabulary reduces errors caused by ambiguous language |

Safety and pharmacovigilance, legal, quality, commercial, finance, and integration remain human-led interfaces. The portfolio program manager and coordinator agent also remain outside the regulatory team.

### 7. Where Agents Work and Where People Decide

| Step | Agent lane | Human lane |
|---|---|---|
| Scope | Data room manager maps the data room to the regulatory evidence pack | Lead confirms asset stage, regions, and specialists |
| Evidence inventory | Data room manager scores coverage and raises requests through the portfolio DD team | Lead accepts coverage or escalates gaps |
| Clinical regulatory documentation | Agent extracts the record and checks alignment with agency advice | Specialist validates and rates materiality |
| CMC regulatory | Agent drafts gaps, open commitments, and inspection exposure | Specialist validates and rates materiality |
| Regulatory intelligence | Agent builds the chronology and retrieves dated precedent | Specialist judges agency meaning and applicability |
| Medical device and labeling | Agents map device evidence and labeling claims to support | Specialists judge classification and claim strength |
| Regional / country | Agent builds the region-by-region status table | Specialist judges regional filing strategy |
| Commercial regulatory | Agent lists obligations, promotional exposure, and pending changes | Specialist judges commercial regulatory risk |
| Risk assessment | Risk agent drafts the register, runs the challenge pass, and drafts Phase III rPTS drivers | Lead sets materiality and the Phase III rPTS position |
| Recommendation | The report template assembles the validated record | Lead signs; the deal sponsor and committee decide |

The following decisions are always human:

- Domain conclusions and materiality
- The rPTS position for Phase III assets
- The signed regulatory recommendation
- Regional filing strategy
- Judgment on labeling claim strength
- Resolution of specialist disagreement
- Acceptance of incomplete evidence
- Deal go/no-go and risk acceptance

### 8. How the Team Works Technically

The technical model has six tiers:

1. People: executive deal sponsor, regulatory DD lead, and seven regulatory specialists
2. Workspace: isolated deal workspace, review and sign-off queue, and regulatory issues list
3. Regulatory agents: the nine agents defined in this plan
4. Tools: document index and search, citation enforcer, evidence packs, trap lists, glossary, and report template
5. Data: read-only deal data, approved regulatory sources, and permitted internal regulatory history
6. Interfaces: portfolio DD team and its coordinator agent, other diligence workstreams, and the integration team

Each deal uses an isolated workspace. Cross-deal and cross-client memory is prohibited.

The team follows five guardrails:

- Cite or stay silent
- Read-only on deal data
- No cross-deal or cross-client memory
- Every action logged
- Human sign-off on every agent draft before it informs a conclusion

### 9. Decision Rights

R = responsible, A = accountable, C = consulted, I = informed, S = agent support.

| Activity | Deal committee | Deal sponsor | Reg DD lead | Reg specialists | Reg agents | Portfolio DD team |
|---|---:|---:|---:|---:|---:|---:|
| Set deal scope and timeline | C | A/R | C | I | I | R |
| Provide data-room access | I | I | C | I | S | A/R |
| Set regulatory scope: stage, regions, specialists | I | C | A/R | C | S | I |
| Gather and index regulatory evidence | I | I | A | C | S | C |
| Validate domain findings | I | I | A | R | S | I |
| Assess regulatory risks and mitigations | I | I | A/R | R | S | I |
| Set the rPTS position (Phase III assets) | I | C | A/R | C | S | I |
| Sign the regulatory recommendation | I | I | A/R | C | S | I |
| Decide go/no-go and accept risk | A | R | C | I | I | C |

### 10. The Team’s Capability

Capability-building should focus on the regulatory lead and specialists. They need to define stage-specific evidence packs, author trap lists, review cited outputs, distinguish evidence from inference, resolve disagreement, and recognize when an agent has exceeded its boundary.

Corrections, overrides, dissent, and missed traps should feed controlled updates to instructions, checklists, glossary terms, test cases, and training. Deal data and reviewer feedback should not produce automatic model learning.

**Workshop input** The broader program-manager bench remains an expected benefit. That goal belongs to the portfolio DD team. The regulatory team contributes through clear interfaces, usable evidence requests, and consistent handoffs.

### 11. Experiments and Measures

| Phase | Work | Evidence required to exit |
|---|---|---|
| 0: Set up | Name the lead and specialists, write regulatory evidence packs and trap lists, agree the data boundary with the portfolio DD team, build a known-trap test set, and capture the baseline | Accountable people, approved inputs, and a measurable starting point |
| 1: Retrospective replay | Run the regulatory agents on 2–3 closed diligence packages with known outcomes | Evidence coverage, citation accuracy, known-risk recall, and visible misses |
| 2: Shadow run | Run alongside the standard regulatory review on 1–2 live assessments; the standard review still decides | Operation inside a live deadline without steering the recommendation |
| 3: Assisted use | Use the hybrid team on live assessments with full specialist validation and lead sign-off | Measured effect on elapsed time and specialist effort |
| Gate: Scale decision | Regulatory leadership and the deal sponsor review the scorecard | Quality, adoption, and efficiency thresholds met |

Baselines and targets remain TBD for:

- Material-risk recall on known cases
- Claim-level citation accuracy
- Evidence coverage versus the minimum pack
- Elapsed time to signed assessment
- Specialist hours on search and assembly versus judgment
- Reviewer rework rate
- Lead and committee confidence
- Assessments completed per quarter

### 12. Response to Red-Team Objections

| Objection | Design response |
|---|---|
| The business case is unproven | Phase 0 captures baselines before a value claim is made |
| Agents may acquire decision authority | People retain domain conclusions, materiality, signature, risk acceptance, and go/no-go |
| Controls may slow the deadline | Triage sets review depth, agents work in parallel, and elapsed time is measured |
| Throughput may reward weak reviews | Quality leads the scale gate and throughput remains secondary |
| Validation may burden specialists | Review is risk-tiered, and the experiment separates search and assembly effort from judgment |
| Ownership may blur | The RACI assigns accountability to the deal sponsor, regulatory lead, specialists, committee, and portfolio DD team |
| Multiple agents may add complexity | Each agent has one bounded job, a human counterpart, and a permission tier |
| Confidential information may escape | Isolated workspaces, read-only access, prohibited cross-deal memory, and action logs restrict use |
| Findings may be unsupported or stale | Claim-level citations, dated sources, explicit versions, and specialist validation apply |
| Specialists may disagree | Competing interpretations remain visible until the lead resolves or escalates them |
| The challenge pass may lose independence | The risk agent runs it in a separate context and identifies contradictions, unsupported claims, and missing specialist views |
| Transfer issues may surface too late | The regulatory assessment identifies transfer-gating items for the integration team’s plan |

### 13. Decisions Needed

Each row below is a **Decision needed**.

| Decision | Options | Who decides | By when |
|---|---|---|---|
| Specialist roster by asset stage | Which of the seven specialists engage by default | Regulatory DD lead | TBD |
| Regions in scope by default |  | Regulatory DD lead with the regional specialist | TBD |
| When commercial regulatory engages | Marketed assets only, or near-launch too | Regulatory DD lead | TBD |
| rPTS method for Phase III assets |  | Regulatory DD lead with regulatory intelligence | TBD |
| Experiment cases | 2–3 closed packages, 1–2 live assessments | Regulatory DD lead with the deal sponsor | TBD |
| Data boundary and request route |  | Regulatory DD lead with the portfolio DD team | TBD |
| Funding and priority | Fund, revise or stop | Executive deal sponsor | TBD |
| Scale decision | Scale, extend, redesign or stop | Regulatory leadership | TBD |

### 14. Evidence Limits and Open Questions

The current evidence has limits:

- Workshop input consists of participant perceptions and scenarios rather than measured performance
- Current cycle time, rework, specialist effort, evidence coverage, and material-risk recall lack agreed baselines
- The frequency, severity, and cost of missed regulatory risks are unestablished
- The nine-agent design has not been validated on retrospective or live assessments
- No formal severity scale, labeling checklist, or regulatory-intelligence procedure exists in the source practice
- Specialist-approved methods are still required in those areas
- Rules for recommendations under incomplete evidence remain undecided
- Experiment ownership, approved data boundaries, funding, and acceptance thresholds remain open
- The first asset stages, modalities, regions, and question sets remain undecided

One architecture choice still requires confirmation: the separate challenger was removed and its challenge pass moved into the regulatory risk assessment agent, while the data room manager agent was retained and limited to regulatory evidence. Both choices await Kofi’s confirmation.