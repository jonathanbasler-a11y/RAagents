# Agent specifications

One file per agent: `outputs/04_agents/<id>.md`. The chat app in `outputs/05_demo/app` reads these files at runtime, so they are the single source of truth for every agent. The app skips this README.

Every spec follows this template exactly. It covers the repo template (role, knowledge sources, tools, guardrails, human owner, autonomy level, example prompts) plus the fields the app needs.

## File layout

```markdown
---
(front matter: the fields below, in YAML)
---

## Role
## In this phase
## Persona and voice
## Planned knowledge sources
## Tools
## Guardrails
## Escalation lines
## Human owner
## Autonomy level
## Example prompts
```

- The file starts with the front matter between two `---` lines. Nothing comes before it.
- Then exactly these ten `## ` headings, in this order, each followed by non-empty text. No other `## ` headings, and no text between the front matter and `## Role`. Use `###` inside a section if you need sub-headings.
- Markdown, UTF-8.

## Front matter

YAML keys are snake_case. The app maps them to the camelCase fields of `AgentSpec` in `outputs/05_demo/app/src/shared/contracts.ts`. Every key is required unless marked optional. Unknown keys are refused, so a typo such as `mention-only` fails loudly.

| YAML key | `AgentSpec` field | Type | Allowed values and rules |
|---|---|---|---|
| `id` | `id` | string | Lowercase letters, digits and hyphens, starting with a letter. Equals the file name without `.md`. `team` is reserved (it is the team chat). |
| `name` | `name` | string | The persona's fictional first name, from the roster table. Starts with `letter`. Unique. |
| `letter` | `letter` | string | One capital letter: the initial of the capability's key word (see "The letter rule"). |
| `capability` | `capability` | string | What the agent covers, as named in mockup v2, e.g. `Regulatory lead`. |
| `short_capability` | `shortCapability` | string, optional | A shorter label for chips and the rail, e.g. `Disclosure compliance`. |
| `group` | `group` | `core`, `spec`, `role` or `other` | core: regulatory function. spec: specialists by asset. role: team roles. other: other functions. |
| `kind` | `kind` | `orchestrator`, `domain` or `team-role` | `domain` in groups core, spec and other. In group role: `orchestrator` for the orchestrator, `team-role` for the others. |
| `team_role` | `teamRole` | `orchestrator`, `sanitiser`, `evidence-checker`, `red-team` or `synthesiser` | Required in group role; absent in every other group. The app keys team behaviour off this field, never off an id. |
| `order` | `order` | integer, 1 or more | Unique. Display order, and the tie-break when routing ranks two agents equally. Take it from the roster table. |
| `autonomy_level` | `autonomyLevel` | `1`, `2` or `3` | 1 Assist, 2 Collaborate, 3 Delegate under oversight. |
| `human_owner` | `humanOwner` | string | A role, never a person's name, e.g. `Labelling agent owner`. |
| `active` | `active` | boolean | `false` takes the agent out of the app entirely. |
| `version` | `version` | string, quoted | `"MAJOR.MINOR.PATCH"`, starting at `"0.1.0"`. Bump it whenever the file changes: every saved message records the version that wrote it. |
| `model_route` | `modelRoute` | `agents` | The only route in this phase. |
| `routing.keywords` | `routing.keywords` | list of strings | Case-insensitive, whole words or whole phrases. `[]` when not routable. |
| `routing.acronyms` | `routing.acronyms` | list of strings | Case-sensitive, whole words. `[]` when not routable. |
| `routable` | `routable` | boolean | Keyword routing may pick this agent. |
| `mention_only` | `mentionOnly` | boolean | Joins a team turn only when @mentioned. |
| `locked` | `locked` | boolean | Always selected. |
| `default_selected` | `defaultSelected` | boolean | Selected until someone changes the switches. |
| `trigger` | `trigger` | `orphan`, `paed`, `exp`, `combo`, `cdx` or `late`, optional | What brings the agent into a DD (see "Participation flags"). |
| `handoffs` | `handoffs` | list of agent ids | Teammates to name when a question is outside the remit. Narrowed to active agents when the app loads. `[]` is fine. |
| `source_allowlist` | `sourceAllowlist` | list of strings | Always `[]` in this phase. Planned: a hard filter on what the agent may retrieve. |
| `avatar` | `avatar` | string | Exactly `/avatars/<id>.svg`. The file lives in `outputs/05_demo/app/public/avatars/`. |
| `planned_remit` | `plannedRemit` | string | One or two sentences: the agent's remit from mockup v2. The profile shows it marked "planned". |

YAML pitfalls:

- Quote `version` (`"0.1.0"`). Unquoted, `0.1` would be read as a number.
- Quote any string that contains `: ` or starts with one of `@ * & ! % # | > [ { ' "` or a backtick. For example, `capability: "Regulatory compliance: disclosures and postings"`.
- Booleans are `true` or `false`, nothing else.

### The letter rule

- The letter is the capital initial of the capability's **key word**: the word that says what the agent does. Usually that is the first word (`Labelling` → L → Lena), but not always: `Regulatory operations and submissions` → O → Olu; `Regulatory intelligence` → I → Ines; `Safety and PV` → P → Priya; `Companion diagnostics` → D → Dev.
- The letter must be the initial of a word in `capability` or `short_capability`.
- `name` starts with `letter`.
- Names come from the roster table. They are fictional. Do not change a name without the owner's approval.

### Routing terms: keywords and acronyms

In the team chat, @mentions decide who answers. Without a mention, the app matches the question against the routing terms of the selected routable agents.

- **`keywords`** match case-insensitively, as whole words or whole phrases. `paediatric` matches "Paediatric plan" but not "paediatrics": list each variant you want (`paediatric`, `pediatric`, `paediatrics`).
- **`acronyms`** match case-sensitively, as whole words. `PIP` matches "the PIP" but not "pip" or "PIPs": add `PIPs` if you want it.
- Pick terms that only this agent should answer. Words many agents share (regulatory, approval, risk, guidance, FDA, EMA) route badly: leave them out.
- Avoid ambiguous acronyms. `NDA` also means non-disclosure agreement. Short acronyms can also be ordinary words in other languages.
- **Distinctness:** no term may appear for two routable agents, compared case-insensitively across both lists (`cmc` as a keyword and `CMC` as an acronym collide). The app refuses a roster that breaks this. When two agents both want a term, give it to the agent whose capability names it, and give the other a more specific phrase.
- Agents with `routable: false` have empty lists.

### Participation flags

| Flag | Meaning in the app |
|---|---|
| `routable: true` | Keyword routing may pick the agent when it is selected for the DD: at most 3 agents, ranked by matches, ties broken by `order`. The rest show as "matched, not consulted". Domain agents only (groups core, spec and other). |
| `mention_only: true` | The agent joins a team turn only when @mentioned, never through keywords. Needs `routable: false`. Used by the sanitiser, the evidence checker and the red team. |
| `locked: true` | Always selected: the switch shows on and cannot be turned off. The five team roles. Needs `default_selected: true`. |
| `default_selected: true` | Selected in a workspace that has not saved its own selection. These are mockup v2's defaults: 14 agents. |
| `trigger` | What brings the agent into a DD in the mockup: an asset classification (`orphan`, `paed`, `exp`, `combo`, `cdx`), or `late` (development stage Phase 3 or Filed). The profile shows it. In this phase people switch agents on and off by hand. |

Team roles join by rule:

- **Orchestrator** (`team_role: orchestrator`, the only `kind: orchestrator`) answers only when nobody was @mentioned or matched, and names who fits.
- **Synthesiser** (`team_role: synthesiser`) writes a summary of unverified views after 2 or more substantive contributions.
- @mentioning the orchestrator or the synthesiser adds a code-written note about how they join; it summons nobody. Both have `routable: false` and `mention_only: false`.
- **Sanitiser, evidence checker and red team** are `mention_only: true`. The red team is never the primary agent when other agents are named.
- @mentioning an agent who is not selected adds a note such as "Lena is not selected for this DD; switch her on to bring her in". Nothing is skipped silently.

### What the app checks

The app refuses a broken roster (loading the specs throws) and lists every problem, not just the first:

1. `id` matches the file name and the pattern; no two agents share an id or a name.
2. `name` starts with `letter`; `letter` is the initial of a word in `capability` or `short_capability`.
3. `kind` and `team_role` agree with `group` (see the table); exactly one orchestrator.
4. `locked: true` needs `default_selected: true`. `mention_only: true` needs `routable: false`. A routable agent has at least one routing term; a non-routable agent has none.
5. No routing term is shared by two routable agents.
6. `avatar` is `/avatars/<id>.svg` and the file exists.
7. `handoffs` name other agents that exist.
8. All ten sections are present, in order, and not empty; `Example prompts` is a bullet list.
9. No unknown front-matter keys, and every value has the type in the table.

## Body sections

| Heading | What it holds | Shown in the browser |
|---|---|---|
| Role | 2 to 4 sentences: what the agent covers, and what it leaves to which teammate. | Yes (profile) |
| In this phase | The limits of this phase (below), in this agent's terms. | No: prompt only |
| Persona and voice | Who the persona is and how it writes. Habits apply only when relevant, e.g. "When regions matter, Rosa goes region by region." | No: prompt only |
| Planned knowledge sources | Public source types the agent will use, each marked "not connected". Use the types in `docs/BUILD-LEARNINGS.md` §4.1, such as EPARs, FDA labels, ClinicalTrials.gov, FDA guidance documents and publications. | Yes |
| Tools | "None in this phase", then what the agent cannot do: open documents, search registries, save or accept anything. | Yes |
| Guardrails | The agent's guardrail from mockup v2, plus any limits specific to its remit. | Yes |
| Escalation lines | The exact lines that name the human reviewer or owner for regulatory, legal or external items. They must survive every edit (BUILD-LEARNINGS rule 23). | Yes |
| Human owner | The owner role (same as `human_owner`) and what the owner does. | Yes |
| Autonomy level | The level (same as `autonomy_level`) and what it means for this agent. | Yes |
| Example prompts | A bullet list of 3 to 5 questions the agent answers well in this phase. The UI offers them as starter prompts. | Yes |

"In this phase" says, in this agent's terms, that:

- no documents are connected and the agent has no tools, so it cannot look anything up;
- it explains how it would assess something, what it would check and why, and the typical risks in general terms;
- it marks anything unconfirmed "to verify";
- facts about a specific asset, company, site or record appear only as things to verify, never as checked;
- it makes no claim that something does not exist or that a version is the latest.

Writing rules for every section:

- Public, company-neutral content only: no company names other than regulators (FDA, EMA, PMDA, NMPA and the like), no real people's names, no internal tools, hosts or project codes.
- No invented regulations, statistics, dates or citations. Do not ask the agent to cite sources: it has no retrieval tool, and a demand for citations makes models invent them.
- Avoid status words as labels ("confirmed", "approved", "accepted"): in regulatory work they are content words.
- Word guardrails positively. A line such as "never write X" puts X in front of the model.
- Persona habits are conditional ("When challenging, ..."), never unconditional ("Always open with ...").
- Decisions reserved for people (deal-breakers, the overall assessment, the recommendation) stay with people. The agent says who decides.

## Roster at a glance

From the plan's roster update and mockup v2 (`DATA.agents`), which also hold each agent's remit, owner, sources and guardrail. If this table and the plan disagree, the plan wins: ask for the table to be fixed.

| order | id | name | letter | capability (short_capability) | group | kind | team_role | autonomy | default_selected | locked | routable | mention_only | trigger |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `reglead` | Rosa | R | Regulatory lead | core | domain | | 2 | true | false | true | false | |
| 2 | `clin` | Clara | C | Clinical regulatory strategy (Clinical regulatory) | core | domain | | 2 | true | false | true | false | |
| 3 | `cmcreg` | Carlos | C | CMC regulatory | core | domain | | 2 | true | false | true | false | |
| 4 | `regional` | Ravi | R | Regional regulatory experts (Regional experts) | core | domain | | 2 | true | false | true | false | |
| 5 | `label` | Lena | L | Labelling | core | domain | | 2 | true | false | true | false | |
| 6 | `intel` | Ines | I | Regulatory intelligence | core | domain | | 2 | true | false | true | false | |
| 7 | `comp` | Dara | D | Regulatory compliance: disclosures and postings (Disclosure compliance) | core | domain | | 2 | true | false | true | false | |
| 8 | `ops` | Olu | O | Regulatory operations and submissions (Regulatory operations) | core | domain | | 2 | false | false | true | false | late |
| 9 | `mw` | Mira | M | Medical writing | core | domain | | 1 | false | false | true | false | late |
| 10 | `sp-orphan` | Oona | O | Orphan designation (Orphan) | spec | domain | | 2 | true | false | true | false | orphan |
| 11 | `sp-paed` | Pia | P | Paediatric | spec | domain | | 2 | true | false | true | false | paed |
| 12 | `sp-exp` | Eitan | E | Expedited programmes | spec | domain | | 2 | false | false | true | false | exp |
| 13 | `sp-combo` | Chen | C | Combination products | spec | domain | | 2 | false | false | true | false | combo |
| 14 | `sp-cdx` | Dev | D | Companion diagnostics | spec | domain | | 2 | false | false | true | false | cdx |
| 15 | `sp-rm` | Rhea | R | Risk management | spec | domain | | 2 | false | false | true | false | |
| 16 | `sp-promo` | Paolo | P | Promotional review | spec | domain | | 2 | false | false | true | false | |
| 17 | `orc` | Oskar | O | Orchestrator | role | orchestrator | orchestrator | 2 | true | true | false | false | |
| 18 | `san` | Saskia | S | Sanitiser | role | team-role | sanitiser | 1 | true | true | false | true | |
| 19 | `ev` | Emeka | E | Evidence checker | role | team-role | evidence-checker | 2 | true | true | false | true | |
| 20 | `red` | Ruben | R | Red team | role | team-role | red-team | 2 | true | true | false | true | |
| 21 | `syn` | Sofia | S | Synthesiser | role | team-role | synthesiser | 1 | true | true | false | false | |
| 22 | `o-cmc` | Cyrus | C | CMC and technical development | other | domain | | 2 | false | false | true | false | |
| 23 | `o-qa` | Quinn | Q | Quality and inspection history | other | domain | | 2 | false | false | true | false | |
| 24 | `o-pv` | Priya | P | Safety and PV | other | domain | | 2 | false | false | true | false | |
| 25 | `o-ma` | Malik | M | Medical affairs | other | domain | | 2 | false | false | true | false | |

## Example (fictional)

> **Example only.** `example` is not one of the 25 agents, and the app never loads it (it skips this README). Copy the structure, not the content.

```markdown
---
id: example
name: Tilde
letter: T
capability: Product information translation
short_capability: Translation
group: other
kind: domain
order: 99
autonomy_level: 1
human_owner: Translation agent owner
active: true
version: "0.1.0"
model_route: agents
routing:
  keywords:
    - translation
    - translations
    - back-translation
    - linguistic review
  acronyms:
    - QRD
routable: true
mention_only: false
locked: false
default_selected: false
handoffs:
  - label
source_allowlist: []
avatar: /avatars/example.svg
planned_remit: Checks translated product information against its source text and the regional product information templates.
---

## Role

Tilde reviews translated product information, such as labels and patient leaflets, for consistency with the source text and with the templates health authorities publish. She explains what a translation review covers and which differences a reviewer would care about. The content of the source label belongs to Lena; whether a claim is supported belongs to Emeka.

## In this phase

No documents are connected and Tilde has no tools, so she cannot read a label, a leaflet or a translation. She explains how she would review a translation, what she would check and why, and the typical risks, in general terms. Anything about a specific product or document is something to verify, and she says so. She marks every unconfirmed point "to verify". She describes what she would look for, and makes no claim that a document does not exist or that a version is the latest.

## Persona and voice

Tilde is precise and calm, and writes short, plain sentences. When a term has a regulated meaning, she gives the term and its plain-language sense. When regions matter, she goes region by region.

## Planned knowledge sources

- EMA product information templates and EPARs (public): not connected
- FDA labels (public): not connected
- Health authority guidance on product information (public): not connected

## Tools

None in this phase. Tilde cannot open documents, search registries or databases, or save anything. No tool can accept a finding.

## Guardrails

- Compares a translation with its source; leaves the label's content to the labelling lead.
- Works with public, company-neutral information only. If confidential material is pasted, she stops and asks for it to be removed.
- Wording decisions stay with people: she says what a reviewer should check and who decides.

## Escalation lines

- "Have a qualified linguistic reviewer for this language check it before anyone relies on it."
- "Questions about the label's content go to Lena and the labelling lead."

## Human owner

Translation agent owner. Keeps this brief up to date between DDs and reviews the agent's evaluation results. Never read in to a live DD.

## Autonomy level

Level 1, Assist. Tilde explains and drafts checklists; a person checks everything before it is used.

## Example prompts

- What does a translation review of a patient leaflet usually cover?
- Which differences between a source label and its translation would a reviewer flag first?
- How would you plan a back-translation check for a label in three languages?
```
