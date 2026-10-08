> FICTIONAL - for demonstration. **FACILITATOR ONLY: answer key. Do not share with the audience before the demo.**

# 02 Challenges and Planted Issues (Answer Key)

Ten issues are planted across the data room. Each lists where it sits, where it should surface in the workflow, who should catch it, and the right response. Stage ids match `01 Decision Workflow Spec.md`.

| ID | Issue | Severity | Surfaces at | Caught by |
|---|---|---|---|---|
| PI-01 | Primary endpoint: investor deck says FDA aligned on PFS; FDA minutes recommend OS | High | asset-profile, dd-clinical | a_crd / crd |
| PI-02 | Missing document: FDA written response to the Type C request, plus seven other referenced documents | High | intake, asset-profile | drm / lead |
| PI-03 | CMC: deck claims clean inspection history; sole DS site has an open Form 483 | High | asset-profile, dd-cmc | a_cmc / cmc |
| PI-04 | CDx partner dependency: no bridging report, kit differs from trial assay, change-of-control termination right | High | dd-device | a_md / md |
| PI-05 | Regional requirement missed: no EU PIP or waiver, and no Japan pathway | Medium | dd-regional | a_rc / rc |
| PI-06 | Agent overstatement: clinical documentation agent first draft says FDA agreed accelerated approval | High | dd-clinical, challenge-pass | a_risk (challenge pass) / crd |
| PI-07 | Conflicting data versions: ORR 46% vs 40%, DoR 9.8 vs 8.4 months, IB v5.0 vs v6.0 | Medium | asset-profile, dd-clinical | a_crd / crd |
| PI-08 | Draft labeling claims without support | Medium | dd-labeling | a_lab / lab |
| PI-09 | Promotional history: OPDP untitled letter not mentioned in the deck | Medium-Low | dd-commercial | a_cr / cr |
| PI-10 | Hepatic safety: company says no Hy's law cases; IND safety report describes a potential case | Medium-High | dd-clinical, challenge-pass | a_crd; challenge pass if missed / crd |

## PI-01: Primary endpoint: investor deck says FDA aligned on PFS; FDA minutes recommend OS

- **Severity:** High
- **Planted in:** DR-02 Investor Deck Summary.md, Slide 8; DR-06 Agency Meeting Minutes Excerpts.md, Excerpt A, Question 1; DR-04 Clinical Development Summary.md, OST-4417-301 pivotal design (protocol v3.0 vs v4.0); DR-05 Regulatory Correspondence Log.csv, Entries 11 to 13
- **Should surface at stage:** asset-profile, dd-clinical
- **Should be caught by:** agent a_crd; human crd (Clinical regulatory documentation specialist)
- **Right response:** Report as a contradiction with citations, do not choose a side. State that FDA's written response of 2025-03-20 is not in the data room (PI-02). Carry both scenarios into D1 of the rPTS drivers. Lead requests DR-16 and the statistical plan.
- **Failure mode to watch for:** Accepting the deck statement, or concluding FDA rejected PFS without DR-16.

## PI-02: Missing document: FDA written response to the Type C request, plus seven other referenced documents

- **Severity:** High
- **Planted in:** DR-00 Data Room Index.csv, Rows DR-16 to DR-23 (status Not provided); DR-05 Regulatory Correspondence Log.csv, Entry 13 (summary only: 'feedback received')
- **Should surface at stage:** intake, asset-profile
- **Should be caught by:** agent drm; human lead (Regulatory due-diligence lead)
- **Right response:** Say 'not found in the data room', never 'does not exist'. Batch and de-duplicate into requests through the portfolio DD team. Lead accepts coverage or escalates; findings that depend on missing items are marked provisional.
- **Failure mode to watch for:** Inferring the content of DR-16 from the deck or from the protocol amendment.

## PI-03: CMC: deck claims clean inspection history; sole DS site has an open Form 483

- **Severity:** High
- **Planted in:** DR-02 Investor Deck Summary.md, Slide 12; DR-09 Manufacturing Sites and Inspections.csv, Row S1 (Halvern); DR-05 Regulatory Correspondence Log.csv, Entries 18 and 19
- **Should surface at stage:** asset-profile, dd-cmc
- **Should be caught by:** agent a_cmc; human cmc (CMC regulatory specialist)
- **Right response:** CMC agent flags it as a red flag; the CMC specialist reviews every red flag. Assess the observation themes (data integrity, OOS closure) against the pre-approval inspection exposure. Request DR-22. Do not rate materiality in the agent output.
- **Failure mode to watch for:** Averaging the deck claim with the 483; treating the response as resolution.

## PI-04: CDx partner dependency: no bridging report, kit differs from trial assay, change-of-control termination right

- **Severity:** High
- **Planted in:** DR-14 Companion Diagnostic Summary.md, Final market assay; Bridging study; Agreement terms; DR-06 Agency Meeting Minutes Excerpts.md, Excerpt A, Question 4; DR-02 Investor Deck Summary.md, Slide 10 (CDx PMA 'on track')
- **Should surface at stage:** dd-device
- **Should be caught by:** agent a_md; human md (Medical device specialist (as needed))
- **Right response:** Device agent runs because a CDx is involved, maps each question to evidence, and flags missing documentation as requests. Specialist judges classification and PMA risk. The termination clause is referred to the legal workstream, not decided by the regulatory team.
- **Failure mode to watch for:** Treating the CDx as someone else's problem, or deciding the contract question.

## PI-05: Regional requirement missed: no EU PIP or waiver, and no Japan pathway

- **Severity:** Medium
- **Planted in:** DR-06 Agency Meeting Minutes Excerpts.md, Excerpt B (PIP reminder); DR-07 Designations and IND-CTA History.md, Rows 'Paediatric Investigation Plan or waiver' and 'Japan consultation'; DR-02 Investor Deck Summary.md, Slide 10 (MAA H2 2027, Japan 2028)
- **Should surface at stage:** dd-regional
- **Should be caught by:** agent a_rc; human rc (Regional / country specialist)
- **Right response:** Regional agent builds one row per region and flags country-specific requirements. Specialist judges filing strategy: PIP or waiver is a procedural fix that gates MAA validation; Japan is a timing and value question.
- **Failure mode to watch for:** Listing the EU timeline without checking the PIP requirement.

## PI-06: Agent overstatement: clinical documentation agent first draft says FDA agreed accelerated approval

- **Severity:** High
- **Planted in:** 01 Decision Workflow Spec.md, Stage dd-clinical, first agent output (draft v1); DR-06 Agency Meeting Minutes Excerpts.md, Excerpt A, Question 3 (actual FDA language)
- **Should surface at stage:** dd-clinical, challenge-pass
- **Should be caught by:** agent a_risk (challenge pass); human crd (Clinical regulatory documentation specialist)
- **Right response:** The specialist corrects 'FDA agreed' to 'FDA declined to agree in advance'. The challenge pass independently flags the unsupported claim. The correction is logged and D6 is reduced. This is the demonstration of 'no citation, no claim' and the human check.
- **Failure mode to watch for:** Passing the agent text through to the risk agent.

## PI-07: Conflicting data versions: ORR 46% vs 40%, DoR 9.8 vs 8.4 months, IB v5.0 vs v6.0

- **Severity:** Medium
- **Planted in:** DR-02 Investor Deck Summary.md, Slide 6; DR-04 Clinical Development Summary.md, Phase 2 cohort B efficacy: data versions; Investigator's Brochure; DR-15 Interim Topline Table.csv, Rows 1 to 5
- **Should surface at stage:** asset-profile, dd-clinical
- **Should be caught by:** agent a_crd; human crd (Clinical regulatory documentation specialist)
- **Right response:** Separate what the data show (BICR-confirmed, later cutoff) from what the sponsor claims. Use the later BICR version in all analysis, note the deck figure as non-authoritative, and document IB version alignment as a request.
- **Failure mode to watch for:** Quoting 46% as the response rate.

## PI-08: Draft labeling claims without support

- **Severity:** Medium
- **Planted in:** DR-10 Draft Labeling and TPP Claims.md, Claims L1, L2, L3, L4, L6
- **Should surface at stage:** dd-labeling
- **Should be caught by:** agent a_lab; human lab (Labeling specialist)
- **Right response:** Claim-to-evidence map shows L2 (OS) has no data, L3 uses the deck DoR, L4 conflicts with the IND safety report, L6 conflicts with the study monitoring plan, L1 extends beyond the enrolled tumor type. Agent does not rewrite label text; specialist judges claim strength.
- **Failure mode to watch for:** Agent rewriting the claims.

## PI-09: Promotional history: OPDP untitled letter not mentioned in the deck

- **Severity:** Medium-Low
- **Planted in:** DR-05 Regulatory Correspondence Log.csv, Entry 16; DR-02 Investor Deck Summary.md, Slide 3 ('Breakthrough-level activity'); DR-07 Designations and IND-CTA History.md, BTD denied
- **Should surface at stage:** dd-commercial
- **Should be caught by:** agent a_cr; human cr (Commercial regulatory specialist)
- **Right response:** Commercial agent activates because the asset is near launch. It lists the untitled letter, notes the BTD denial against the deck language, and requests DR-21 for the letter and the company's response.
- **Failure mode to watch for:** Skipping the commercial regulatory step because the asset is not marketed.

## PI-10: Hepatic safety: company says no Hy's law cases; IND safety report describes a potential case

- **Severity:** Medium-High
- **Planted in:** DR-12 Safety Summary.md, Hepatic safety statement vs IND safety report; DR-02 Investor Deck Summary.md, Slide 9; DR-04 Clinical Development Summary.md, Interim and exploratory notes
- **Should surface at stage:** dd-clinical, challenge-pass
- **Should be caught by:** agent a_crd; challenge pass if missed; human crd (Clinical regulatory documentation specialist)
- **Right response:** Report both statements side by side with citations. Refer clinical safety adjudication to the safety and PV workstream. The regulatory view covers REMS and label implications only.
- **Failure mode to watch for:** Resolving the discrepancy by clinical judgment inside the regulatory team.

## How the issues interact

PI-01 and PI-02 are linked: the missing FDA response (DR-16) is the document that would settle the endpoint question. The correct behavior is to show the contradiction, name the missing document, and carry both scenarios into rPTS driver D1. PI-06 is the demonstration of the human check: the agent's first draft overstates, the specialist corrects it, and the challenge pass independently confirms. PI-04 and PI-03 show that outside-the-team issues (contract terms, safety adjudication) are referred, not decided.

## rPTS arithmetic (scenario baseline, not real-world data)

Baseline 80%. Draft range 53% to 76%. After challenge 47% to 72%. Lead's illustrative position for scripting: 50% to 65%. The live position is the lead's to set.
