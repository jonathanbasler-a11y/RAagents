# Build learnings: always apply

The full lessons, with evidence, are in `docs/BUILD-LEARNINGS.md`. Before you design or change a part of the app, read the matching part of that file first:

| Working on | Read first |
|---|---|
| Architecture overview, stack, database, structural tests | Part 2 |
| Roles, workspaces, approvals, audit trail, data walls, untrusted text | Part 3 |
| Public sources, ingest, parsing, chunking, retrieval, findings register | Part 4 |
| Agent specs, prompts, tools | Part 5 |
| Routing, team runs, synthesis, budgets | Part 6 |
| Playbooks, review UI, feedback | Part 7 |
| Model connection, retries, streaming, long runs, time handling | Part 8 |
| Evals, the known-outcome demo, the evidence checker | Part 9 |
| Security, crawling, secrets | Part 10 |
| Development workflow, Claude Code setup | Part 11 |

## Non-negotiables

- Agent output (findings, summaries, briefings, notes) is never evidence. Only primary public sources support a finding: "no source, no finding" is enforced in code, not in the prompt.
- Human-reserved decisions and approvals happen only through an authenticated human action. Never through a tool argument the model fills in.
- Tools return what they actually did, and nothing reports success after a failure.
- Keep "checked: not applicable", "not checked" and "could not check" as distinct states.
- Label fallback or canned model output on every message. It never enters findings, evals or memory.
- Use exact-read tools for "latest", "all" and "how many". Never state that something is absent without listing and reading first.
- Known-outcome runs filter by an as-of date in retrieval code. Any later source is a hard failure.
- Every route into an agent goes through the same grants, gates and grounding.
- Measure on a frozen corpus. Compare runs case by case, against the noise. The judge model is never the agent's model.
- Tests run offline. Every guard gets a mutation test that proves it can fail.
- This repo is public. Never commit credentials, internal hosts, company names (other than regulators), personal names or confidential material.
