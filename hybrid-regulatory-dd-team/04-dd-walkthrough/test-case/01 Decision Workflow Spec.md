> FICTIONAL - for demonstration. All companies, products, people and data are invented.

# 01 Decision Workflow Spec: Ostravane / OST-4417 Mock Regulatory DD

Scenario date: 2026-10-08. Acquirer (fictional): Tarnwell Pharma. Target (fictional): Ostravane Therapeutics. Question: continue to valuation or not.

Team design source: `arch_spec3.json` (Hybrid Regulatory DD Team Plan v3). Agent outputs below are written as the viewer would see them. Facilitator cues (PI-xx) refer to the answer key in `02 Challenges and Planted Issues.md`; do not show them to the audience.

## Stage map

| # | Stage | Agents | Human reviewer | Gate |
|---|---|---|---|---|
| 0 | Deal intake and triage | Data room manager agent | Regulatory due-diligence lead | G1 |
| 1 | Therapeutic area research | Regulatory intelligence agent; Clinical regulatory documentation agent | Regulatory intelligence specialist |  |
| 2 | Asset profile | Clinical regulatory documentation agent; Regulatory intelligence agent; CMC regulatory agent; Labeling agent; Data room manager agent | Regulatory due-diligence lead | G2 |
| 3 | Specialist deep dive: clinical regulatory documentation | Clinical regulatory documentation agent | Clinical regulatory documentation specialist |  |
| 4 | Specialist deep dive: CMC regulatory | CMC regulatory agent | CMC regulatory specialist |  |
| 5 | Specialist deep dive: medical device and companion diagnostic | Medical device agent (conditional) | Medical device specialist (as needed) |  |
| 6 | Specialist deep dive: labeling | Labeling agent | Labeling specialist |  |
| 7 | Specialist deep dive: regional and country requirements | Regional / country agent | Regional / country specialist |  |
| 8 | Specialist deep dive: commercial regulatory | Commercial regulatory agent; Regulatory intelligence agent | Commercial regulatory specialist | G3 |
| 9 | Risk register and rPTS drivers (draft) | Regulatory risk assessment agent | Regulatory due-diligence lead |  |
| 10 | Challenge pass and the lead's rPTS position | Regulatory risk assessment agent | Regulatory due-diligence lead | G4 |
| 11 | Recommendation and the decision to continue to valuation | None (template) | Regulatory due-diligence lead | G5 |

Gate options: Proceed, Pause, Seek more information (and Stop where sensible). Terminal states: END_VALUATION = Continue to valuation with regulatory conditions; END_PAUSED = Process paused; END_REQUEST = Information requests outstanding; step to be re-run on receipt; END_STOP = Regulatory workstream recommends stopping.

---

## Stage 0: Deal intake and triage (`intake`)

**What is happening.** The seller opened the data room on 2026-10-05. The data room manager agent maps what arrived to the minimum regulatory evidence pack and the triage rules set the scope.

**Agents:** Data room manager agent. **Tools:** Intake and triage rules. **Human reviewer:** Regulatory due-diligence lead.

### Agent output: Evidence inventory and coverage report (Data room manager agent)

> **Data room: Ostravane Therapeutics (access 2026-10-05).** Index lists 23 documents. 15 were provided; 8 were *not found in the data room*.
>
> Coverage against the Phase III oncology minimum evidence pack (28 required items):
>
> | Status | Items | Share |
> |---|---|---|
> | Full document provided | 11 | 39% |
> | Summary only (underlying document not provided) | 9 | 32% |
> | Not found in the data room | 8 | 29% |
>
> Count reconciliation (like-for-like): the seller cover note says "15 documents"; the index shows 15 provided plus 8 listed as not provided. These are consistent.
>
> Summary-only items: CMC (no Module 3), study 101 CSR (synopsis only), meeting minutes (excerpts only), draft label (US only), CDx (summary only), correspondence log (company-maintained), safety, patents, investor deck.
>
> Not found: DR-16 FDA written response (Type C, 2025-03-20); DR-17 EMA PIP decision or waiver; DR-18 CDx bridging report; DR-19 DS comparability report; DR-20 study 101 full CSR; DR-21 OPDP untitled letter; DR-22 Form 483 and response; DR-23 CDRH Pre-Sub feedback. Sources: DR-00.

### Agent output: Triage card (deterministic rules) (Data room manager agent)

> | Field | Value |
> |---|---|
> | Asset stage | Phase III (rPTS driver analysis applies) |
> | Modality | Oral small molecule with in vitro companion diagnostic |
> | Pathway question set | Accelerated approval on Phase 2 data with Phase III as confirmatory; biomarker-selected; orphan |
> | Deal-breaker screen | No clinical hold on record; no known REMS prohibition; no debarment flag. No deal-breaker triggered |
> | Regions in scope | US, EU; Japan (company guidance 2028) |
> | Specialists activated | Clinical regulatory documentation, CMC, regulatory intelligence, labeling, regional / country, commercial regulatory (near launch: filing within 12 months), medical device (CDx involved) |
> | Agents activated | All nine, including the conditional medical device agent and the commercial regulatory agent |
>
> Lead confirmation required before research starts.

**Risks noted:** R-13 Evidence limits: eight requested documents not provided

**Facilitator cue (hide from audience):** PI-02

### Decision gate G1: Confirm the scope and activate the team as triaged?

**Decider:** Regulatory due-diligence lead. **Recommended:** Proceed.

| Option | Consequence | Next |
|---|---|---|
| Proceed | Research starts with US and EU scope and all nine agents active. | ta-research |
| Pause | Regulatory work waits for the deal sponsor to confirm timing and bid exclusivity (to 2026-11-20). | END_PAUSED |
| Seek more information | Ask the seller to confirm regions and Japan intentions; proceed with US and EU scope provisionally. | ta-research |

**Evidence that would change the call:** A deal-breaker found in the seller's disclosures (for example a clinical hold) would move this to Stop. A change in regions in scope would change which specialists engage.

---

## Stage 1: Therapeutic area research (`ta-research`)

**What is happening.** Research is being done on the cholangiocarcinoma landscape: standard of care, competitor programs and regulatory precedent in the setting. Retrieval only; the specialist judges what applies.

**Agents:** Regulatory intelligence agent; Clinical regulatory documentation agent. **Tools:** none. **Human reviewer:** Regulatory intelligence specialist.

### Agent output: Landscape and standard of care (retrieval, date-stamped 2026-10-08) (Regulatory intelligence agent)

> **Previously treated intrahepatic cholangiocarcinoma, US and EU.**
> - Standard of care after first-line therapy: second-line cytotoxic chemotherapy for patients without an actionable alteration; targeted therapies exist for other molecular subsets. No TRX-7-directed therapy is approved (company statement, DR-03; external source check to be confirmed by the specialist).
> - Study 301's comparator (investigator's choice chemotherapy) is consistent with this standard of care.
>
> **Competitor programs (DR-11).** NVB-210 (Phase III, accelerated filing planned 2027) could become *available therapy* before OST-4417 is reviewed. MRT-302 (Phase II) shares a related biomarker, so CDx considerations may overlap. CLD-88 is not biomarker selected.
>
> **Approved external sources used (versions stamped):** FDA guidance, Expedited Programs for Serious Conditions (2014); FDA draft guidance, Clinical Trial Considerations to Support Accelerated Approval of Oncology Therapeutics (2023, draft: *not final*); FDORA 2022 provisions that a confirmatory trial be underway; EMA conditional marketing authorization framework. All flagged for specialist verification of current status.

### Agent output: Regulatory precedent set (FICTIONAL stand-in for retrieved precedent) (Regulatory intelligence agent)

> | Precedent | Setting | Basis | Confirmatory status at approval | Relevance |
> |---|---|---|---|---|
> | P1 (fictional) | Biomarker-selected oral agent, rare GI cancer, US | Accelerated approval on confirmed ORR and DoR | Randomized trial underway | High: same structure as OST-4417 request |
> | P2 (fictional) | Biomarker-selected agent, rare GI cancer, EU | Conditional MA | Specific obligations set | Medium: EMA wanted OS maturity plan |
> | P3 (fictional) | Response-based accelerated request, US | Not granted; FDA asked for randomized evidence | n/a | High as a counterexample |
>
> Applicability of each precedent is for the regulatory intelligence specialist to judge. The agent only retrieves.

### Agent output: Endpoint conventions in the setting (Clinical regulatory documentation agent)

> Randomized trials in previously treated biliary cancers commonly use OS or PFS; agency preference depends on the biomarker-defined population and availability of effective salvage therapy. For this asset, the relevant agency positions are in DR-06 and are addressed in the asset profile stage.

**Risks noted:** R-02 Accelerated approval not agreed in advance; available therapy may change before filing

---

## Stage 2: Asset profile (`asset-profile`)

**What is happening.** What came back about OST-4417: mechanism, pivotal design, endpoints, data to date, regulatory history, CMC status and the label target. The first contradictions appear.

**Agents:** Clinical regulatory documentation agent; Regulatory intelligence agent; CMC regulatory agent; Labeling agent; Data room manager agent. **Tools:** none. **Human reviewer:** Regulatory due-diligence lead.

### Agent output: Cited asset fact table (Clinical regulatory documentation agent)

> | Element | Fact | Source |
> |---|---|---|
> | Mechanism | Oral TRX-7 cofactor inhibitor, 150 mg QD | DR-03 |
> | Indication target | TRX-7-high (IHC H-score 150 or higher) previously treated intrahepatic cholangiocarcinoma | DR-03 |
> | Pivotal study | OST-4417-301, randomized 1:1 vs investigator's choice chemotherapy, N=420 planned, 388 enrolled (2026-09-15) | DR-04 |
> | Primary endpoint | PFS by BICR per protocol v4.0 (2025-02-24); OS primary in v3.0 (2024-06-10) | DR-04 |
> | Data to date | Cohort B (N=68, cutoff 2026-03-31): confirmed ORR 40% (27/68) by BICR, median DoR 8.4 mo, median PFS 5.9 mo | DR-04, DR-15 |
> | Designations | Orphan (US, EU), Fast Track; Breakthrough denied 2025-11-03 | DR-07, DR-06 C |
> | CMC | DS route B; sole DS site Halvern; DP Corvane; 18-month DP stability | DR-08, DR-09 |
> | Label target | Biomarker-selected, accelerated approval then full | DR-03, DR-10 |
> | Planned filings | NDA H1 2027, MAA H2 2027, Japan 2028 (company guidance) | DR-02 |
>
> Inference (labeled): the Phase III interim PFS analysis (Q2 2027) comes after the planned NDA submission (H1 2027), so the confirmatory trial will be underway but not read out at filing.

### Agent output: Advice-alignment check: pivotal endpoint (FLAG) (Clinical regulatory documentation agent)

> **Conflict found between the company's statement and the agency record.**
>
> | Source | Statement |
> |---|---|
> | DR-02 slide 8 | "FDA aligned on PFS as primary endpoint for the Phase III" |
> | DR-06 Excerpt A, Q1 (FDA, 2024-03-14) | "FDA recommends overall survival as the primary endpoint. PFS may be a key secondary... this should not be interpreted as agreement." |
> | DR-06 Excerpt B (EMA, 2024-09-19) | "OS is the preferred primary endpoint. A PFS primary endpoint requires justification and a plan for OS maturity." |
> | DR-04 | Protocol v3.0 OS primary (2024-06); v4.0 PFS primary (2025-02) |
> | DR-05 entries 11 to 13 | Type C request 2025-02-11; FDA written response received 2025-03-20; log says only "feedback received" |
>
> The response that would show whether FDA accepted the v4.0 change (DR-16) is *not found in the data room*. Not resolved by this agent. Referred to the clinical regulatory documentation specialist.

### Agent output: Data version check: efficacy and IB (FLAG) (Clinical regulatory documentation agent)

> | Item | Version A (DR-02, deck) | Version B (DR-04, DR-15) |
> |---|---|---|
> | Cutoff | 2025-09-30 | 2026-03-31 |
> | Evaluable patients | 61 | 68 |
> | ORR | 46% (28/61), investigator, includes unconfirmed | 40% (27/68), BICR, confirmed |
> | Median DoR | 9.8 months | 8.4 months |
>
> Version B is later and BICR-confirmed; the deck uses an earlier, less conservative basis. Also: protocol v4.0 and the 2026 DSURs cite IB v5.0; IB v6.0 (2026-04) is current. Alignment is not documented in the data room.

### Agent output: Agency chronology and commitment ledger (Regulatory intelligence agent)

> | Commitment or event | Source | Status |
> |---|---|---|
> | DS route change comparability before pivotal use | DR-06 A Q6 | Open: comparability report *not found* (DR-19) |
> | Confirmatory trial underway at accelerated approval submission | DR-06 A Q3 | On track (301 enrolling); depends on filing date |
> | DILI monitoring and stopping rules | DR-06 A Q5 | Plan referenced; not provided |
> | CDx pre-submission and contemporaneous approval | DR-06 A Q4 | Pre-Sub held 2024-11-20; feedback not found (DR-23) |
> | EMA PIP agreement or waiver before MAA validation | DR-06 B | Open: *no PIP application as of 2024-09; no later record found* |
> | FDA response to protocol v4.0 request | DR-05 #13 | Open: content not found (DR-16) |
> | OPDP untitled letter response | DR-05 #16 | Content not found (DR-21) |
>
> Quoted agency language is verbatim from DR-06. New agency actions will be watched during the deal.

### Agent output: CMC status snapshot (CMC regulatory agent)

> - DS: sole site Halvern (Cork). FDA Form 483 dated 2026-06-24 with five observations; response submitted 2026-07-10; classification pending (DR-09). The investor deck says "clean inspection history" (DR-02 slide 12): inconsistent with DR-09.
> - DP: Corvane NAI (2025-03). Packaging: customer audit only.
> - Stability: DP 18 months (proposed 24-month shelf life by ICH Q1E extrapolation); DS 12 months.
> - No Module 3 provided; summary only. Treated as a risk, not as neutral.
> Referred to the CMC specialist as a red flag.

### Agent output: TPP and label target snapshot (Labeling agent)

> Draft label v0.3 (US only) carries seven claims (L1 to L7). Detailed claim-to-evidence mapping runs in the labeling deep dive. No EU or Japan label drafts provided.

### Agent output: Request batch (de-duplicated) (Data room manager agent)

> Eight items *not found in the data room* turned into six requests through the portfolio DD team:
>
> | Request | Documents | Why it matters |
> |---|---|---|
> | RQ-1 | DR-16 FDA Type C written response, 2025-03-20 | Resolves the primary endpoint contradiction |
> | RQ-2 | DR-22 Form 483 and company response (with DR-19 comparability report) | CMC inspection exposure and FDA comparability request |
> | RQ-3 | DR-18 CDx bridging report and DR-23 CDRH Pre-Sub feedback | CDx readiness |
> | RQ-4 | DR-17 EMA PIP decision, waiver or application status | MAA validation |
> | RQ-5 | DR-21 OPDP letter and response | Promotional history |
> | RQ-6 | DR-20 Study 101 full CSR and BICR charter | Verify cohort B figures; Hy's law case narrative |
>
> Batched to avoid swamping the seller. Review log: all 15 provided documents logged with reviewer and time.

**Risks noted:** R-01 Primary endpoint not aligned with FDA and EMA advice (PFS vs OS); R-03 Sole drug substance site with open Form 483 and pending classification; R-11 Company materials diverge from regulatory record (credibility of seller statements); R-13 Evidence limits: eight requested documents not provided

**Facilitator cue (hide from audience):** PI-01, PI-02, PI-03, PI-07

### Decision gate G2: Is the evidence sufficient to proceed to specialist deep dives?

**Decider:** Regulatory due-diligence lead. **Recommended:** Seek more information.

| Option | Consequence | Next |
|---|---|---|
| Proceed | Deep dives start; gaps carried as provisional in every finding. | dd-clinical |
| Pause | Stop all specialist work until the six requests are answered. Costs time against bid exclusivity (2026-11-20). | END_PAUSED |
| Seek more information | Issue the six requests now and start deep dives in parallel on available evidence; every dependent finding is marked provisional. | dd-clinical |

**Evidence that would change the call:** Receipt of DR-16 showing FDA accepted PFS as primary would change the endpoint risk. A 483 classified Official Action Indicated would raise the CMC risk. Seller refusing RQ-1 would move toward Pause.

---

## Stage 3: Specialist deep dive: clinical regulatory documentation (`dd-clinical`)

**What is happening.** The clinical regulatory documentation agent drafts its finding. Watch the first draft: a human catches an overstatement before it travels downstream.

**Agents:** Clinical regulatory documentation agent. **Tools:** none. **Human reviewer:** Clinical regulatory documentation specialist.

### Agent output: Pathway finding (draft v1, as first produced) (Clinical regulatory documentation agent)

> **Accelerated approval.** FDA agreed in the 2024 Type B meeting that ORR and DoR from cohort B can support accelerated approval, and the company is on track to file in H1 2027 with Phase III as the confirmatory study. The pathway is therefore low risk. (Source: DR-02 slide 8; DR-06 Excerpt A Q3)

**Human review:** FLAGGED BY SPECIALIST. Overstated. DR-06 Excerpt A Q3 reads: 'The Agency cannot agree in advance that ORR and DoR will support accelerated approval.' The claim also leans on the deck (DR-02), which is not an agency record. 'Low risk' is a materiality call reserved for the lead.

### Agent output: Pathway finding (corrected, specialist-validated) (Clinical regulatory documentation agent)

> **Accelerated approval.** FDA *declined to agree in advance* that ORR and DoR from cohort B would support accelerated approval (DR-06 A Q3). The review will depend on response magnitude and durability and on available therapy at submission. A randomized confirmatory trial must be underway (301 is enrolling). BICR-confirmed ORR is 40% with median DoR 8.4 months (DR-04); the deck's 46% and 9.8 months are not the basis to use. Risk: NVB-210 may become available therapy first (DR-11).
> Inference, labeled: PFS-primary may be accepted for confirmation only if DR-16 shows FDA acceptance; not found in the data room.

**Human review:** Corrected by the clinical regulatory documentation specialist. Time-boxed, risk-tiered review: 22 minutes.

### Agent output: Endpoint, safety and registry findings (Clinical regulatory documentation agent)

> - **Endpoint:** see asset-profile flag. Both OS-primary and PFS-primary scenarios carried into the risk drivers.
> - **Hepatic safety:** DR-12 states "No cases meeting Hy's law criteria"; the IND safety report of 2026-04-22 (same document) reports a *potential Hy's law case* in cohort B (ALT above 3x ULN, bilirubin above 2x ULN, no alternative cause identified at the time). Both statements shown side by side; adjudication is for the safety workstream. FDA said it will evaluate REMS at review (DR-06 A Q5).
> - **Document versions:** protocol v4.0 and DSURs cite IB v5.0; IB v6.0 is current. Registry entry for study 301 not provided; not checked.

**Risks noted:** R-01 Primary endpoint not aligned with FDA and EMA advice (PFS vs OS); R-02 Accelerated approval not agreed in advance; available therapy may change before filing; R-06 Hepatic safety: potential Hy's law case reported while company states none; REMS possible; R-11 Company materials diverge from regulatory record (credibility of seller statements)

**Facilitator cue (hide from audience):** PI-01, PI-06, PI-07, PI-10

---

## Stage 4: Specialist deep dive: CMC regulatory (`dd-cmc`)

**What is happening.** The CMC agent assesses readiness against the next milestone (NDA H1 2027) and treats missing evidence as risk. Every CMC red flag goes to the specialist.

**Agents:** CMC regulatory agent. **Tools:** none. **Human reviewer:** CMC regulatory specialist.

### Agent output: CMC readiness against NDA H1 2027 (CMC regulatory agent)

> | Area | Finding | Source | Flag |
> |---|---|---|---|
> | Sole DS site inspection | Form 483, five observations: HPLC audit trail not reviewed pre-release; OOS investigation closed without root cause; shared analyst logins; cleaning validation gap; change control for a route B raw material supplier | DR-09 S1 | RED |
> | Company statement | "Clean inspection history" is inconsistent with the above | DR-02 slide 12 | RED |
> | Response status | Response submitted 2026-07-10; FDA classification pending; response document not provided | DR-05 #19, DR-00 | Request RQ-2 |
> | DS route change | FDA asked for comparability before pivotal use of route B; report not found | DR-06 A Q6, DR-08 | RED |
> | PPQ | Commercial scale (100 kg) PPQ planned Q1 2027; not started. Tight against H1 2027 filing | DR-08 | AMBER |
> | Stability | DP 18 months for 24-month claim by extrapolation; DS 12 months for 24-month retest | DR-08 | AMBER |
> | Specifications | Two route B impurity limits provisional, not qualified against exposure | DR-08 | AMBER |
> | Second DS site | None | DR-08 | AMBER (single-source) |
>
> Open commitments: comparability report; 483 response closure. The agent notes procedures as written, not as proof of practice; observation themes are data integrity related, which can recur across systems.

**Human review:** CMC specialist reviews all three RED flags before anything goes to the risk agent.

### Agent output: Specialist validation note (for the record) (CMC regulatory agent)

> Specialist view to be entered live. Suggested for scripting: the data-integrity themes in the 483 matter more than the count; classification pending is the key unknown; a pre-approval inspection of the sole DS site is likely. Materiality is rated by the lead, not here.

**Risks noted:** R-03 Sole drug substance site with open Form 483 and pending classification; R-05 DS route A to B comparability not evidenced; R-12 Stability extrapolation and provisional impurity specifications

**Facilitator cue (hide from audience):** PI-03

---

## Stage 5: Specialist deep dive: medical device and companion diagnostic (`dd-device`)

**What is happening.** The conditional device agent wakes up because the asset needs a companion diagnostic. It maps each CDx question to evidence and raises requests where evidence is missing.

**Agents:** Medical device agent (conditional). **Tools:** none. **Human reviewer:** Medical device specialist (as needed).

### Agent output: CDx evidence map (Medical device agent (conditional))

> | Question | Evidence | Status |
> |---|---|---|
> | Is a contemporaneously approved CDx expected? | FDA: yes (DR-06 A Q4) | Confirmed |
> | Is the trial assay the final assay? | Trial: CTA v2. Market: kit v3 with new antibody lot and automated stainer platform | NO; bridging needed |
> | Bridging study done? | "Planned; protocol drafted"; report not found (DR-18) | Missing |
> | PMA status? | "On track" (DR-02), no module status provided; Pre-Sub feedback not found (DR-23) | Unverified |
> | Kit manufacturing site named? | Not yet named (DR-09 S4) | Gap |
> | EU IVDR conformity assessment? | Not started | Gap |
> | Japan IVD plan? | None | Gap |
> | Partner dependency | Lumenar may terminate on change of control with 90 days' notice (DR-14) | Flag to legal workstream |
>
> The agent classifies none of this; classification and PMA risk are for the specialist. Requests RQ-3 raised.

**Human review:** Medical device specialist judges PMA risk. Change-of-control termination is referred to the legal workstream (outside the regulatory team).

**Risks noted:** R-04 CDx: trial assay differs from market kit, no bridging report, PMA status unverified, change-of-control termination right

**Facilitator cue (hide from audience):** PI-04

---

## Stage 6: Specialist deep dive: labeling (`dd-labeling`)

**What is happening.** The labeling agent maps every draft claim to its evidence. It flags unsupported claims; it never rewrites label language.

**Agents:** Labeling agent. **Tools:** none. **Human reviewer:** Labeling specialist.

### Agent output: Claim-to-evidence map (draft label v0.3) (Labeling agent)

> | Claim | Evidence | Assessment |
> |---|---|---|
> | L1 Cholangiocarcinoma, intrahepatic and extrahepatic | Cohort B enrolled intrahepatic only | AT RISK: scope exceeds evidence |
> | L2 "Improves overall survival" | No Phase III OS data; cohort B OS immature | UNSUPPORTED |
> | L3 "Median DoR 9.8 months" | Deck value; BICR-confirmed is 8.4 months | CONFLICTS with DR-04 |
> | L4 "No Hy's law cases observed" | IND safety report 2026-04-22 reports a potential case | CONFLICTS with DR-12 |
> | L5 "First-in-class" | Not a label element | Out of scope |
> | L6 "No routine hepatic monitoring required" | Study monitoring plan: liver tests every 2 weeks for 12 weeks | CONFLICTS with study 101 plan |
> | L7 Accelerated approval statement and confirmatory trial | Not agreed in advance by FDA | CONDITIONAL |
>
> Region comparison: no EU SmPC or Japan label draft provided; only US-style draft. No claim rewritten by the agent.

**Human review:** Labeling specialist owns any judgment on claim strength.

**Risks noted:** R-09 Draft label claims not supported by evidence (OS claim, DoR value, hepatic monitoring, tumor scope)

**Facilitator cue (hide from audience):** PI-08

---

## Stage 7: Specialist deep dive: regional and country requirements (`dd-regional`)

**What is happening.** The regional agent builds one row per region in scope and surfaces country-specific requirements the plan may have missed.

**Agents:** Regional / country agent. **Tools:** none. **Human reviewer:** Regional / country specialist.

### Agent output: Region-by-region status (dated 2026-10-08) (Regional / country agent)

> | Region | Status | Requirement or commitment | Gap |
> |---|---|---|---|
> | US | IND active; Orphan, Fast Track; NDA planned H1 2027 | Confirmatory trial underway; CDx PMA contemporaneous | See clinical and CDx findings |
> | EU | CTAs active in 6 states; orphan designation (maintenance report due 2026-11); MAA planned H2 2027 | PIP agreement or waiver required before MAA validation (DR-06 B). *No PIP application as of 2024-09; no later record found* | PIP missing (DR-17 requested) |
> | Japan | No PMDA consultation; no Japanese data; no sites in study 301; no local IVD plan | Deck says filing 2028 (DR-02) | No pathway documented |
> | South Korea | CT approval for study 301 (2025-01) | None identified | Out of filing scope |
>
> Divergent agency positions: FDA and EMA both prefer OS primary; sponsor changed to PFS primary (DR-04). Local commitments: EU orphan maintenance report due 2026-11.

**Human review:** Regional specialist judges filing strategy: PIP or waiver is procedural but gates MAA validation; Japan is a timing and value question.

**Risks noted:** R-07 No EU Paediatric Investigation Plan or waiver on file; R-08 No Japan plan: no PMDA consultation, no Japanese data, no local IVD plan

**Facilitator cue (hide from audience):** PI-05

---

## Stage 8: Specialist deep dive: commercial regulatory (`dd-commercial`)

**What is happening.** OST-4417 is not marketed, but it is near launch, so the commercial regulatory agent runs. It reviews promotional history and pending obligations.

**Agents:** Commercial regulatory agent; Regulatory intelligence agent. **Tools:** none. **Human reviewer:** Commercial regulatory specialist.

### Agent output: Promotional exposure and obligations (Commercial regulatory agent)

> - **Promotional history:** FDA OPDP untitled letter dated 2026-03-09 concerning website and investor materials presenting an investigational drug as safe and effective and implying breakthrough status (DR-05 #16). The letter and the company's response are *not found in the data room* (DR-21, RQ-5).
> - **Deck language:** "Breakthrough-level activity" (DR-02 slide 3) after FDA denied the Breakthrough request on 2025-11-03 (DR-06 C). Consistent with the pattern in the untitled letter.
> - **Post-approval obligations (anticipated):** accelerated approval confirmatory commitments; CDx post-market; possible REMS (DR-06 A Q5).
> - **Pending lifecycle changes:** none yet; none can exist before approval.

**Human review:** Commercial regulatory specialist: promotional posture matters for integration; low impact on approval probability.

### Agent output: Watch notice (Regulatory intelligence agent)

> Continuous monitoring is on. No new agency actions found since 2026-10-05.

**Risks noted:** R-10 OPDP untitled letter and promotional posture of the company

**Facilitator cue (hide from audience):** PI-09

### Decision gate G3: Accept the validated specialist findings and move to the risk register?

**Decider:** Regulatory due-diligence lead. **Recommended:** Proceed.

| Option | Consequence | Next |
|---|---|---|
| Proceed | Validated findings go to the risk assessment agent. Findings marked provisional keep wide ranges. | risk-draft |
| Pause | Hold until the six requests are answered; risk drafting waits. | END_PAUSED |
| Seek more information | Proceed to risk drafting but widen ranges on items awaiting RQ-1 to RQ-6. | risk-draft |
| Stop | Recommend the deal team stops on regulatory grounds. No stop condition is met on current evidence. | END_STOP |

**Evidence that would change the call:** A specialist finding that is itself a deal-breaker (for example OAI classification of the sole DS site with no alternative) would move this to Stop.

---

## Stage 9: Risk register and rPTS drivers (draft) (`risk-draft`)

**What is happening.** The risk assessment agent drafts the register and, because OST-4417 is Phase III, the rPTS drivers. It gives ranges and drivers, never a lone number, and never a go or no-go.

**Agents:** Regulatory risk assessment agent. **Tools:** none. **Human reviewer:** Regulatory due-diligence lead.

### Agent output: Draft regulatory risk register (Regulatory risk assessment agent)

> | ID | Risk | Severity (draft) | Mitigation |
> |---|---|---|---|
> | R-01 | Primary endpoint not aligned with FDA and EMA advice | High | Obtain DR-16; model OS-primary scenario |
> | R-02 | Accelerated approval not agreed in advance; available therapy may change | High | Track NVB-210 and MRT-302 |
> | R-03 | Sole DS site with open Form 483 | High | Obtain DR-22; second-site plan |
> | R-04 | CDx not bridged; PMA unverified; partner termination right | High | Obtain DR-18, DR-23; refer clause to legal |
> | R-05 | Route A to B comparability not evidenced | Medium-High | Obtain DR-19 |
> | R-06 | Hepatic safety, potential Hy's law case, REMS | Medium-High | Safety workstream adjudication |
> | R-07 | No EU PIP or waiver on file | Medium | Confirm status; procedural |
> | R-08 | No Japan plan | Low-Medium | Value separately |
> | R-09 | Draft label claims unsupported | Medium | Rebuild claim set |
> | R-10 | OPDP untitled letter | Medium-Low | Obtain DR-21 |
> | R-11 | Company materials diverge from record | Medium | Rely on agency documents |
> | R-12 | Stability and impurity specifications | Medium | Request data plan |
> | R-13 | Eight documents not provided | Medium | Batched requests |
>
> Fact, inference and recommendation are separated in the full register; severity is a draft for the lead.

### Agent output: Draft rPTS driver table (Phase III only) (Regulatory risk assessment agent)

> Scenario baseline 80% (illustrative assumption, not real-world data). Adjustments in percentage points; ranges, not points.
>
> | Driver | Draft range (pp) | Rationale |
> |---|---|---|
> | D1 Primary endpoint alignment | -9 to -4 | FDA recommended OS; draft credits the company statement of PFS alignment |
> | D2 Effect size and data maturity | -3 to +1 | BICR ORR 40%, DoR 8.4 mo, PFS 5.9 mo; OS immature |
> | D3 CMC readiness and inspection exposure | -7 to -3 | Sole DS site with 483; comparability and PPQ open |
> | D4 CDx readiness | -6 to -3 | No bridging report; PMA unverified |
> | D5 Hepatic safety and risk management | -2 to 0 | REMS possible |
> | D6 Accelerated approval pathway and precedent | +1 to +3 | Precedent P1; FDA support for pathway (as stated in the draft) |
> | D7 Regional procedural | -1 to 0 | PIP, Japan |
> | D8 Designations and unmet need | 0 to +2 | Orphan, Fast Track; BTD denied |
> | **Draft rPTS range** | **53% to 76%** | Computed from baseline plus drivers |
>
> The agent outputs no go or no-go and does not set the rPTS position.

**Risks noted:** full register R-01 to R-13 (see output above).

---

## Stage 10: Challenge pass and the lead's rPTS position (`challenge-pass`)

**What is happening.** A separate-context challenge pass attacks the draft: contradictions, unsupported claims, missing specialist views. Then the lead sets the rPTS position. The machine's range is an input, not a rationale.

**Agents:** Regulatory risk assessment agent. **Tools:** none. **Human reviewer:** Regulatory due-diligence lead.

### Agent output: Challenge pass (separate context): findings (Regulatory risk assessment agent)

> | # | Challenge | Evidence | Effect |
> |---|---|---|---|
> | C1 | D1 relies on the company statement of FDA alignment; agency record says otherwise and DR-16 is missing | DR-06 A Q1, B; DR-02 slide 8 | D1 widened and lowered to -12 to -6 |
> | C2 | D6 credits FDA support for accelerated approval; FDA declined to agree in advance | DR-06 A Q3 | D6 reduced to -1 to +2 |
> | C3 | Hepatic discrepancy was not reflected in D5 | DR-12 vs IND safety report | D5 to -3 to -1; safety workstream view requested |
> | C4 | Missing specialist view: safety and PV is outside the regulatory team | Other workstreams | Flagged as a missing view; not substituted |
> | C5 | Check for double counting: comparability sits in D3 only; CDx contract risk excluded from D4 | R-04, R-05 | No change |
> | C6 | Labeling claim conflicts feed no driver; they are a remediation item | R-09 | No change |
>
> Contradictions with unresolved sources: 3 (endpoint, inspection claim, hepatic statement). Unsupported claims found in earlier outputs: 1 (draft pathway finding, already corrected by the specialist).

### Agent output: Challenged rPTS range (Regulatory risk assessment agent)

> | Driver | Draft (pp) | Challenged (pp) |
> |---|---|---|
> | D1 | -9 to -4 | -12 to -6 |
> | D2 | -3 to +1 | -3 to +1 |
> | D3 | -7 to -3 | -7 to -3 |
> | D4 | -6 to -3 | -6 to -3 |
> | D5 | -2 to 0 | -3 to -1 |
> | D6 | +1 to +3 | -1 to +2 |
> | D7 | -1 to 0 | -1 to 0 |
> | D8 | 0 to +2 | 0 to +2 |
> | **rPTS range** | **53% to 76%** | **47% to 72%** |
>
> Range remains wide because DR-16, DR-22 and DR-18 are outstanding. If DR-16 confirms FDA accepted PFS, D1 would move toward -4 to -1.

**Risks noted:** R-01 Primary endpoint not aligned with FDA and EMA advice (PFS vs OS); R-06 Hepatic safety: potential Hy's law case reported while company states none; REMS possible

**Facilitator cue (hide from audience):** PI-06, PI-10

### Decision gate G4: What rPTS position and materiality does the regulatory DD lead sign?

**Decider:** Regulatory due-diligence lead. **Recommended:** Proceed.

| Option | Consequence | Next |
|---|---|---|
| Proceed | Lead signs a range (illustrative for scripting: 50% to 65%) conditional on RQ-1, RQ-2 and RQ-3. Recommendation assembled. | recommendation |
| Pause | Position held until the outstanding documents arrive; risk steps re-run. | END_PAUSED |
| Seek more information | No position signed. Priority requests RQ-1, RQ-2 and RQ-3; re-run risk drafting and challenge on receipt. | END_REQUEST |

**Evidence that would change the call:** DR-16 showing FDA accepted PFS (would raise the range). A 483 classified OAI or a Lumenar termination notice (would lower it). Interim PFS from study 301 is after the NDA date and cannot inform this decision.

---

## Stage 11: Recommendation and the decision to continue to valuation (`recommendation`)

**What is happening.** The template assembles the validated record; the lead signs; the deal sponsor recommends; the deal governance committee decides. The question: continue to valuation or not.

**Agents:** none. **Tools:** Report template and traceability matrix. **Human reviewer:** Regulatory due-diligence lead.

### Agent output: Draft signed regulatory recommendation (for the lead to edit and sign) (None; the template assembles the validated record)

> **Regulatory assessment, OST-4417 (Phase III, TRX-7-high cholangiocarcinoma).** Evidence limit: eight documents not provided; findings dependent on them are provisional.
>
> | Issue | Implication | Action | Owner | Status |
> |---|---|---|---|---|
> | Endpoint alignment (R-01) | FDA and EMA prefer OS; PFS primary unconfirmed | Obtain DR-16; model both scenarios | Clinical reg specialist | Open |
> | Pathway (R-02) | Accelerated approval not agreed in advance; available therapy risk | Track NVB-210; plan full-approval path | Reg intelligence specialist | Open |
> | Sole DS site (R-03, R-05) | Open 483 and no comparability evidence | Obtain DR-22, DR-19; second-site plan | CMC specialist | Open |
> | CDx (R-04) | No bridging; partner termination right | Obtain DR-18; legal to review clause | Device specialist, legal workstream | Open |
> | Hepatic safety (R-06) | Possible REMS and label implications | Safety workstream adjudication | Safety and PV workstream | Open |
> | EU PIP (R-07) | Gates MAA validation | Confirm status, file waiver or PIP | Regional specialist | Open |
>
> **rPTS (Phase III):** challenged range 47% to 72%; lead's position: to be signed live (illustrative 50% to 65%).
>
> **Regulatory recommendation (for the lead to sign):** continue to valuation with regulatory conditions. The regulatory view hands valuation the rPTS range, the scenario split (PFS accepted vs OS required), and the open items. Structure and price protections are for the deal team.

**Human review:** Lead edits and signs. 'The machine said so' is not a rationale.

### Decision gate G5: Continue to valuation, or not?

**Decider:** Deal governance committee (on the Executive deal sponsor's recommendation, after the Regulatory DD lead signs). **Recommended:** Proceed.

| Option | Consequence | Next |
|---|---|---|
| Proceed | Continue to valuation with the regulatory conditions and the rPTS range passed to the valuation team. | END_VALUATION |
| Pause | Hold valuation until RQ-1, RQ-2 and RQ-3 are answered. | END_PAUSED |
| Seek more information | Valuation waits; priority requests escalated through the sponsor to the seller. | END_REQUEST |
| Stop | Regulatory risk is judged unacceptable at any plausible price. Not recommended on current evidence. | END_STOP |

**Evidence that would change the call:** A 483 classified OAI, DR-16 showing FDA rejected PFS, a Lumenar termination notice, or the safety workstream adjudicating the hepatic case as Hy's law would each move the call toward Pause or Stop. DR-16 confirming PFS acceptance would strengthen Proceed.

---

## Roles that never delegate to agents

Domain conclusions and materiality; the rPTS position; the signed recommendation; regional filing strategy; judgment on label claim strength; resolution of specialist disagreement; acceptance of incomplete evidence; go/no-go and risk acceptance. The demo should show each of these as a human action.
