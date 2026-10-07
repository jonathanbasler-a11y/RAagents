# Digital Human Hybrid Team (RCC Moonflower)

A concept, stakeholder presentation and demo for a hybrid team in which human domain experts and AI agents work together as one team to deliver specific regulatory activities, starting with a due diligence playbook as the MVP. It is being developed by the Moonflower group of the RCC cohort in the October 2026 Digital Adoption Accelerator, for presentation to senior stakeholders.

> **Company-neutral content only.** Everything in this repository must be company-neutral, safe to share between companies, and free of confidential or proprietary information and personal names. Confidential material belongs only in `inputs/confidential/`, which is git-ignored and must never be committed.

## Folder structure

- `inputs/`: read-only source material
- `inputs/canvas-photos/`: photos of the Digital Mindset Canvas
- `inputs/other-team/`: the other team's material, added after the merge
- `inputs/confidential/`: local only; git-ignored and never committed
- `outputs/`: deliverables, plus the decision log (`DECISIONS.md`) and open questions (`OPEN_QUESTIONS.md`)
- `outputs/01_concept/`: the merged concept
- `outputs/02_canvas/`: the refined Digital Mindset Canvas
- `outputs/03_deck/`: the senior stakeholder presentation
- `outputs/04_agents/`: one specification file per agent
- `outputs/05_demo/`: the demo scenario and materials
- `.claude/agents/`: Claude Code subagent definitions (empty for now)

## Development environment

The repository includes a Dev Container (`.devcontainer/`, official Ubuntu image) and an Ona configuration (`.ona/`). The Ona configuration defines no tasks or services yet; add them when there is something to run.
