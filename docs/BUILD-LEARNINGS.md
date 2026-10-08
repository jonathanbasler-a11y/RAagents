# Build learnings for the Digital Human Hybrid Team

Patterns, pitfalls and checklists to speed up building the multi-agent regulatory team app.

## Where these lessons come from

They come from building and running a predecessor app for several months. It was a multi-agent AI assistant app with:

- an orchestrator and several specialist agents;
- a retrieval-based knowledge base;
- tools, some of them able to write;
- an evaluation harness;
- daily real use.

Nothing here is copied from that app. There is no code, no prompt text and no data from it. This document describes what worked and what broke, in plain words, so that this project can skip the expensive mistakes.

The content is company-neutral and uses public information only. Numbers are given to show the size of an effect. They are not benchmarks.

**Scope of the new app.** It works at industry level. It uses public regulatory sources only. It has no access to email, chat, calendars or personal drives, but it does have a proper knowledge layer.

**How to read this:**

- Part 1 lists the rules to adopt on day one.
- Parts 2 to 7 follow the architecture layers in `CLAUDE.md`.
- Parts 8 to 10 cover the model connection and reliability, evaluation, and security.
- Part 11 covers the development workflow with Claude Code.
- Parts 12 and 13 list the wrong turns that cost the most time, and the problems that are still open.
- The appendices hold checklists.

**Labels:**

- **KEEP**: reuse the pattern as described.
- **ADAPT**: reuse it, with the change described.
- **NEW**: the predecessor never had this, and this app needs it.
- **SKIP**: does not apply here.
- **to verify**: anything not confirmed.

---

## Part 1. Rules to adopt on day one

1. **Generated output is never evidence.** Tag every stored item at write time as *primary* (a public source document) or *derived* (anything an agent wrote: findings, summaries, briefings, notes). Retrieval for evidence returns primary items only.
   - The predecessor indexed its own answers. A wrong answer then ranked first, and the true source ranked eighth.
   - The model did not hallucinate: it faithfully repeated what the corpus told it.
2. **Check the corpus before you blame the model.** Most wrong answers came from what retrieval handed the model, not from the model itself. Replay the query, and read exactly what came back, before forming a theory.
3. **Human decisions are enforced outside the model.**
   - An approval must never be a tool argument the model can fill in. The predecessor had a "consent confirmed" flag, and an agent proposed and approved its own change in a single turn.
   - Acceptance happens only through an authenticated human action.
4. **Tools report what they actually did.** One tool returned "updated" for an empty payload, and the agent faithfully told the user it had saved. An agent cannot be more honest than its tools.
5. **"Checked: not applicable", "not checked" and "could not check" are three different states.** Never turn a missing value, an empty list or a failed call into a confident "nothing found".
6. **Degraded output must be loud and refused downstream.**
   - If the model endpoint fails and the app falls back to canned text, label it on every message.
   - Every consumer must refuse it: findings, evals, briefings, memory.
   - The predecessor ran for weeks in a silent fallback mode that looked like real answers.
7. **Give exact-read tools for exact questions.**
   - A similarity ranker cannot answer "what is the latest", "list all" or "how many". In the predecessor, recency questions scored zero out of nine through ranking alone.
   - Provide list, read and newest-version tools.
8. **One execution path.** Every route into an agent goes through the same grants, gates and grounding. That includes playbooks, slash commands, background jobs and the team view. Side paths skipped the gates every time.
9. **The orchestrator is not a specialist.**
   - It never convenes itself, and it never synthesises its own answer.
   - Synthesis needs at least two independent contributions.
10. **Honour explicit routing deterministically.** "Bring in CMC and safety" must reach exactly those agents, before any keyword or LLM routing runs.
11. **Measure before you tune, and fix the measurement first.** Weeks of prompt tuning moved scores only within noise while the eval harness itself was broken.
12. **Freeze the corpus for every comparison.** One unchanged setup gave three different results (4%, 18%, 14%) within a few hours, because the index kept changing under it.
13. **Pair comparisons by case and test them against the noise.** A claimed improvement of +0.38 turned out to be one case moving. The rest were noise.
14. **The judge is a different model from the agent, and sees what the agent saw.** That means the brief, the tool results and the sources. A judge that couldn't see the brief called correct facts "unsupported" in most critiques.
15. **Fail fast on unusable answers.** Abort an eval after three fallback, blank or unscored answers in a row. Otherwise you grade canned text and get a plausible mean.
16. **Mutation-test every guard.** Several tests were green on the very bug they were meant to catch. Break the code on purpose and confirm the test goes red, with a positive control beside every negative check.
17. **Inject the date and time zone every turn, and freeze them in evals.** Models drift when they infer "today" from content. The known-outcome demo depends entirely on an as-of date.
18. **Use a real embedding model from the start.** It was the single biggest retrieval gain, roughly 7× on document-centred questions. Measure its noise floor before you set any similarity threshold.
19. **Never let an empty fetch overwrite the last good snapshot.** Mark truncation explicitly. Advance an ingest cursor only past records you have actually processed.
20. **Read strictly before writing.** "Unreadable" is not "empty". A corrupt file read as empty, then saved, wipes real data.
21. **Every exit path reaches a terminal state, and "partial" is a status.** Once the server has accepted a long operation, the client must not retry it. Retrying produced duplicate turns.
22. **The end of a tool budget gets an explicit "answer now" turn.** The answer must list what the agent could not read. Without that turn the model sometimes returned an empty answer.
23. **Escalation lines are not extras.** A concision edit silently halved how often agents said "have X review this". Name the lines that must never be cut, and check them after every prompt edit.
24. **Pinned facts come from the newest source.** Record provenance per fact, state a precedence rule, and report conflicts instead of reconciling them silently. A pinned plan seeded from a polished deck was three weeks out of date.
25. **Every confirmed failure becomes a regression case before any fix.** Add the case first, so the fix is measured.
26. **Ship small, then delete.** The predecessor cut about 1,900 lines of unused machinery. Start with one or two agents, and add each new one only with a test that proves it does something distinct.

---

## Part 2. The architecture map

| RAagents layer | What to build | Precedent in the predecessor | Label |
|---|---|---|---|
| Trust | Human-only accept route, actor stamps, audit log, data walls, as-of (temporal) wall, secrets hygiene | Propose-and-accept split, provenance tags, fenced untrusted text | ADAPT + NEW |
| Evidence and knowledge | Corpus releases, ingest pipeline, hybrid retrieval, exact reads, findings register, evidence checker | Retrieval stack, provenance gating, retrieval eval | ADAPT + NEW (register, checker) |
| Agent library | Agent specs as data, shared rules plus a per-agent brief, tool grants, model per agent | Config-driven personas, shared guardrail block, gated tools | KEEP |
| Orchestration | Deterministic activation, router, scoped sub-tasks, challenge pass, synthesis, budgets | Group discussion mode with routing, sub-agents and synthesis | ADAPT |
| Playbook | Playbook as data: questions, agents, sources, outputs, reserved decisions, autonomy | "Skills" that grant tools for one run | NEW |
| Human | Owners, review UI with per-item accept, plain-language quality page | Per-item accept on proposed changes, owner checklist | ADAPT |
| Evaluation (cross-cutting) | Agent eval, retrieval eval, known-outcome demo eval, checker eval | Full harness | KEEP + ADAPT |

**What the predecessor never had, which this app needs:**

- multiple users with roles;
- data walls, meaning per-user and per-agent visibility;
- an audit trail;
- a structured findings register;
- a playbook engine;
- autonomy levels enforced in code;
- human sign-off gates;
- explicit "checked: not applicable" entries.

**What to skip:** all personal-data integrations, all personal-productivity features, and the single-machine deployment setup.

### Stack and platform

- **The predecessor's stack worked well.** It used Next.js (App Router) with TypeScript and Vitest, and called the model with plain `fetch` to an OpenAI-compatible endpoint, with no vendor SDK. KEEP, or use any equivalent.
- **Use a real database from day one (ADAPT).**
  - The predecessor kept all state in JSON and JSONL files, with vectors in a separate file paired to metadata by line position. Nearly every storage failure came from that:
    - a partial rename left the two files out of step, and most of the corpus was searched with empty vectors for weeks without any error;
    - two writers sharing one temporary file name destroyed each other's work;
    - a full disk merged two records into one line.
  - This app is multi-user, needs per-workspace isolation and needs an audit trail. Use a transactional store with keyed vectors, for example Postgres with a vector extension, or SQLite with one.
  - Keep the good ideas: a single invalidation point for caches, memory-flat scoring, and logged cache decisions.
- **Tests are offline by default.**
  - The shared test setup removes every credential variable, so the model layer takes its deterministic offline path.
  - It replaces the global network call with one that throws. Code that needs the network takes an injected fetch function.
  - Tests that touch storage use a fresh temporary directory.
- **Structural tests that encode the architecture.** These were among the most valuable tests:
  - **writer allowlist:** walk the source tree and assert that only the human-confirm route can import the writer for a protected record. Decision rights become a test;
  - **client bundle:** walk the imports and prove that no browser-side module can reach agent prompts or the file system. A regex-based walker once failed open because a comment hid part of a file; use a real parser;
  - **supported formats:** pin the list of supported file types in both directions, server against UI;
  - **negative tests:** feed *valid* input and assert the guarded code path was actually reached. A "never writes" test once passed only because its mock input failed to parse before reaching the write.
- **Add CI.** The predecessor had none, so its guard tests ran only when someone remembered to run them.

---

## Part 3. Trust layer

### Human decisions and autonomy

- **Propose and accept are separate paths.** Agents can only *propose*, for example "submit finding" or "propose checklist change". Acceptance is a human action on an authenticated route.
  - Validate it strictly. In the predecessor, a typo, a missing field or a "reject" all counted as *approve*.
- **Agents never write human-owned fields.** These include status, owner, decision, and "accepted". Every item records *drafted by* (an agent and model) separately from *confirmed by* (a human).
  - A background job in the predecessor quietly rewrote a user's list every few minutes. No user-written title survived a cycle.
  - Add a test that only named modules may call each write function (a writer allowlist).
- **One owner per write path.** Each artifact has one writing agent or route. Others propose.
- **Autonomy levels map to tool grants (NEW).** Enforce them in code, not in the prompt:
  - **Level 1, Assist:** read tools only. Output is a draft for a human.
  - **Level 2, Collaborate:** may submit findings into the register as `draft`. A human accepts or rejects each one.
  - **Level 3, Delegate under oversight:** may set `checked` within named categories. Every action is audited, a random sample is reviewed by a human, and the level can be revoked automatically when quality drops.
  - **Promotion between levels** needs a passing eval gate on an accepted baseline, plus real-use metrics: acceptance rate, rejection reasons, and escalations honoured.
- **Human-reserved decisions** (deal-breakers, the overall assessment, the recommendation) have *no tool at all*. Agents cannot hold a tool that decides.

### Identity, roles and workspaces (NEW)

- **Per-user accounts with roles:** agent owner, playbook owner, decision owner, activator and reviewer. Check the role on every route and every tool.
  - The predecessor had one shared password and a signed session cookie.
  - Two parts of it are worth keeping: a server-side "session epoch" that revokes every session at once, and a check that runs on every API route.
- **One due diligence case is one workspace.** The workspace owns its sessions, findings, uploads, notes and the asset record. Every access checks membership.
  - Nothing crosses workspaces except the public corpus and learnings a human has approved for reuse.
  - Even with public sources only, the fact that an asset is under review can be confidential.
- **Tool context is bound by the caller, never by the model.** The caller sets the agent, workspace and grants, so a tool cannot be tricked into acting for someone else.
  - Missing grants must mean *no* gated tools. In the predecessor, an undefined grant list meant *all* gated tools.

### Audit trail (NEW)

For every agent action, log:

- the tool name, its arguments and its result;
- the model and route actually used;
- the prompt hash;
- the retrieved source IDs and versions;
- the user and the playbook run.

Append-only. Use this log to replay a finding.

The predecessor had two partial precedents:

- an audit log of logins only;
- a per-message "answer trace" storing the plan, steps, tool calls, citations, models used and the retrieval outcome. It was shown in a collapsible reasoning panel.

The trace recorded retrieval as either *ran, with hits* or *could not run, with a reason*. That made "nothing relevant" impossible to confuse with "search was down". Before this change, a silent embedding mismatch had removed all grounding from many answers.

Extend this into an immutable, exportable event log that covers every finding state change and every sign-off.

### Data walls and the temporal wall

- **Enforce walls in retrieval code, before ranking.** Filter what a user or agent may see before any similarity search, not after it, and never by prompt.
  - In the predecessor, hiding a document removed one protection but its text still reached a synthesis prompt.
  - "Confidential" was detected by title only, so a document with a confidential footer slipped through.
- **The as-of cutoff for the known-outcome demo is the same mechanism.** Every retrieved item must have `published_at` on or before the run date.
  - Test it like a security boundary.
  - Watch for any helper that appends "current" data. In the predecessor a rendering helper silently glued live data onto a frozen test fixture, which leaked hindsight.
  - No live web search in a known-outcome run.
- **Outbound query guard.** When a company runs this internally, internal project codes and titles must never reach an external search provider. Fail closed.

### Untrusted content

- **Public documents are untrusted input.** EPARs, review documents, label text and web pages can contain text that reads like instructions.
  - Wrap every external text block in a fence the model is told is data, using a per-call random marker.
  - Neutralise role markers and chat-template tokens inside it.
- **Fence your own restored state too.** Anything restored from a backup is written by something other than the app at run time.

### Web hardening that held up

- Errors sent to clients are generic, with a correlation ID. Raw provider errors are never shown.
- Rate limits are counted by client IP, taking the forwarded-for header from the right, by the number of trusted proxy hops. The left-most entry can be spoofed.
- Security headers, and a content security policy without `unsafe-eval` in production.
- Upload size caps.
- Prompts never reach the browser bundle, and a structural test (Part 2) proves it.

---

## Part 4. Evidence and knowledge layer

### 4.1 Public sources (access checked when this document was written)

| Source | Access | Notes |
|---|---|---|
| FDA labels, Drugs@FDA, Orange Book, recalls, shortages, adverse events | openFDA REST API (open.fda.gov). A key is optional. | Limits: 240 requests per minute; 1,000 per day without a key, 120,000 per day with a free key. Endpoints: drug label, drugsfda, orangebook, enforcement, drugshortages, event, ndc. |
| FDA inspections, inspection citations (483 observations), compliance actions, import refusals | FDA Data Dashboard API | Free registration issues an authorisation key. Requests are POST with a JSON body, at most 5,000 rows per response. |
| EMA medicines and EPARs, orphan designations, paediatric investigation plans, referrals, PSUSAs, DHPCs, shortages | Downloadable Excel tables, refreshed overnight, plus site-wide JSON data files | No dedicated API. Plan a downloader and change detection. |
| ClinicalTrials.gov | Modern REST API, version 2 (clinicaltrials.gov/api/v2) | Live, data refreshed daily. Rate limits and paging details: to verify. |
| FDA guidance documents | Searchable web list: title, issue date, draft or final, centre, topic, docket, comment close date | No API or export found. Needs a careful scraper, and draft-to-final supersession tracking. |
| Publications | PubMed and Europe PMC APIs | Access terms and limits: to verify. |
| ICH guidelines, EudraGMDP, other agencies (PMDA, NMPA and others) | Mostly web pages and PDFs | Per source: to verify. |

Keep a `sources.md` that records, for each source, the licence or terms of use, the rate limit, the update cadence, and the date you last checked it.

### 4.2 Corpus releases instead of a live index (ADAPT)

The predecessor's index changed every few minutes as ingest and pruning ran. That made every measurement unstable. Public regulatory sources change slowly, so use **immutable corpus releases**:

- A manifest per release. Each document records its ID, source, URL, version or revision, `published_at`, `retrieved_at`, content hash, chunker version and embedding model.
- Every eval result and every finding records the release ID.
- Never compare runs across releases without saying so.

**Document identity: use the official reference, not the title.**

- The predecessor derived a document ID from its title. For regulatory documents that fails in both directions:
  - a draft-to-final rename, or a "Rev. 1" title, splits one document into two;
  - identical titles from different agencies merge unrelated documents.
- Build a *family ID* from the authority plus its official reference: guidance or docket number, agency procedure number, guideline code.
- Each version records:
  - status: draft, final, withdrawn or superseded;
  - revision label;
  - published, effective and superseded dates;
  - what supersedes it;
  - authority, jurisdiction, product type and therapeutic area;
  - source URL, retrieval time and content hash.

**Keep the original files.** Text rebuilt from chunks is lossy: heading levels and blank sections disappear. For audit and quoting, keep the original bytes, the URL, the retrieval time and a checksum for every source.

**Structured sources are records, not prose.** Ingest the trial registry, inspection datasets, approval databases and warning-letter indexes field by field. Never split a record across chunks. In the predecessor, splitting record-shaped data on blank lines left most chunks without their identifying fields, and similarity scores roughly halved.

**Evidence classes.** Every chunk carries one:

| Class | Examples | Can support a finding? |
|---|---|---|
| Regulator primary | Guidance, review documents, assessment reports, labels | Yes |
| Registry or structured | Trial registry, inspection and enforcement datasets | Yes |
| Peer-reviewed | Publications | Yes, flagged as non-regulator |
| Company disclosure | Press releases, investor material | Only as an attributed claim |
| Secondary commentary | News, newsletters | No, leads only |
| Derived | Anything an agent wrote | Never |

"No source, no finding" then means: at least one regulator-primary or registry chunk, with its page or section, and a quote.

### 4.3 Ingestion

- **Progress markers advance only past records you have decided about.** A cursor that moved past filtered or failed records lost them permanently.
- **Pagination is a correctness issue.** A capped call returned a few hundred of well over a thousand records, with no warning. Check totals, and log "fetched N of M".
- **An empty or failed fetch never replaces the last good snapshot.** A non-200 response once produced "0 records, not truncated". Record `truncated` and `complete` explicitly.
- **Merge keys must be unique per record.** Keying on a series identifier collapsed many records into one. For regulatory data, one application number covers many supplements, letters and actions. Changing a key means rebuilding the store.
- **Versions and supersession.**
  - Guidance moves from draft to final, labels are revised, trial records are updated.
  - A new version does not remove old chunks by itself. The predecessor's index was about 99% superseded copies before pruning.
  - **Do not prune regulatory history.** The predecessor deleted old versions after every sync, and its index size swung back and forth within the hour.
    - For regulatory work, history is evidence. It shows what applied at submission time, and it is exactly what a known-outcome demo needs.
    - Keep every version with its status (draft, final, withdrawn, superseded). Retrieve current versions by default, and historical versions only on purpose. The as-of filter picks the version valid at the run date.
  - **Fold the chunker version into any duplicate-detection hash** computed over source text. Otherwise chunker improvements never reach documents that are already stored.
- **Draft and final must stay distinguishable everywhere.** Losing a status label once let an agent assert that a draft had been sent.
- **Dates per record and per section, not per document.** A per-document date made a recency boost useless across the many chunks of a long document. Add the invariant: every multi-chunk document has more than one distinct date where the source has them.
- **Items must update in place.** An add-only digest froze records at first capture. Trial records and labels change.
- **One source of truth for supported formats.** Copies of the format list drifted, and failures were hidden by log level. Report every skipped file with a reason.
- **Feeds.** Several verified feeds delivered zero items silently, because titles were in CDATA blocks or used an unexpected date tag. Ship each feed with a pass check, and deduplicate by item ID rather than by a shared link.
- **Structure markers inside text** (horizontal rules, headings) created phantom records. Treat in-body markers carefully when splitting.
- **Scripts must use the app's own configuration.** A one-off script ran with a different embedding model and wrote vectors of the wrong size, which disabled search for everyone. Run write operations through the app.
- **Fetch through a hardened, allowlisted client:**
  - https only, with a domain allowlist;
  - DNS resolution with private and reserved address blocks;
  - every redirect re-validated;
  - the connection pinned to the validated address, against DNS rebinding;
  - response size caps and typed failure reasons.
  Honour each site's terms and rate limits.
- **Coverage report after every ingest:**
  - reconcile the source listing against stored copies and the index;
  - name the reason for every missing or skipped item;
  - compute freshness from the data (the newest timestamp), never from the model;
  - report "coverage gap" separately from "stale".

### 4.4 Parsing and chunking

- **Always keep page numbers.** Review packages and EPARs are cited by page. The predecessor lost page numbers on some PDFs because it fell back to fixed-size parts.
- **Mark OCR text as OCR, with lower confidence.** OCR long scanned documents in a batch job with a generous time budget, and give every converter subprocess a hard timeout.
- **Word documents:** join text runs *without* adding spaces. Word splits words mid-way at formatting changes, and adding spaces produced broken words.
- **Chunk on the document's natural structure:** sections, headings and pages. Prefix each chunk with a compact context header: authority, document, section, page, date and status. In the predecessor, only the first chunk of a long scan carried its title.
  - FDA multi-discipline reviews and EPARs run to hundreds of pages.
  - Never ingest a whole package as one document. One document holding most of the corpus took the top result for half of all queries.
- **Tables need table-aware extraction.** Collapsing a spreadsheet produced a value from the right row but the wrong column. Label and CMC tables are dense.
- **Cap chunk size.** A single oversized chunk was buried by length normalisation, and the agent then said the document had "no substantive content".
- **Down-weight reference and bibliography sections.** They outranked the narrative text.
- **Round-trip test the chunker:** the reassembled text equals the source, ignoring whitespace. A regex bug once deleted every space in long paragraphs, and it looked like a bad model generation. Re-generating would have reproduced it.
- **A chunker fix is not retroactive.** Re-indexing re-embeds the existing chunks but does not re-chunk them. A chunking change needs a full re-ingest.
- **OCR locally where possible.** It is deterministic, testable offline and has no per-page cost. Scanned agenda pages that were images carried no text at all until they were OCR'd.
- **Attribute each change separately.** Two changes were each harmful alone and good together. Measure every change on its own.

### 4.5 Embedding and retrieval

- **Real embeddings from day one.** The predecessor started with a hashed bag-of-words fallback. Hash collisions made up 40% of its "matches", and its minimum score did nothing.
- **Dimension mismatch trap.** If the embedding settings are missing, the system can silently fall back to a different model with a different vector size. The result is zero grounding that looks like a total regression.
  - Assert that the vector size matches the index on every write and every query.
  - Never mix sizes in one index.
- **Batch APIs: check cardinality.** One embedding endpoint returned one vector for five inputs, with HTTP 200. Assert that the output length equals the input length.
- **Write paths fail, read paths degrade.**
  - Ingest must never substitute a fallback embedding. A re-index that lost the network halfway produced a mixed corpus that reported success.
  - A query may degrade, but the trace must say so.
  - Changing the embedding provider, model or size is a migration: re-index fully, then switch over.
- **Batch embeddings by tokens, not by item count,** and split and retry when the provider says the batch is too large. Vector memory is size × chunks × 4 bytes, so model size is a memory decision as well as a quality one.
- **Regulatory text is dense with codes,** such as guideline codes, procedure numbers and designation names.
  - Add a code-aware tokeniser pass, so a code like "E6(R3)" is not shredded.
  - Keep the lexical and embedding tokenisers identical, and pin that with a test.
- **Hard metadata filters, not score nudges.** Filter by authority, jurisdiction, product type, workspace, agent source allowlist and as-of date *before* scoring. The predecessor used small tag-based boosts, which never excluded anything.
- **Reserve result slots instead of tuning bonuses.** Giving "the newest chunk of each matched document" a reserved slot worked. A global bonus large enough to have an effect wrecked other results.
- **Hybrid retrieval:** vector search over-fetched (about 4×), re-ranked with BM25, and fused by **rank** (reciprocal rank fusion), not by normalised scores. Normalising scores manufactured confidence.
  - In one small test: recall@3 rose from 33% to 64%, recall@5 from 42% to 67%, and MRR from 0.32 to 0.49.
- **Let the lexical channel nominate candidates too,** using a focused query on rare terms. A re-ranker cannot find what the first stage never returned.
- **Invalidate the lexical index on every corpus change.** Use one corpus-generation counter. A stale BM25 index systematically buried the newest content. It healed on restart, which is why it passed live checks.
- **Per-document caps protect slots 2 to N, never slot 1.** Apply the cap after fusion.
  - The tell for a dominating document: high recall@5 with near-zero recall@1.
  - Fix it structurally (per-section documents), not with weight tweaks.
- **Never promote a result to rank one unconditionally.** A "best lexical hit goes first" step made seven configurations score identically. Reserving the *last* slot instead nearly doubled rank-one accuracy.
- **Thresholds belong to the embedding model.** Measure the noise floor with random query-document pairs (for example, the 90th percentile). A shipped threshold sat below the new model's whole noise band.
- **Snippet windows: centre them on the densest cluster of query terms,** not on the start of the chunk. Twice the answer sat just past a fixed head slice.
- **"Could not search" is not "found nothing".** A failed query embedding once returned an empty list, and the agent answered fluently with no grounding.
- **Know your result order.** Results are ordered by fused rank, not by score. The lexical channel can admit chunks below the vector similarity floor.

### 4.6 Exact reads and absence

- Give agents **list**, **read by ID or title**, and **newest version of X** tools alongside search.
  - Reads are paginated, and capped in chunks and characters.
  - An ambiguous title returns the candidates instead of a guess.
  - Each search result stays short, about 1,500 characters, so ten results fit in roughly 4,000 tokens.
- **Never claim a document is missing on the strength of a search.**
  - The predecessor's agents invented "not indexed" explanations when a ranker returned old passages.
  - Rule: list, then read, before stating absence. State an empty exact read as authoritative.
- The agent sees the tool's *output format*, not your database record. A field added to the record but not to the tool output stayed invisible. Verify against live tool output.

### 4.7 Findings register and the "no source, no finding" rule (NEW)

- **A finding is a typed record:**
  - claim;
  - evidence: a verbatim quote;
  - source: document ID, version, section or page, URL, `published_at`, chunk anchor;
  - confidence: a level plus a rationale;
  - assumptions;
  - owner: a human role;
  - status: draft, challenged, checked, escalated, accepted, rejected, or not applicable;
  - the playbook item it answers, and the agent and agent version that drafted it;
  - a stable ID that agents echo back.
- **"Checked: not applicable"** is its own typed entry.
- **One write path:** a `submit_finding` tool. The briefing renders only from the register. A claim without a source becomes an **open question**, never a finding.
- **Stable IDs.** Positional IDs paired unrelated items when diffing. Re-applying the same change once undid human approvals.
- **Deterministic evidence check, which blocks:**
  1. the cited document and version exist in the corpus release;
  2. the quote is a whitespace-normalised substring of the cited chunk;
  3. `published_at` is on or before the as-of date;
  4. the source is primary, never a finding, summary or briefing;
  5. superseded or draft versions are flagged;
  6. every required field is present.
- **Semantic evidence check:** an LLM checker on a *different* model from the author. It labels each claim supported, partial, unsupported or contradicted, and checks that confidence is proportionate.
- **Agent summaries of sources are derived.** An agent's EPAR summary is never evidence.
- **How derived content was handled:**
  - Derived items were kept, but always ranked after every primary result, and labelled in the prompt as the assistant's own earlier output, not to be cited.
  - A closed list of known derived types acted as a floor, so a writer could not declare its own output primary.
  - Provenance must not be inferred from how content arrived: one ingest channel carried both real transcripts and model text.
- **Challenges block verification.** The red team and the evidence checker raise structured challenges against finding IDs. A finding cannot reach `checked` or `accepted` while a challenge is open.
- **Reuse across cases.** Only human-confirmed findings may be reused in another case. Even then, they appear as a "prior finding", never as source evidence.
- **The briefing renders only from accepted findings,** through a validate, normalise, render path. Skipping the normalise step once silently dropped content from a generated document.
- **Company disclosures and press releases are claims, not facts.** Attribute them, and flag self-interested statements.
- **Lessons-learned or "memory" stores need the same provenance.** The predecessor's memory kept both a wrong statement and its later correction, with nothing to say which one won. Its first fix let an agent demote a human's note, which opened a new laundering channel. Only a human can supersede a human-written note.

---

## Part 5. Agent library

### Agent specification

Keep agents as data. The repo template's fields are role, knowledge sources, tools, guardrails, human owner and autonomy level. Implementation fields that proved useful:

- model route, pinned per agent;
- routing tags;
- handoff targets, narrowed at load time to the active roster;
- an `active` flag;
- which context blocks the agent receives;
- tool grants, needed only for tools that write or have side effects.

**The registry must refuse inactive agents.** Retired agents kept answering through old shortcuts that still pointed at them.

**Add to each agent spec** (ADAPT):

- `human_owner`;
- `autonomy_level`, per agent and playbook;
- `source_allowlist`, a hard filter on what the agent may retrieve;
- `version`. Every finding records the agent version that produced it.

**Keep every per-agent setting in the one spec.** In the predecessor, one setting lived in a second file, so any new agent of that kind needed a second edit that people forgot.

### Prompt structure

- **Prompt = the agent's brief + one shared rules block.** Shared rules that held up well:
  - put the recommendation at the top;
  - give a usable answer before asking anything, and keep follow-up questions to a minimum;
  - calibrate certainty;
  - tag illustrative placeholders inline;
  - no made-up statistics or benchmarks: point to real examples that can be checked;
  - say who decides;
  - name a human reviewer for regulatory, legal or external items;
  - list and read before claiming absence;
  - out of remit, name the right teammate.
- **State rule precedence explicitly.** A shared rule to keep interim replies brief beat one agent's instruction to always produce the finished output. That agent then handed back plans instead of results. Put the precedence rule in that agent's brief.
- **Editing the shared block changes every agent's prompt.** Every baseline must then be re-measured. Prefer per-agent fixes, and keep shared-block changes deliberate and measured fleet-wide.
- **Fence a rule to its context.** A fix for one situation leaked into a write path, and the agent began offering to save drafts full of placeholders. Give each rule its own paragraph, and add a test.
- **Avoid status words as evidence labels.** A "[confirmed]" label beside "the date is not confirmed" read as a contradiction. In regulatory work, "confirmed", "approved" and "accepted" are content words. Use neutral labels such as "[sourced]".
- **Don't put a forbidden token in front of the model.** "Never write [X]" seeds X.
- **Never demand citations from an agent with no retrieval tool.** It invented URLs, titles and dates. Removing that instruction raised one agent's score from 3.7 to 4.6.
- **Tool descriptions should state what the agent cannot do,** for example "no tool can accept a finding". Agents then gave honest one-line refusals.
- **Keep prompt claims in sync with real capabilities.** Agents denied features that existed, and claimed features they did not have. Pin prompt lines against code with tests.
- **Placeholders are fine; invented numbers are not.** A made-up percentage labelled as illustrative still lends the *shape* of evidence. This matters directly for PTRS inputs.
- **Unconditional persona habits** ("always open with X") produced long, off-topic answers. Make habits conditional on the question.

### Tools

- **Coerce common argument shapes, and match keys tolerantly.** Strict schema failures used up tool rounds. Each failed call cost one round of a limited budget.
- **Return effects, not intentions:** "wrote 3 of 3 items", not "done". Refuse empty payloads.
- **A playbook or skill run can grant tools for its duration.** A skill with no grants cannot read documents. Grant read tools deliberately.

---

## Part 6. Orchestration

Mapped to the agreed workflow: plan → assign → assess → challenge → combine → escalate → decide → learn.

- **Plan and assign.**
  - Explicit activation runs first and is deterministic.
  - A name needs a request verb: "ask the CMC agent" is a summons, while "the CMC agent suggested" is a report.
  - "Bring in the team" routes on the subject of the *previous* turn.
  - Then keyword routing; then, optionally, an LLM planner behind a flag.
- **Regulatory acronyms collide in keyword routing.** "ema" matched inside "email". "ich" and "bla" are ordinary words in other languages. "NDA" also means non-disclosure agreement. "ai" matched inside "detail".
  - Match regulatory acronyms case-sensitively and on word boundaries.
  - Routing also decides which tools and data are exposed, so a mis-route is a trust issue, not just a quality issue.
- **Router order is policy.** Picks were taken in order and capped at three. A specialist checked last was never reached.
- **For playbooks, assign deterministically instead of routing by keyword (ADAPT).**
  - Each checklist item names its owning agent.
  - Due diligence workstreams are independent, so fan them out in parallel.
  - Keyword routing is for free-form questions only.
- **Assess.** Sub-agents receive a scoped task plus shared grounding, not the whole chat history. They return a short, bounded list of points within their own remit. One shared retrieval per turn, not one per agent.
- **The primary agent answers first.** Secondary agents then run in parallel and see its output. They add only a correction, a concrete consequence or a missed risk.
- **"Nothing to add" is a valid answer.** A secondary agent with nothing material replies with an exact "nothing to add" signal. It is filtered from the output but still recorded in the trace. This keeps noise down.
- **Sub-agents get the same tool grants they have when working alone.** One omission made a specialist's required tool unreachable in team mode.
- **Challengers produce structured output.** The red team, the evidence checker and the question generator work on findings and return challenges, open questions and verdicts tied to finding IDs, not prose.
- **Challenge.** The red team is a distinct agent and pass, and it never grades its own work. A debate round is expensive: gate it, and budget it.
- **Combine.**
  - Skip synthesis below two contributions.
  - Tell the synthesiser the contributions have already been shown. It should add only the call, the conflicts and how they were resolved, two to four next actions with owners, and the key risks.
  - A plain "synthesise these" prompt produced a longer paraphrase.
- **Citations.** Deduplicate on document + version + chunk, never on title, because titles collide. Shared answer objects passed by reference duplicated citations once per consumer.
- **Budgets.** One team turn once took 8 model calls and over 100 seconds. Defaults that fixed it: heuristic routing, a single retrieval, and debate turned off, which brought it to about 4 calls per turn. Pin the budget with a test.
- **End of tool budget.**
  - When an agent runs out of research steps, send an explicit turn: answer now from what you have, and list what you did not manage to read.
  - Simply removing the tools, or forcing "no tool use", returned empty answers in two of three runs, and in three of three.
  - The explicit turn produced zero empty answers. The "could not read" list feeds open questions.
- **Escalate and decide.** Escalation is a typed output: a finding status of `escalated`, the named function or expert, a reason and a due date. It is never just a sentence in the answer, and never an agent decision. The predecessor only had a prompt line for this, so its escalations could not be tracked.
- **Learn.** Lessons from a run go into a derived store, never into the evidence corpus.

---

## Part 7. Playbooks and the human layer

- **Playbook as data (NEW):**
  - key questions;
  - the checklist, with expected "not applicable" items;
  - agents and their autonomy level;
  - allowed sources and corpus release;
  - required outputs;
  - human-reserved decisions;
  - owners.
  The engine reads it; agents stay separate. The scalability test in `CLAUDE.md` (a new use case needs only a playbook and a few agents) then becomes checkable.
- **Pinned state, such as current guidance versions or programme facts, needs the newest source.**
  - Order sources by date, not by how official they look.
  - Record provenance per fact, and state a precedence rule in the prompt.
  - Report conflicts.
  - Never infer "done" because a date has passed.
- **Review UI:**
  - a diff with per-item accept, pre-selected where sensible;
  - plain-language verdicts;
  - "Unknown" shown as unknown, never as "off";
  - explicit loading, error and empty states;
  - nothing hidden without a visible sign.
- **A reasoning panel.** Each answer has a collapsible panel showing:
  - the plan and steps;
  - the tool calls;
  - the citations, with their evidence class;
  - the models used, including fallback or partial status.
  Reviewers trust what they can inspect.
- **Rich cards only from successful results.** A card for a finding or document renders only when the tool returned success and every required field is present.
- **Bounded slots, with code-rendered facts.** For summaries such as a case status line, the model fills a few short slots, and code renders the facts from the data. If the model fails, a fallback built from the data renders instead. The model cannot invent a deadline or an item.
- **An unconfirmed-draft badge.** Items drafted by an agent carry a visible badge until a human keeps or changes them. A save the agent started never marks items as human-confirmed.
- **Page context ("what I'm looking at")** goes in as a fenced user message just before the question. Not as a system message, and not after the question, where it would be saved as the question.
- **Quality page for non-technical leads:**
  - one verdict line per agent;
  - never round a score up onto a target (4.17 shows as 4.1);
  - "not checked" is distinct from "met";
  - thresholds read from the same constants the gate uses.
- **Feedback loop:**
  - At most two positive examples are replayed.
  - When a user rates an answer down, only their reason or correction is reused. The rejected answer itself is never shown to the model again.
  - Feedback is fenced as untrusted, can never be used as evidence, and cannot change permissions.
- **Real-use signals, each with its sample size:**
  - thumbs-down rate over the last 20 and 100 ratings, alerting above 20% once there are at least 10 ratings;
  - fallback rate;
  - tool error rate;
  - citation rate;
  - latency.

---

## Part 8. Model connection and reliability

### Connecting to a model

- **Use an OpenAI-compatible chat-completions client** with streaming and tool calls. Most gateways and providers accept that format.
  - The predecessor first spoke a different provider format to a gateway that only accepted chat completions. Every call failed, and no credential fix could ever have worked.
- **Configuration comes from environment variables only:** `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`, plus an optional `LLM_JUDGE_MODEL`.
  - Keep secrets in a git-ignored `.env` file locally, or in the cloud environment's secret store. Never put them in the repo, a fixture or a log.
  - Namespace your variables. A developer tool exported generic provider variables into the shell, and dotenv loaders leave existing variables untouched. Runs then behaved differently depending on how they were launched.
- **No default endpoint.** If the endpoint or key is missing, the app must refuse to call a model and say so. A built-in default is how traffic silently goes somewhere you didn't intend. Treat placeholder keys such as "changeme", "dummy" and "none" as missing.
- **Pin exact model versions,** not "latest" aliases. Give each background workload its own route (summarise, plan, synthesise, extract, judge), each with an output-token limit and an explicit ordered fallback list.
- **Day-one smoke test,** to run after every config change. Probe a plain answer, a tool call, streaming and, if used, document vision. Assert that each one is a real model answer and not the fallback.
- **Read the error body.**
  - A listed model is not necessarily an entitled model. One route returned an error for two weeks while diagnosis chased the wrong theory, because the code threw away the body that explained it.
  - Parameter names differ between backends.
  - Remember permanent failures, such as model-not-available, per process. Don't remember timeouts.
- **Fallback chains must not silently downgrade the model generation.** Test that every path stays on a current generation, and that a terminal fallback exists.
- **A configured but never-exercised model tier is probably broken.** Use only routes you have verified.
- **Retry policy that held up:**
  - at most 3 attempts, with short backoff and random jitter, because parallel agents otherwise retry at the same moment;
  - a total sleep budget of a few seconds;
  - a hard deadline of about 2 minutes, including reading the body;
  - retry only timeouts, rate limits, server errors and connection resets, checked through the whole error-cause chain;
  - never retry DNS or TLS failures, which are permanent;
  - honour `Retry-After`, and give up honestly if it exceeds the budget.
- **Fall back to another model only before any tool call or streamed text.** Never replay a side-effecting tool on a second model. If a stream breaks after the first token, keep the text and mark the answer partial.
- **Tool loop:**
  - a fixed round limit (the predecessor used 6);
  - malformed arguments, unknown tools and tool exceptions all come back to the model as error text;
  - the turn never dies because of a tool.

### Failure handling

- **Output caps.** Any task that copies or extracts *everything* is bounded by the output token cap, not the input window. A transcript clean-up silently lost 29% of its text.
  - Check `finish_reason` on every call.
  - Chunk the work, and map-reduce long documents.
  - This matters for "extract every finding from a 300-page review".
- **Validate outgoing message shape.** One empty user message in a replayed history made the provider reject every later request in that conversation.
  - Show request errors differently from outages. A "connectivity" banner on a request error convinced the user their access was broken.
- **Terminal states.**
  - Every stream ends with done or error.
  - Calls have a wall-clock deadline.
  - A stream that fails after emitting tokens is reported as partial.
  - Never re-send a whole request in the middle of a stream: it rendered answers twice.
- **Durable long runs.** A due-diligence run will outlive a browser tab.
  - Once the server returns success with a body, it owns the operation, and the client must not retry. A long-standing client retry turned into duplicate turns as soon as turns survived disconnects.
  - Reconcile jobs left by a previous process at start-up, and prune finished jobs.
  - Stream with server-sent events. When the browser disconnects, stop writing to it but let the run continue to completion and save its result. Closing a tab used to throw away paid-for work.
  - Release counters and locks in a `finally` block. A leaked "turn active" counter once switched off background work permanently.
  - Cap concurrent background jobs (the predecessor used 2) so they cannot starve interactive use.
  - Run post-answer side effects only after the stream has closed, each one guarded.
- **Context packing:**
  - measure the fixed blocks before you set the budget;
  - keep the last few turns verbatim, and summarise older ones;
  - if the summary fails, insert an explicit "context gap: N turns missing" note instead of fake history;
  - give a file-only turn a text line naming the attached files.
- **Concurrency.** Read-modify-write races were rediscovered about eight times. Build one shared write primitive from the start:
  - strict read;
  - a lock with an owner token and a heartbeat;
  - unique temporary file names;
  - atomic rename;
  - post operations, not whole arrays.
  Concurrent agents writing one findings register will hit this on day one.
- **Partial salvage.** A failed chunk becomes a visible gap marker. Fail the whole job when nothing succeeded or when half or more failed. Every subprocess gets a hard timeout.
- **No silent success.** Six separate paths in the predecessor reported success when they had failed. One returned HTTP 200 over more than a hundred logged failures.

### Time

The predecessor shipped at least seven time bugs:

- wrong time zones;
- UTC shown as local time;
- a whole day off near midnight;
- date-only values treated as overdue in the early morning;
- a date string without a year parsed into the wrong century.

Rules:

- Inject today's date and time zone every turn.
- Spell out month names, because "07/08" is ambiguous to a model.
- Treat FDA (US) and EMA (EU) date conventions, effective dates and clock stops as a correctness domain with its own tests.

---

## Part 9. Evaluation

### 9.1 Principles

- **Fix the measurement before the agent.** Several apparent agent weaknesses were harness defects:
  - truncated fragments scored as answers;
  - a judge that couldn't see the brief;
  - stand-in tools with empty schemas;
  - fixtures missing context the agent always has in production.
- **The agent eval cannot see retrieval quality.** It would score a confidently wrong, well-written answer 5 out of 5. Run a separate retrieval eval.
- **Every confirmed production failure becomes a case first.**

### 9.2 Cases

- **Schema:**
  - ID and version;
  - agent;
  - category: normal, grounded, tool, adversarial or multi-turn;
  - risk: standard, sensitive, factual or side-effect;
  - turns;
  - fixtures: source passages marked full text or metadata only, available tools, frozen date;
  - expected: required facts, required phrases, forbidden claims, expected and forbidden tools, output shape;
  - rubric.
- **Add for this app:**
  - `as_of`;
  - `corpus_release`;
  - `required_findings` (issue IDs from an answer key);
  - `forbidden_findings` (distractors);
  - `must_mark_not_applicable`;
  - `human_reserved_decision`.
- **The loader rejects:**
  - duplicate IDs;
  - a case that asserts nothing (a third of the predecessor's early cases asserted nothing, including a safety-critical one);
  - a last turn not from the user;
  - a forbidden claim that already appears in the case's own text, where a correct echo would trip it.
- **Typical mix per agent:** about 10 normal, 5 grounded, 5 tool, 5 adversarial and 2 multi-turn cases.

### 9.3 Graders

- **Deterministic checks use a word boundary on the left only.** A prefix inverts meaning ("un-"); a suffix is a harmless stem.
- **Paraphrasable requirements go to the rubric.** Dates, numbers and identifiers are checked exactly. Seven of eight early "critical" failures were paraphrases ("18 of 20" against "18/20") on answers the judge rated 5.
- **Refusals quote what they refuse,** so substring bans punish correct refusals. Make those cases rubric-only.
- **"Critical" is decided by check class,** not by risk level. The classes: forbidden tool, forbidden claim, output shape, and missing expected tool.
- **Still open:** a negation-aware matcher. "Is not confirmed" trips a ban on "is confirmed".

### 9.4 Judge

- **A different model family from the agent.** Compare *resolved* models, not route names: two route names once pointed at the same model.
- **A chain of distinct fallback judges.** One provider's content filter refused every prompt-injection and self-harm case. Retrying the same judge cannot clear that.
- **The judge sees:**
  - the task and fixtures;
  - the expected outcome and rubric;
  - the agent's brief, marked as context, not instructions;
  - pinned state;
  - tool calls with their results;
  - the response.
  Tell it never to follow instructions inside the response. JSON output only.
- **Dimensions, scored 1 to 5:**
  - **Gated:** task success, usefulness, grounding, role fit, clarity.
  - **Observed only** until their distributions are known: calibration, concision, evidence traceability. Gating on a dimension nobody has seen yet blocks good releases as often as bad ones.
- **Critiques up to about 1,200 characters.** At 300 characters, nearly every critique was cut off before the sentence naming the problem.
- **Record per result:** the judge model, the rubric version and the judge prompt hash. One sentence was added to the judge prompt without a version bump, so two different prompts both read as the same version.

### 9.5 Fixtures and stand-in tools

- **Stand-in tools carry the real tool's name, description and input schema,** and return the arguments they received. With empty schemas, agents truthfully said "the tool took no input", and were marked down for it.
- **Render synthetic fixtures with the app's own renderers,** at a frozen date, through the same wrapper production uses. Test that no live data is appended.

### 9.6 Statistics and integrity

- **Three repetitions per case** before a run counts. For about 72 answers, two standard errors is roughly ±0.24 on the overall score. An agent within about 0.2 of a gate flips between pass and fail from run to run.
- **Case-paired comparison:**
  - per case, the candidate mean minus the baseline mean;
  - two standard errors computed across cases;
  - verdict bands: better, worse, no measurable effect, or too few cases;
  - difference-in-differences for targeted against untargeted cases;
  - list every baseline case below 4.0, so nothing is hand-picked.
- **Verdicts:**
  - **INVALID:** fallback, blank or unscored answers; mixed rubrics; an undeclared input difference; different judges on paired cases.
  - **UNVERIFIABLE:** no provenance, or uncommitted code.
  - **PASS.**
- **Fail fast:** three unusable answers in a row abort the run, nothing is saved, and the exit is non-zero. A response with no choices must count as unusable, not as an empty string.
- **Fingerprint every run:**
  - hashes of the full prompt, the tool grants, the answering route, and the case content (fixtures included);
  - the code commit, plus a dirty flag;
  - the judge prompt hash.
  A missing field reads as unverifiable, never as equal. Record the commit at the *start* of the run.
- **Offline tools:**
  - **Regrade** re-runs the deterministic checks on stored answers, in seconds and for free.
  - **Rejudge** re-scores stored answers under a new brief, to separate a change in grading criteria from a change in behaviour.
  - Keep held-out cases you never edit towards.
- **Machine load changes results.** Avoid other heavy jobs during measurement windows.

### 9.7 Release gate (starting points, tune once you have data)

- 100% deterministic pass rate and zero critical failures;
- subjective mean of at least 4.2, and each gated dimension at least 4.0;
- at least 90% "good" answers, meaning every deterministic check passed and overall is at least 4;
- no gated dimension regressing by more than 0.2;
- 95th-percentile latency no more than 30% worse;
- zero fallback answers, and full judge coverage;
- a changed case suite blocks comparison when a baseline exists.

### 9.8 Review queue

**Reasons an answer enters the queue:**

- a critical failure;
- risky output changed;
- a tool call changed;
- a score regression of at least 0.2 on a case;
- graders disagree (deterministic fail, judge at least 4);
- unstable across repetitions;
- low judge score;
- a truncated response, detected as low task success with no final punctuation;
- a random sample of about 10%.

**Rules:**

- **The candidate** is the newest real run with at least three repetitions that matches the live configuration.
- **Accept** only when nothing blocks. A critical deterministic failure blocks even if the reviewer likes the prose.
- **Archive before cleaning up,** and read strictly. The predecessor's queue once held over 400 stale items.

### 9.9 Retrieval eval over corpus releases

- **Gold cases:** a question, paraphrases, the expected source document and section, an answer pattern, and "poison" anchors.
  - Resolve gold by an anchor substring that includes the section label, never by chunk ID, which changes on re-ingest.
  - Fail loudly when an anchor doesn't resolve.
- **Metrics:**
  - recall@1, 3, 5, 10 and 20, at both document and passage level;
  - MRR;
  - poison@1, and poison ranked before gold;
  - context size;
  - for "no answer exists" cases, the abstain rate.
  Run at the production depth and at a deeper one. A per-document cap means the deeper run is not a superset of the shallow one.
- **Paraphrases are the honest metric.** The primary query usually reuses the source's wording and passes lexically. Cover agency jargon against plain language, and acronyms: BTD, PRIME, CRL, REMS, PIP and similar.
- **Poison anchors suited to regulatory work:**
  - a superseded or draft guidance against the final;
  - a withdrawn guidance;
  - a similar EPAR for another product;
  - a press-release claim against the agency's review finding;
  - an older trial-record version.
- **leak@k = 0.** Any retrieved document dated after the as-of date is a hard fail.
- **Archetypes:**
  - designation and eligibility;
  - regional difference (FDA, EMA, PMDA, NMPA);
  - CMC or inspection history;
  - safety and label;
  - clinical design;
  - **null**, where the agent must abstain.
- **Discipline:**
  - Freeze the corpus.
  - Cache query vectors, keyed by text, model and size, and never cache an empty vector.
  - Run the same configuration twice and confirm byte-identical output before trusting any comparison.
  - Recall moves in steps of 1/N.
  - If changing a setting never changes any result, the setting is probably not wired in.
- **Assert on what the model sees.** Check the tool output after snippet truncation, not just the index.
- **Mine candidate cases from the corpus for human review.** Never write them straight into the gold set. Verify each case against the primary source, not the index.

### 9.10 The known-outcome due diligence demo as an eval

1. **Choose 3 to 5 public assets** whose regulatory outcome, and the issue behind it, are publicly documented. The team chooses and verifies them.
   - Possible types: a complete response or refusal citing CMC or facility issues, a negative opinion or withdrawal, an approval with heavy post-marketing commitments, a clinical hold.
   - Keep development assets, used for tuning, apart from held-out demo assets that are never tuned on.
2. **Write the answer key before any run.** An RA expert writes it from post-outcome documents:
   - (a) issues *findable* before the outcome, each with its supporting public evidence;
   - (b) issues *not findable* before the outcome, which are reported but excluded from recall;
   - (c) distractors;
   - (d) checklist items that should be "not applicable".
3. **Freeze the inputs:**
   - the corpus release filtered to the as-of date;
   - trial records and inspection records as of that date;
   - fingerprints for the prompts and the playbook.
4. **Control contamination.** The model may already know the outcome from its training data.
   - Run a probe with no corpus: "what happened to asset X?"
   - Prefer outcomes after the model's knowledge cutoff, or pseudonymise the asset and sponsor.
   - Add forbidden claims for post-outcome facts.
   - Hold leak@k at zero.
5. **Score over three repetitions:**
   - issue recall, per issue (found in k of 3 runs);
   - finding precision;
   - distractor false-alarm rate;
   - checklist coverage, including explicit "not applicable";
   - evidence-checker pass rate;
   - time to briefing.
6. **Present honestly:** "Found X of the Y issues findable at the time. Missed Z, and here is why. N unsupported findings were rejected by the evidence checker. W issues were not findable at the time."
   - If the live demo falls back to a pre-recorded run, label it as pre-recorded.

### 9.11 Measuring the evidence checker

- **Seed a labelled defect set:**
  - a fabricated citation;
  - the wrong version;
  - a quote that doesn't support the claim;
  - a source after the cutoff;
  - self-citation of a finding;
  - a claim in the prose with no finding behind it.
- **Report** the checker's catch rate on seeded defects, and its false-reject rate on good findings.
- **Mutation-test the validators.** Remove one check, and confirm a test fails.
- **Also report:**
  - the structural pass rate, which is 100% by construction for the briefing;
  - the support rate against a human-labelled sample;
  - the unsupported-claim rate in the briefing prose;
  - fabricated citations, with a target of zero.

### 9.12 Metrics for stakeholders

- **Issue recall** on known-outcome assets, listing every miss. Validation on past real due diligence stays inside each company and never enters this repo.
- **Traceability:** the share of findings with a verified source and quote. Fabricated citations and leakage both zero.
- **Coverage:** checklist completion, including explicit "not applicable", and the functions brought in.
- **Speed:** time to the first structured briefing, against a human-only side-by-side pilot.
- **Human effort:** review minutes per finding, acceptance and rejection rates, and the cost of maintaining the agents, counted honestly.
- **Safety:** zero agent decisions on reserved items, and the escalation line present on every sensitive output.
- **Stability:** the share of findings reproduced in three of three runs. Quote every change with its uncertainty, and never claim a gain inside the noise.

---

## Part 10. Security

- **Treat public documents as hostile input:**
  - fence their text (Part 3);
  - parse PDFs and office files with size limits and timeouts;
  - guard against regex backtracking (one tag-matching regex took about 50 seconds on a 1 MB file);
  - guard against zip bombs and archive headers that lie about size;
  - run document converters in their safe modes.
- **Crawling public sites:**
  - an SSRF guard that also blocks IPv4-mapped IPv6 spellings;
  - confirm in the *production* build that the safe fetcher is really in use (a dependency failed to resolve there, and code silently fell back to a plain fetch);
  - respect rate limits and terms;
  - no credentialed scraping or paywall bypass;
  - metadata-only leads are not evidence.
- **Secrets:**
  - git-ignored env files or the cloud secret store only;
  - check file permissions (a token file sat world-readable for weeks while everyone believed it was encrypted);
  - never swallow a permission-change error;
  - losing an encryption key showed up as "never connected", not as an error, so make that failure explicit.
- **Real data in a public repo:**
  - A sub-agent once staged a gold set containing real people's names for commit.
  - Use an automated pre-commit guard. Trust is not enough.
  - Add a test that checks fixtures against a git-ignored list of protected names, stored as hashes.
- **Run a security review** before the repo or the demo becomes public-facing.

---

## Part 11. Development workflow with Claude Code

### Orientation documents

- **`ORIENTATION.md`:** start here. It holds:
  - the first ten minutes of commands;
  - the reading order;
  - non-negotiable invariants;
  - a symptom-to-first-move table that sends you to the data before the prompt;
  - the checks to run before claiming something is done;
  - a **"facts that expire"** table: fact, recorded value, the command that re-checks it, and the date checked. Prefer the command over the recorded value.
  - Suggested rows: agent roster count, demo assets chosen, model provider, test baseline, per-agent eval baseline, and the public sources with their terms.
- **`AGENTS.md`** for non-Claude agents: one line pointing to `CLAUDE.md` and `ORIENTATION.md`. Whether the cloud environment's own agent reads it: to verify.
- **Terminology:** "agents" means the product's agents. Claude Code helper agents get a `dev-` prefix.
- **Docs drift.** The predecessor's secondary guide described an older roster and an index twice its real size. Keep one authoritative orientation file and say so in the others.

### The loop that worked

1. **Probe.** Read-only research agents, each finding challenged by a second agent, then a synthesised plan.
2. **Brief.** A shared brief holds the rules for every designer: read-only; cite only what you read; tag each claim verified or inferred; the owner's fixed decisions. Per-workstream briefs hold verified facts, the tests that pin current behaviour, the ask, and the areas other workstreams touch.
3. **Design.** One read-only designer per workstream. Use a fixed schema: steps with test-first tests, files touched, shared hotspots, risks, failure visibility, verification, dependencies and effort.
4. **Adversarial review of each design.** A verdict, problems with evidence and fixes, missing tests, conflicts, and corrected effort.
   - One review found 26 problems and raised the estimate by half.
   - It also found a test that passed vacuously, and app-written summaries passing as primary evidence.
5. **Plan approval** by the owner (already a repo rule).
6. **Build** on a feature branch or isolated worktree, test-first. Each test must go red *for the stated reason*, not because of an import error.
7. **Three-lens review in parallel:**
   - correctness and silent failures;
   - test strength, by mutating a copy and proving the tests go red;
   - stakeholder-facing text and states.
   Reviewers report only verified findings, as blocker, should-fix or nit, and say SHIP if the work is sound.
8. **Verify.** A read-only pass checks that each finding is resolved, or declined for a reason that holds, then re-runs every gate.
9. **Commit**, then **ask before push or merge**. The predecessor learned this the hard way: a merge without explicit go-ahead was blocked. Audits deliver a pull request, not a merge.
10. **Live verify** with written pass, inconclusive and fail criteria. A fallback result is *inconclusive*, never a pass. Outputs are counts only, never real content.

### Habits that paid off

- **Phase gate:** typecheck, tests, lint and production build, plus the evals when agents or retrieval change. Only the production build caught a client/server boundary violation.
- **Tests run offline:** strip credential variables, block network calls, use temporary data directories and synthetic fixtures only.
- **Diagnose before fixing:**
  - inspect the raw source export first;
  - sample an intermittent failure several times before concluding;
  - replay the query and read what retrieval returned.
  The predecessor recorded more than fifteen confident diagnoses that were later disproved.
- **Lens-diverse adversarial review before merge.** Diversify the reviewers by job: a data-against-primary-source lens, a mutation lens, and others. Give each finding to several sceptics, and expect about half to be refuted. That is the mechanism working.
- **Cite test names, not line numbers.** Line references went stale as parallel branches moved.
- **Smaller agent outputs.** Large single replies from helper agents died with "connection lost". Write multi-file reports of a few KB each.
- **A status line at the end of every session:** WORKING, BLOCKED or DONE. "Waiting on you" is always visible. DONE means verified.
- **Session memory notes:** one lesson each, with *why* and *how to apply*, and explicit corrections when a note turns out wrong.
- **Isolate concurrent work in separate worktrees, outside the repo folder.** Worktrees inside the repo inflated lint from 0 to thousands of errors. With Next.js, symlinking `node_modules` into a worktree broke the production build; copy it instead.

### Browser verification of the demo UI

- Use Playwright. Save the logged-in state while the window is still open, so verification costs one login or none.
- Never wait for "network idle": background sync requests can keep the network busy. Wait for hydration and for the element you need.
- A streaming reply keeps the message *count* constant while its text grows. Wait on the app's "busy" state, not on the count.
- Chat pages keep their whole history in the page. Assert only on messages added after your question.
- Assert persistence through the API, not through the page.

### Deploy health

- Never trust a deploy script's own success message. Healthy means:
  - HTTP 200;
  - a live process;
  - an error count flat against a pre-deploy baseline;
  - a build ID newer than the merge.
- Check again after a delay. One service dropped about ten minutes after a healthy deploy.
- Keep the deploy checkout on the main branch. A branch whose upstream was deleted silently rebuilt stale code.

### Claude Code setup for this repo (local and cloud)

- **User-scope skills don't exist in a fresh cloud environment.** Anything the cloud sessions need must be committed under `.claude/`, or installed by an environment task.
  - Project-level plugin settings alone may not install plugins in a cloud session: to verify against the current Claude Code docs.
- **Skills worth rebuilding in `.claude/skills/`.** Write each one fresh and company-neutral. Do not copy the predecessor's originals, which refer to that app throughout.
  - **retrieval-quality**, merged with the measurement rig in Part 9.9: frozen corpus, cached query vectors, anchors, paraphrases, null and poison cases. It maps directly onto "no source, no finding".
  - **agent-eval**, new, written from Part 9.
  - **repo-remediation:** batch fixes on an isolated worktree with one helper per set of separate files, a single verification pass, and a pull request that is not merged. Shared contracts go into every helper's prompt, or the work goes serial.
  - **status:** writes `outputs/STATUS.md` with ✅ ◐ ☐ ⛔.
  - **verify-ui**, once the demo UI exists. In the cloud, use Playwright's bundled Chromium.
  - **demo-ready**, new, for month 3: run the demo, prove health, label any fallback, and keep a pre-recorded backup.
- **Helper agents for `.claude/agents/`:**
  - `dev-designer`;
  - `dev-adversarial-reviewer`, with a lens parameter;
  - `dev-source-fidelity`, which traces every claim to a source or marks it "to verify";
  - `dev-confidentiality-screen`, which checks for names, companies, proprietary content and third-party copyright before each commit and push;
  - `dev-verifier`.
- **`.claude/settings.json`,** with no secrets and no hosts:
  - deny reading `inputs/confidential/`, `.env*` and secret folders;
  - deny editing `inputs/`;
  - ask before `git push`, merges and branch deletion;
  - a pre-commit hook that refuses staged files under `inputs/confidential/` or audio files, and greps the staged diff against a **git-ignored** local deny-list.
- **Install shared tooling from an environment task, at pinned versions:** process skills (planning, test-first, debugging, verification), code-review agents and a security scan. Exact identifiers: to verify.

---

## Part 12. Wrong turns that cost the most time

1. **Weeks in silent fallback mode.** The causes were the wrong wire format, shadowed variables, and a network-restricted endpoint. *Avoid:* a day-one smoke test that asserts real output, and a visible fallback badge.
2. **Tuning retrieval on a weak embedder with magic numbers.** *Avoid:* real embeddings first, a frozen eval rig, and a trace showing which step decided each rank.
3. **Comparing unfrozen evals,** which forced conclusions to be withdrawn. *Avoid:* a snapshot plus cached query vectors before any A/B test.
4. **Persona tuning while the harness was broken.** *Avoid:* validate the eval against production context first, and rejudge before claiming that behaviour changed.
5. **Deployment detours,** with several hosting targets started and abandoned. *Avoid:* decide the runtime first, and don't build deploy scaffolding speculatively.
6. **Building features and then deleting them.** These included integration frameworks with no users, an agent factory, a debate round, and a large agent roster cut back to a few. *Avoid:* start with one or two agents.
7. **Diagnosing upstream data defects as app bugs.** *Avoid:* read the raw export first.
8. **Concluding from one snapshot of an intermittent failure.** *Avoid:* several samples, with counts and truncation logged.
9. **Rediscovering lock and race bugs.** *Avoid:* one shared write primitive from the start.
10. **Raising memory limits instead of measuring.** The index was 99% dead copies. *Avoid:* measure what the data is made of first.
11. **False facts in notes and docs.** *Avoid:* the "facts that expire" table with re-check commands.

---

## Part 13. Problems still open in the predecessor (expect them here)

- **Concision is the weakest scoring dimension for every agent.** The cause is shared rules that make every agent open with its assumptions and intended outcome. It needs a measured experiment across all agents.
- **Retrieval:**
  - recall@1 stays low when one document dominates;
  - re-ingest churn;
  - chunk overlap never measured;
  - many duplicate quote chunks.
- **Token budgeting** uses a characters-divided-by-four estimate, and a long synthesis truncates silently.
- **A negation-aware forbidden-claim matcher** is still missing.
- **No component-level UI test harness and no CI.** Bugs were caught by humans and real-browser runs.
- **One memory path still accepts a model-asserted "consent".** It was accepted as a known risk, so don't copy it.
- **The outbound search guard covers titles only.** Bodies and plain-word code names rely on the prompt.

---

## Appendix A. Day-one checklist

- [ ] Transactional database with keyed vectors; workspace (one per due diligence case) as the isolation unit; per-user roles
- [ ] Offline test setup (credentials stripped, network blocked); structural tests (writer allowlist, no prompts in the client bundle); CI running the phase gate
- [ ] OpenAI-compatible client; config from env only, with no default endpoint; `.env` git-ignored; smoke test asserting real output
- [ ] Fallback badge on every message; fallback refused by findings, evals and memory
- [ ] Date and time zone injected every turn; frozen in tests
- [ ] Findings register with a typed schema; `submit_finding` as the single write path; human-only accept route
- [ ] Provenance tags (primary or derived) on every stored item; evidence retrieval returns primary only
- [ ] Corpus release manifest; as-of filter in retrieval code; leak@k test
- [ ] Real embedding model; vector-size assertion; cardinality check on batch calls
- [ ] Exact-read tools: list, read, newest version
- [ ] One shared write primitive (strict read, lock, unique temp files, atomic rename)
- [ ] Agent specs as data; the registry refuses inactive agents; tool grants per autonomy level
- [ ] Orchestrator excluded from specialists; deterministic activation; per-turn call budget test
- [ ] Explicit "answer now, list what you could not read" turn at the end of a tool budget
- [ ] Eval harness skeleton: case schema, loader validation, cross-family judge, fail-fast, fingerprint
- [ ] Retrieval gold set started (10 to 20 cases, with paraphrases, null and poison cases)
- [ ] Pre-commit confidentiality guard installed; local deny-list git-ignored

## Appendix B. Release hygiene for this public repository

- [ ] No company names other than regulators; no personal names; no internal tools, hosts or project codes
- [ ] No credentials anywhere. Keys live only in git-ignored env files or the cloud secret store. Assume any key ever pushed is compromised, and rotate it.
- [ ] No third-party copyrighted material committed without permission (for example, photos of book pages)
- [ ] No confidential due-diligence material; past-DD validation stays inside each company
- [ ] Commit author email is a no-reply address
- [ ] Automated scan of the staged diff before every commit and push, plus a human read before the first push
