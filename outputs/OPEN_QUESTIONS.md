# Open questions

When a question is answered, set its status to Answered, note the answer, and log any resulting decision in `DECISIONS.md`.

| # | Question | Raised | Status | Answer |
|---|---|---|---|---|
| 1 | Which tools and platforms can we use for the demo? | 2026-10-07 | Partly answered | A web chat app (`outputs/05_demo/app`) running on a laptop on the company VPN, with the company LLM gateway. An Ona setup is prepared; whether Ona can reach the gateway is open question 19. |
| 2 | How long is the stakeholder slot, and when is the presentation? | 2026-10-07 | Open | |
| 3 | What has the other team produced, and when will we get it? | 2026-10-07 | Open | |
| 4 | The layer model: 5 or 6 layers? (The team says 5 but lists 6.) | 2026-10-07 | Open | Proposal in `00_kickoff.md` §3: five layers plus a human-accountability frame (or six, with the human layer drawn as a band). Awaiting team decision. |
| 5 | Which public asset with a known outcome should the demo use? | 2026-10-07 | Open | Selection criteria proposed in `00_kickoff.md` §4: the model must not already know the outcome; enough sources dated before the outcome. |
| 6 | How do we position inspections alongside Quality? | 2026-10-07 | Open | |
| 7 | Who are the senior stakeholders, what decision do we want from them, and who is the executive sponsor? | 2026-10-07 | Open | |
| 8 | Which LLM key or provider powers the agents, and how do the two colleagues at the owner's company get access without the key entering the repo or an app? | 2026-10-07 | Answered | The company LLM gateway. Each colleague uses their own company key, in a local git-ignored settings file or as an Ona user secret; no key ever enters the repo. See `DECISIONS.md`, 2026-10-07. |
| 9 | Are the two colleagues Moonflower team members, and will cohort members from other companies also need to run the agents? Do they watch, run or extend them? | 2026-10-07 | Open | |
| 10 | Should the GitHub repo stay public? If so, have participants agreed to their names and companies appearing in it, and which licence applies, before any push? | 2026-10-07 | Open | |
| 11 | Which brief items did the team actually agree (autonomy levels, finding format, agent kinds, inspection modules, demo design), and which are still proposals? | 2026-10-07 | Open | |
| 12 | Which 6–8 specialist agents form the MVP? | 2026-10-07 | Partly answered | The chat app carries mockup v2's full library of 25 named agents (see `DECISIONS.md`, 2026-10-07). Which 6–8 the MVP builds in depth (with sources and tools) is still open, as mockup v2 also says. |
| 13 | Is the merge session with the other team tomorrow (2026-10-08), and what is the latest date we can take in their material? | 2026-10-07 | Open | |
| 14 | Who owns the trust layer, the evidence layer and orchestration, and who approves playbook updates that agents propose? | 2026-10-07 | Open | |
| 15 | How will agent performance be monitored, and who grants autonomy upgrades? | 2026-10-07 | Open | |
| 16 | May the AI only tidy the team's Box 9 wording, or also add to it? | 2026-10-07 | Open | |
| 17 | Is there a photo or record of the team's filled-in canvas, and any notes from the discussion before the recording started? | 2026-10-07 | Open | |
| 18 | How will validation on past DDs and the side-by-side pilot happen, given that past DDs can never enter this repo? | 2026-10-07 | Open | |
| 19 | Can Ona environments reach the company LLM gateway, which is VPN-only? If not, does IT provide an Ona runner inside the company network, or do teammates run the app on their own laptops on VPN? | 2026-10-08 | Open | The probe is ready on branch `feature/ona-env` (`docs/ONA.md`); the owner runs it in an Ona environment. |
