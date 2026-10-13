# Hybrid Regulatory Due-Diligence Team (other team's work)

The other team's material, shared for the merge. It covers the same idea, a hybrid team of human regulatory specialists and AI agents for due diligence, built from our Digital Mindset Canvas session on October 7, 2026, and presented on October 8, 2026. The demo company (Ostravane Therapeutics, asset OST-4417) and its acquirer are fictional.

| Folder | What it is |
|---|---|
| `01-opener-deck/` | The four-slide opener: problem and value hypothesis, proposal for proving it through staged experiments, experiment risks and success criteria, plus use cases in the appendix |
| `02-canvas/` | Our Digital Mindset Canvas (slide and text) and the workshop summary |
| `03-architecture/` | The team architecture page (open the HTML in a browser), the written team plan (Part A matches the page tab by tab; Part B is background), and the red-team pressure test |
| `04-dd-walkthrough/` | The interactive due-diligence walkthrough (open the HTML): scoping, then a specialty hub where each regulatory specialty is reviewed in any order and gets its own Proceed / Pause / Seek more information call, then synthesis. `test-case/` holds the fictional data room, the workflow spec and the facilitator answer key (`02 Challenges and Planted Issues.md`; keep it from demo audiences) |
| `05-demo-agent/` | Instructions that turn Codex (`AGENTS.md`) or Claude Code (`CLAUDE.md`) into an AI team member that co-presents the walkthrough and answers questions from the fictional data room, plus a voice co-presenter kit |

Notes:
- The architecture page and the walkthrough are single-file HTML pages and work offline. The walkthrough's "Ask the data room" chat only works when the page is opened as a Claude artifact; everything else works in any browser.
- To run the demo agent, put `AGENTS.md` (or `CLAUDE.md`) in a folder with a `files/` subfolder containing `test-case/mock-data.json` (with the answer key removed), the `data-room/` files, the team plan, and the presentation files. `README - How to run.md` has the steps.
- Everything here is a proposal for the merged concept, not an agreed design.
