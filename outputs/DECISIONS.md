# Decisions

Log every decision here with its date and source. Add new decisions at the bottom.

| Date | Decision | Source |
|---|---|---|
| 2026-10-07 | Name the concept "Digital Human Hybrid Team": human domain experts and AI agents work together as one team to deliver specific regulatory activities or milestones, with the long-term vision of a fully virtual or digital team for some activities. | Project brief: decisions already made |
| 2026-10-07 | The umbrella idea is fast answers to unexpected regulatory questions, with due diligence (DD) as the first example. | Project brief: decisions already made |
| 2026-10-07 | The MVP builds only the DD playbook (regulatory and technical DD of an external asset), and we learn from it before building more. | Project brief: decisions already made |
| 2026-10-07 | Three expansion playbooks are shown as concepts only, to prove the model scales: inspections (GMP, GCP, PV), positioned as working with Quality rather than taking over its remit; disaster response (e.g. a new impurity found in manufacturing); and rapid response to unexpected health authority or internal questions. | Project brief: decisions already made |
| 2026-10-07 | The framework must scale to other functions beyond RA and to other use cases. | Project brief: decisions already made |
| 2026-10-07 | The team uses the Digital Mindset Canvas (Reichart, 9 boxes). | Project brief: decisions already made |
| 2026-10-07 | The two teams are not scored; the merged concept goes straight to senior stakeholders. | Project brief: decisions already made |
| 2026-10-07 | The earlier brainstorm is not used as source material; the inputs are the canvas transcript and the canvas photos. | Owner, kickoff session |
| 2026-10-07 | The transcript is kept verbatim, including participant first names and company names. | Owner, kickoff session |
| 2026-10-07 | The GPS location is blanked from both canvas photos; picture, orientation and other metadata unchanged. | Owner, kickoff session |
| 2026-10-07 | The chat app uses mockup v2's full library of 25 agents: regulatory function (9), specialists by asset (7), team roles (5) and other functions (4). Team chat participation follows v2's "selected for this DD" set (14 by default) and can be switched; team roles are always on. | Owner, app session |
| 2026-10-07 | Each agent's first name starts with the letter of its capability: Rosa, Clara, Carlos, Ravi, Lena, Ines, Dara, Olu, Mira (regulatory function); Oona, Pia, Eitan, Chen, Dev, Rhea, Paolo (specialists); Oskar, Saskia, Emeka, Ruben, Sofia (team roles); Cyrus, Quinn, Priya, Malik (other functions). Names are data and can change. | Owner, app session |
| 2026-10-07 | Agent pictures are hand-drawn line-art avatars under an open licence (CC0 1.0), generated offline and committed as SVG. No photos of real people. | Owner, app session |
| 2026-10-07 | The agents run on the owner's company LLM gateway, in the OpenAI chat-completions format: Claude Opus 5.5 for the agents, and an OpenAI GPT-5.6 model as the judge, so the judge is a different model family. No endpoint, key or model id is stored in the repository; configuration comes only from each person's own environment. | Owner, app session |
| 2026-10-07 | Each person uses their own company key, in a local git-ignored settings file or as an Ona user secret. There is no shared instance and no shared key. | Owner, app session |
| 2026-10-07 | The chat app lives in `outputs/05_demo/app` (Next.js, Node 24). The agent specifications live in `outputs/04_agents`, one file per agent, and the app reads them at runtime. | Owner, approved app plan |
| 2026-10-07 | In this phase the agents have no documents and no tools. Every reply is labelled as unsourced model output, agents mark what needs checking "to verify", and no agent makes a decision reserved for people (deal-breakers, overall assessment, recommendation). The synthesiser writes a "summary of unverified views" and makes no call. | Owner, approved app plan |
| 2026-10-08 | The company LLM gateway is reachable only on the company VPN, so the live demo runs on a laptop on VPN. Whether Ona environments can reach it is not yet tested (open question 19). | App session, live check |
