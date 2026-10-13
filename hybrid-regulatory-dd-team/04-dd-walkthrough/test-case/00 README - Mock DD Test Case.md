> **FICTIONAL - for demonstration.** Every company, product, person, site and number in this folder is invented. Nothing here describes a real sponsor, drug or deal.

# 00 README: Mock DD Test Case (Moab Digital Accelerator)

Scenario date: October 2026 (scenario "today" is 2026-10-08).

## The case in brief

| Item | Detail |
|---|---|
| Target (fictional) | Ostravane Therapeutics, Inc.: Nasdaq-listed, 468 staff, about $1.9B market cap, strategic review under way |
| Lead asset | OST-4417, oral TRX-7 cofactor inhibitor, Phase III (study OST-4417-301) |
| Therapeutic area | Oncology: previously treated, TRX-7-high intrahepatic cholangiocarcinoma, with an in vitro companion diagnostic |
| Acquirer (fictional) | Tarnwell Pharma |
| Acquirer's question | Should Tarnwell continue to valuation, given the regulatory risk that OST-4417 reaches approval? |

The regulatory angles: an accelerated approval request on Phase 2 data, a disputed primary endpoint, a sole drug substance site with an open Form 483, a companion diagnostic with a change-of-control exit, and EU and Japan requirements the plan skipped.

## How to use the files

| File | Use |
|---|---|
| `01 Decision Workflow Spec.md` | The demo walk-through: 12 stages, 5 decision gates, agent outputs written as the viewer sees them. Maps to the agents and human roles in `arch_spec3.json` (Hybrid Regulatory DD Team Plan v3). |
| `02 Challenges and Planted Issues.md` | **Facilitator only.** Answer key for 10 planted issues: where, when it surfaces, who catches it, the right response. |
| `data-room/` | The mock seller data room (DR-00 index plus DR-01 to DR-15). Eight documents are listed as not provided on purpose. |
| `mock-data.json` | Everything in one structured bundle for a walkthrough UI or chat prototype: stages, outputs, gates, risks, rPTS drivers, planted issues, and full document text. |

## Demo flow

1. Intake and triage (gate G1)
2. Therapeutic area research
3. Asset profile (gate G2: evidence sufficiency)
4. Specialist deep dives: clinical, CMC, device and CDx, labeling, regional, commercial (gate G3)
5. Risk register and rPTS driver draft, then the challenge pass (gate G4: the lead's rPTS position)
6. Recommendation (gate G5: continue to valuation or not)

Every gate offers Proceed, Pause, Seek more information (and Stop where sensible).

## Notes

- The rPTS baseline (80%) is a scenario assumption by the author, not real-world data. Outputs are ranges with drivers, never a single number.
- Real regulators and guidance concepts (FDA, EMA, PMDA, Fast Track, Breakthrough, Type B and C meetings, REMS, ICH Q-series) are used as real concepts. Companies, drugs, sites, precedents P1 to P3 and all figures are fictional.
- The agent outputs include one deliberate error (clinical documentation agent, draft v1) so the human check can be shown.
