# Live demo: the hybrid team in 3 to 5 minutes

A walkthrough to follow on stage. Each prompt in it is a button in the app. In the team chat, the **Demo prompts** list under the box holds the step buttons. In Rosa's room, the prompt is the first starter prompt. A click puts the exact text in the box but does not send it: check the text, then press Enter. The lists stay open after a click and after you send, so you can click the same button again or any other; only you close the team chat list, with its **Demo prompts** button. The buttons are greyed out while a turn runs. If a button is missing, type the prompt exactly as written: a typo in a name or a topic word changes who answers.

Each prompt was checked against the app with the fake model, so the right teammates are brought in. Who is brought in, the labels and the routing notes do not change. The model writes the replies, so their wording changes from run to run, and it can slip. These prompts have not yet been run with the real model, so the notes below say what to look for, not what will happen: they describe what each agent's brief asks for. If a reply states something as checked or makes a call, say so on stage. That is why every reply is labelled and people decide. Whether a teammate has something to add, and so whether Sofia sums up, can change (see step 5).

In this phase no documents are connected and the agents have no tools. Every reply is model output, and the app labels it that way. A *turn* is one question and all the replies to it.

## Before you present

- [ ] You have run this whole walkthrough once on the VPN with the real model, and timed each step. The fake model cannot show what the agents say.
- [ ] A screen recording of that run is ready, in case the gateway fails on the day. Label it **"pre-recorded"** on screen and say so when you use it. Never show a fake-model run as the demo or as the fallback: every fake reply starts with "Fake reply from".
- [ ] You are on the VPN. The model gateway is only reachable there.
- [ ] In the app folder, `npm run smoke` shows `OK` on the agents plain and agents stream lines. If either says `FAIL`, fix it first. (The judge line is for evaluations; the demo does not use it.) The `model=…` it prints is the model name that **How this turn ran** shows on screen.
- [ ] The app is running (`npm run demo`; see "Demo at any time" in `README.md`) and http://127.0.0.1:3200 is open. On the DD workspace page (the landing page) the **Status** panel says **All checks pass**, with Model connection "Set up", Agent specs "25 agents loaded" and Chat database "OK". The panel only checks that the settings are there, not that they are the real ones: the warm-up question below checks that.
- [ ] The DD workspace shows the DD setup at **Phase 2** with **Orphan** and **Paediatric requirements** ticked, and says **14 of 25 agents selected for this DD.** Steps 3 to 5 need Rosa, Carlos, Dara, Oona and Pia switched on, and the optional part of step 4 needs Eitan switched off. These are the defaults. If a rehearsal left the setup at Phase 3 or Filed, click **Phase 2** again: the agents the stage brought in leave, and any switch you flipped by hand stays as you left it, so check Eitan and Rosa afterwards.
- [ ] Send one warm-up question in a room you will not show (for example Clara's). Check that it streams and is a real answer. If it starts with "Fake reply from", the app is on rehearsal settings: stop it (`npm run demo:stop`, or Ctrl+C if you used `npm start`) and start the live demo again (`npm run demo`).
- [ ] Click **New conversation** in each room you will use: Rosa's room and the team chat. Old threads are archived, not deleted. Rosa's room keeps its starter prompts after the first question.
- [ ] One browser tab per room: the DD workspace, Rosa's room and the team chat. Never open the same room in two tabs: while a turn runs, a question sent from the other tab is refused.
- [ ] You know which version you are showing. The stable demo copy (port 3300) was version 11 on 2026-10-23: it has steps 1 to 9d and **not the Gates page (step 9e)**, which needs a newer copy. The rail on the left shows what the copy has: if **Gates** is not there, skip step 9e. Check this before you tell anyone the gates exist.

## Running it in front of people

Habits for the presenter. Nothing here changes the app.

- **Announce the step before you click.** One sentence: which step it is and what to watch for ("Step 3: I name two teammates; only those two should answer."). The audience then reads the screen with you.
- **Keep turns short.** A turn that ends with Sofia's summary makes three or more model calls in a row (step 3 makes three). Talk while it streams. If a reply runs long, ask the next question with "in five bullets" instead of waiting.
- **Use a "next" cue.** With two presenters, the person at the keyboard clicks only after the reader says "next". With one presenter, say "next" aloud before each click: it makes the pause sound planned.
- **Use the real correction moments; do not stage one.** The app has two that are real and repeatable, and neither needs a planted error. In step 9b, if the agent offers a claim without a word-for-word quote, code moves it to **Open questions** and it never becomes a finding: the app corrects the agent (not guaranteed on every run, so do not promise it). In step 9e, choosing against the recommended call makes the page ask for a reason. If an agent states something as checked, or makes a call, in a reply, stop and say so (see the table at the end). Do not plant an error and present it as the agent's slip.
- **Pre-flight is the checklist above.** Also close other tabs and mute notifications on the shared screen. The app has no tools or connectors to switch off: its only outside connection is the model gateway.
- **No audio is used.** If the screen share fails, read the question and the first lines of the reply aloud, and move to the labelled pre-recorded run if you have one.
- **Keep the answer key off the screen.** The practice case's planted issues are in the evaluation folder (`evals/packs/practice-01/pack.yaml`), and the app never shows them. Do not open that folder or its files on a shared screen.

## Walkthrough

The times are estimates: confirm them in your rehearsal with the real model. Turns that end with Sofia's summary (steps 3 and 4) make three model calls in a row, so they take longest: talk while they stream.

- **3 minutes:** steps 1, 3, 5, 6, 7 and 10.
- **5 minutes:** steps 1 to 8 and 10. Without step 8, about 4.5 minutes. The optional part of step 4 adds about 45 s and step 1b about 40 s. The data room (step 9) adds about 90 s, the findings (step 9b) about 2 minutes more, the checklist (step 9c) about 90 seconds after that, the briefing (step 9d) about 2 minutes more, and the gates (step 9e) about 2 minutes more. Steps 9 to 9d need a real model and are not part of the 3 or 5 minute versions; step 9e needs no model, but is most worth showing after them.

### 1. The DD workspace (about 30 s)

Open http://127.0.0.1:3200.

Point out:

- **The honest frame, before any reply**: the dark banner at the top, "Confidential workspace. Chats stay on this computer and go to your company's model gateway; agents cannot promise secrecy or deletion.", and the line beside the title, "In this phase no documents and no tools are connected. Agent replies are model output, not sources." Say it now; you repeat it at the close.
- **The DD setup**: the stage of the asset and its classification. They decide who is on the team, and the team follows with one click (see step 1b).
- **25 named AI agents, each with a picture**, in the team overview below it, in the four groups of the mockup: Regulatory function (9), Specialists by asset (7), Team roles (5) and Other functions (4, folded away because they are built for other playbooks).
- Each name starts with the letter of its capability: Rosa, Regulatory lead. Carlos, CMC regulatory. Emeka, Evidence checker.
- **Who is selected for this DD**: the line "14 of 25 agents selected for this DD", the switch on each card and, under the name, one line that says why the agent is on or off. The five team roles show **Always on**. In the team chat, routing only picks selected agents. Emeka, Saskia and Ruben answer only when @mentioned; Oskar answers when nobody else fits; Sofia sums up after two or more contributions.
- **Every agent has a human owner**, shown on its card, for example "Regulatory lead agent owner". The owner is a role, never a named person.
- **Remit, marked "planned"**: what the agent is meant to do in later phases, once sources and tools are connected. Today it is a plan, and the card says so.

### 1b. Set the stage, and the team follows (optional, about 40 s)

In the DD setup, click **Phase 3**. The line under the buttons says who joined, for example "Saved. Olu, Mira and Rhea joined the team.", the count goes up, and on those three cards the switch is on with the reason "On because a filing is near (Phase 3 or filed)." The team chat uses the same team: a question about the filing now reaches them. Then click **Phase 2** to put the demo back: they leave again, and nothing you switched by hand changes.

A switch you flip by hand is yours: changing the stage or the classification never undoes it, and the card says "Switched on by you" or "Switched off by you". Ticking or unticking a classification (for example **Expedited programme**) brings its specialist in or out the same way.

### 2. A 1:1 room: Rosa, the regulatory lead (about 40 s)

Click **Chat with Rosa** on her card, or Rosa in the left rail. Her room shows starter prompts above the box. Click the first one, check the text in the box and press Enter:

```text
ABC-123 (illustrative) is an oral small molecule for a rare disease. What commitments would a buyer inherit?
```

Point out:

- The header: Rosa, Regulatory lead, L2 Collaborate, her human owner, and "only Rosa answers here".
- **Persona voice**: her brief asks her to write like a regulatory lead briefing a colleague. Look for the overall picture first, then each part handed to the teammate who owns it, by first name.
- The label **Model output · not sourced** on her reply. The app adds it to every agent reply; the model does not write it.
- **Honest "to verify"**: she has no documents, so anything about ABC-123 should be marked "to verify", and she should name who checks it, for example with the line from her brief "Have the RA DD lead check this before it goes into any briefing."

### 3. The team chat: two @mentions and Sofia's summary (about 60 s)

Click **Team chat** in the left rail. The demo prompts are open under the box (if you closed the list, click **Demo prompts** to open it). Click **Step 3 · @Rosa @Carlos: a new manufacturing site**, check the text in the box and press Enter:

```text
@Rosa @Carlos Suppose the seller of ABC-123 (illustrative) moves manufacturing to a new site before filing. What should our DD check?
```

Point out:

- **Exactly the two teammates you named are brought in**, and Sofia joins by rule once both have contributed. Rosa answers first and streams. Carlos's reply arrives in one piece: look for him adding only what his remit adds, such as the site, comparability and what a reviewer would ask.
- **Sofia's summary of unverified views**: look for where they agree, where they differ, and two to four open checks, each with the role that owns it. Her brief says to add no new facts and make no call: no overall assessment and no recommendation.
- When the turn has finished, open **How this turn ran** under the replies. The app writes it from the saved record of the turn, not from model text. Route: "@mentions chose the agents". Rosa "answers first", Carlos "adds to it", Sofia "summary", each "answered", with the model and the time.
- In the 3-minute version, also point out the label **Model output · not sourced** on each reply (see step 2).

### 4. Routing by topic, without @mentions (about 45 s)

In the **Demo prompts** list, click **Step 4 · Designations: rare disease, paediatric**. Check the text and press Enter:

```text
Which designations could matter for a rare disease asset with a paediatric angle?
```

Point out:

- Nobody was mentioned, yet routing brings in the specialists for the topic: **Oona** (orphan designation) answers first, then **Pia** (paediatric) is asked to add to it. Sofia sums up if both have contributed.
- **How this turn ran** shows why. Route: "Routing terms in the question chose the agents", and **Matched terms: Oona: rare disease · Pia: paediatric**. Code does the routing, not a model guess: at most 3 selected specialists, ranked by how many of their terms match.

Optional, if you have time (about 45 s more: the whole turn runs again). Add a term that belongs to a teammate who is switched off, to show that nothing is skipped silently. In the **Demo prompts** list, click **Step 4b · Optional: adds breakthrough therapy**. Check the text and press Enter:

```text
Which designations could matter for a rare disease asset with a paediatric angle, and could it qualify for breakthrough therapy?
```

A line appears in the thread: "Eitan matches this question but is not selected for this DD; add them to the team to bring them in (the Add button, the team list or the team overview)." An **Add Eitan** button sits right under it.

Optional (about 45 s more): click **Add Eitan**. The button becomes "Added: Eitan can join from your next question." and the **@Eitan** chip appears above the box. Click **Step 4b** again and press Enter: Eitan (expedited programmes) now answers, because his terms match and he is on the team. The **Team for this DD** list above the box does the same for any agent, in both directions. Afterwards switch Eitan off there, so the steps below run as written.

### 5. A teammate with nothing to add (about 30 s)

In the **Demo prompts** list, click **Step 5 · @Carlos @Dara: stability gaps**. Check the text and press Enter:

```text
@Carlos @Dara Which stability gaps most often delay a filing?
```

Point out:

- Carlos answers. Dara covers disclosure compliance, so she may have nothing material to add here. If so, there is no padded reply, just a small grey line: **Dara had nothing to add.**
- In **How this turn ran**: Dara "nothing to add", and Sofia "did not run: fewer than 2 contributions". Sofia only sums up when at least two teammates have said something.
- With the real model the outcome can differ from run to run. If Dara does add a point, say so: the line only appears when a teammate has nothing material to add, and Sofia then sums up as in step 3. In rehearsal, `npm run fake-llm -- --no-addition=Dara` makes it happen every time.

### 6. A decision reserved for people (about 20 s)

In the **Demo prompts** list, click **Step 6 · Should we buy this asset?**. Check the text and press Enter:

```text
Should we buy this asset?
```

Point out:

- No routing term matches, so **Oskar**, the orchestrator, answers. **How this turn ran** says "Nobody matched: the orchestrator answered and named who fits".
- He should not say yes or no. Deal-breakers, the overall assessment and the recommendation, including whether to buy, are decisions for people. Look for him naming **the DD decision owner** (deal-breakers and the recommendation) and the RA DD lead (the overall assessment), and setting out what they would weigh.

### 7. Emeka lists what each claim would need (about 30 s)

In the **Demo prompts** list, click **Step 7 · @Emeka: claims that need a source**. Check the text and press Enter:

```text
@Emeka Which claims in the replies above need a source, and what kind? List the three that matter most.
```

Point out:

- Look for a list keyed by claim. Each claim should be labelled **"unsourced: needs …"** with the kind of source it would take, such as a public review document or a register entry, and what that source would have to show.
- Emeka verifies nothing. Every claim is unsourced today, because no documents are connected, and Emeka should say so. He reads the last eight questions and specialist replies in the team chat, not Sofia's summaries or Oskar's answers.
- Optional: Emeka's own 1:1 room has a fixed banner: "No documents are connected yet, so Emeka cannot verify anything."

### 8. Saskia drafts a sanitised question for a cleared expert (optional, about 30 s)

In the **Demo prompts** list, click **Step 8 · @Saskia: sanitise a question**. Check the text and press Enter:

```text
@Saskia Sanitise this question for a cleared CMC expert: "Does adding a second drug substance site for ABC-123 (illustrative) need new comparability data before the Phase 3 start in 2027?"
```

Point out:

- A cleared expert is an internal expert who is not on the DD team.
- Only Saskia answers. An @mention decides who answers, even though "comparability" would otherwise route the question to Carlos.
- Look for three parts: the **draft question**, then what she removed (such as the asset code and the year), then what she generalised (such as the trial phase or the site detail, and how).
- She only drafts, and the app cannot send anything. In the intended process, nothing leaves the workspace until the RA DD lead approves the redaction.

### 9. The data room (optional, about 90 s; do it after step 8, because a data room stays once it is started)

Click **Data room** in the left rail. With no room started it offers two things: the fictional practice case, and an empty room with an as-of date. Click **Load the practice data room**.

Point out:

- The header line changes to "A data room is connected (10 documents shown to the agents). No tools are." The agents now read the documents on every turn.
- The page says **As of 2026-10-12**: no document dated after that day can be in the room, and an agent never sees one.
- The table lists the eleven documents with their source type, date and size. **DR-09, the paediatric study plan, is "Listed, not provided"**: the licensor's index names it, nobody has given it. **Read** opens a document's text. Everything in this room is invented (the case is "PRC-204"); nothing in it is real.

Click **Rosa** in the rail. Type this in the box and press Enter (these two are not demo-prompt buttons on purpose: they would show up as starters in Rosa's room even when there is no data room):

> Does the draft labeling in DR-07 claim anything that the clinical summary in DR-04 does not show? Cite the document ids.

Rosa answers from the two documents and cites DR-07 and DR-04 by id. Open **How this turn ran**: the **Data room** row says which documents she saw. Then type:

> What does the data room say about the paediatric study plan?

She says it is listed in the index as not provided (DR-09) and was "not found in the data room". She does not describe what it probably contains. That is the rule for anything a document would cover.

If a document should not be there, **Withdraw** it with a reason: the agents stop seeing it at once and the list keeps it, greyed, with the reason. A document cannot be edited; withdraw it and add it again.

### 9b. Findings: an agent drafts, code checks, a person decides (optional, about 2 minutes; only after step 9, in the same room)

You are still in Rosa's room, after her answer about the paediatric study plan. Under the message box, click **Propose findings from this answer**. (The button appears only in an agent's own room, only after one of its answers, and only when the data room has a document she can read. It is not in the team chat.) It takes about 20 seconds: she is asked, in a fixed sentence the app writes itself, to turn her answer into findings in a set format.

Then point out the line the app adds under her reply, written by code: how many findings were drafted and how many claims were kept as open questions, and "Nothing is a finding until a person accepts it." Open **How this turn ran**: the **Findings** row lists the ids that were added.

Click **Findings** in the left rail. Point out:

- Every card is a **draft**: "Draft: no person has decided". Each has the claim, the **quote** beside it in the highlighter, and the document it comes from (id, title, date, kind). Code has checked that the quote is word for word in a document she was shown; a claim without such a quote could not become a finding and is under **Open questions** instead.
- A finding from the licensor's own document is labelled **Attributed: what the seller states, not verified fact**. A finding from an agency record is a primary record.
- The card says **agent output, not evidence**, who drafted it and the human owner.
- On one card, choose **which checklist item it supports** and **whether it is a positive, a risk or neutral** (Accept stays off until both are chosen, and nothing is preselected, so accepting is never done by habit). Type a short note if you like and click **Accept**; click **Reject** on another (a rejection needs no tag). A decided card moves under **Decided** and carries the stamp: **person (local, not authenticated)**. Say plainly that this app has no login, so it cannot tell who clicked; that is the next gate's job. A decision is made once and cannot be undone here.
- The accepted card now says **Supports: …** with the item and the kind. That is what the checklist and, later, the briefing are built from.
- If you click **Propose findings** again on a similar question, claims on a sentence already in the register are not added again; the line under her reply says which finding they repeated.

If you **Withdraw** a document on the Data room page, the drafts that rest on it can still be rejected but no longer accepted.

### 9c. The checklist: four states that never blur (optional, about 90 seconds; only after step 9b)

Click **Checklist** in the left rail. Six items, the regulatory checklist of the due diligence. Point out:

- The item you tagged in step 9b says "1 accepted finding is tagged to this item". **Checked is offered only there**; for every other item it is greyed out, because "checked" needs an accepted finding behind it (code refuses it otherwise, and so does the database). Mark the tagged item **Checked** and save.
- Pick another item, choose **Checked: not applicable**, and try to save: it asks for a **reason**. Type one ("Not an orphan product" is the fictional case's own answer) and save. Do the same with **Could not check** on a third item ("The filing plan was not provided").
- The counts line keeps the four states apart: checked, checked: not applicable, could not check, not checked. Say plainly that "not checked" is the default and stays visible: nothing is skipped silently, and nothing becomes "checked" because an agent said so.
- The page says the app has no login, so a change is stamped "person (local, not authenticated)". The briefing that is built from accepted, tagged findings is the next step; it is not in this version.

### 9d. The briefing: what goes into the cross-functional discussion (optional, about 2 minutes; only after steps 9b and 9c)

Click **Briefing** in the left rail. Nothing is generated by a model here: the page is built by code, on the spot, from what people accepted and tagged and from the checklist. Point out:

- The first paragraph says **"This is a briefing, not a decision."** Deal-breakers, the overall assessment and the recommendation are reserved for people, and nothing on the page makes one.
- **Before you read** says plainly what is missing: how many drafts nobody has decided (they are not in the briefing), accepted findings with no tag, how many checklist items are not checked, and which could not be checked.
- **What was checked** shows the six items with the four states apart, the reasons, and the findings behind each. **Risks**, **Positives** and **Neutral** hold only accepted, tagged findings, each with its claim, the quote word for word, the document, whether it is the seller's statement, and the note of the person who accepted it. A rejected finding and a draft are not there.
- **Open questions** lists the claims no document supports and, with them, every item marked "could not check". **Inputs to the regulatory part of PTRS** lists the findings tagged to that item and says the app computes no number. **Possible mitigations** is empty on purpose: for the regulatory lead and the functions to add.
- Click **Download as Markdown**: the same briefing as a file, named for the data room's as-of date.
- Optional, 20 seconds: on the Data room page withdraw the document behind one accepted finding, then reload the briefing. It now says so, and warns if a checked item rested only on withdrawn documents. The briefing is always built from the register as it is now.

### 9e. Gates: where a person decides (optional, about 2 minutes; best after steps 9b to 9d)

Click **Gates** in the left rail. The page says the facts and the recommended call are built by code and that no model is involved. Point out:

- **Only a person decides these** at the top: deal-breakers, the overall assessment, the recommendation (including whether to buy), going ahead on incomplete evidence, settling a disagreement between specialists, and stopping the due diligence. Under it, the rule: when the lead and a specialist disagree, the lead decides, and the dissent stays on the record.
- Three gates: **Scope and activation**, **The evidence is enough**, **Release the briefing**. Each shows its **facts** (counts and states, from the data room, the register and the checklist), the **recommended call**, and **what would move the call** ("Deciding the 3 draft findings.").
- The four options each have a one-line cost, and **nothing is preselected**. Choose the recommended call and click **Record decision**: no reason is needed. On the evidence gate, choose **Go ahead** while it recommends asking for more information: the reason box says it is required, and the decision is refused without one. Type a reason (for example "The seller sends the rest on Friday.") and record it.
- The decision shows with **Facts at the time**, who and when ("person (local, not authenticated)"), and **Differed from the recommended call**. Open **Add a dissent**, type a function ("CMC regulatory agent owner") and a reason: it appears under the decision and does not change it.
- Change something (decide one more draft on the Findings page) and come back: the evidence gate now says **Decided on earlier facts**, and the briefing's **Before you read** warns about it. The release gate recommends asking for more information until the evidence gate is decided go ahead on the current facts.
- Open the **Briefing**: a **Gate decisions** section lists what was decided, by whom, whether it followed the call and why, with the dissents. It says gate decisions are about the process and not a view on the deal.

### 10. Close (about 15 s)

Say:

- Unless you showed the data room in step 9: no documents are connected yet. Every reply you saw is unsourced model output, and the app labels each one "Model output · not sourced". If you did: the agents cited the fictional documents by id, and a seller's statement is still only a claim, never a checked fact.
- People own every agent and every decision. Deal-breakers, the overall assessment and the recommendation are theirs. The agents explain, challenge and flag what needs checking. They do not decide.
- A later phase is planned to connect public sources, such as EPARs, FDA review documents and ClinicalTrials.gov. If you showed step 9b: a finding carries its document, its quote and its date, code checked that the quote is really in the document, and a person accepted or rejected it. "No source, no finding" is enforced there, in code, not in a prompt. It covers findings only: every chat reply is still unsourced model output. If you did not show it: the findings register exists, but it was not part of this run.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Setup needed.** banner above the messages, and Send is greyed out | The model settings are missing or hold a placeholder (the banner says "Missing: LLM_…"), or the gateway refused the key or the model (the Status panel says "Refused by the model gateway"). The app remembers a refusal until it restarts. | Fix your values in `.env.local` and run `npm run smoke` until both agents lines say `OK`, then restart the app (see "Run" in `README.md`). On stage, switch to the pre-recorded run and say so. |
| Replies start with "Fake reply from …" | The app is still on the rehearsal settings. | Stop it (`npm run demo:stop`, or Ctrl+C if you used `npm start`) and start the live demo again (`npm run demo`), then ask again. |
| A reply fails with "Setup problem: … The model gateway address could not be found.", "Setup problem: … A secure connection to the model gateway could not be made." or "Service problem: … The connection to the model gateway broke." | Usually the VPN is off or dropped. | Reconnect the VPN and ask again. No restart is needed. |
| A reply fails with "Service problem: … The model gateway is limiting requests. Try again in a moment." or "Service problem: … The model service is having an outage. Try again later." | The gateway is busy or down. The app has already retried. | Wait half a minute and ask again. If it fails twice, switch to the pre-recorded run and say so. |
| A reply fails with "Service problem: … The model took too long to answer." or "Service problem: … The turn ran out of time." | A timeout. Each model call gets 120 s and each turn 180 s. The gateway is slow, or the network is. | Check the VPN. Ask again, and ask for a short answer (for example "in five bullets") or name fewer teammates. A turn always ends by itself; the room never stays stuck. |
| A **cut off** badge on a reply | The reply hit the output limit (`LLM_MAX_TOKENS`, 1500 unless set). The text so far is kept. | Ask for a shorter answer, for example "in five bullets", or raise `LLM_MAX_TOKENS` and restart. |
| An **interrupted** badge and "The reply broke off" | The connection to the gateway broke mid-reply. The text so far is kept. If it was the first reply, the teammates after it are skipped with a note, such as "Carlos was not asked: Rosa’s reply broke off." | Ask again. |
| "This turn was interrupted: the server restarted while it ran." | The app restarted during the turn. Finished replies are kept; the one still running is lost. The room is free again. | Ask again. |
| The page does not load, or "Could not reach the server, so your question was not sent." | The app has stopped, for example because its terminal was closed (if you used `npm start`) or the computer restarted. | In the app folder, run `npm run demo` (it reuses its build). If you used `npm start`, run that instead (no new build needed). Reload the page and ask again. |
| "Another turn is running in this room. Your question is back in the box; send it when that turn ends." | A turn is still running in this room, often started from another browser tab. The room checks every 2 seconds. **New conversation** is refused too: "A turn is still running in this room. Start a new conversation when it ends." | Wait until the turn ends (it always does, within about 3 minutes), then send again. Use one browser tab per room on stage. |
| "The live connection dropped. The turn continues on the server…" | The browser lost the stream, for example after a Wi-Fi blip or a sleeping laptop. | Wait. The saved replies appear when the turn ends. Do not send the question again. |
| "@… is not the name of an agent, so it brought nobody in.", "… is not selected for this DD", or the wrong teammates answer | A typo in a typed prompt, or a teammate is switched off. | Use the demo prompt instead of typing. Switch the teammate on in the Team overview (a section of the DD workspace page), or set the stage or classification that brings them in. |
| A reply states something as checked, gives figures or dates, or makes a call | The model slipped from its brief. | Say so: that is why every reply is labelled "Model output · not sourced" and people decide. |
| An agent says "not found in the data room" for something you can see on the Data room page | The document is withdrawn, dated after the as-of date, listed but not provided, or did not fit in the 48,000 characters the agents read per turn. | Open **How this turn ran**: its Data room row names every document the agents saw and every one they did not, with the reason. |
| **Load the practice data room** is greyed out, or a second start is refused | The practice case is not installed in this copy (the page says so), or this workspace already has a data room. A room cannot be removed. | In development, stop the app and delete the database file named by `CHAT_DB_PATH` to start again. In the stable demo copy, a new version starts with an empty history. |

## Rehearse without the VPN

The fake model (`scripts/fake-llm.mjs`) stands in for the gateway, so you can practise the clicks and the routing anywhere. It is not a model: every reply starts with "Fake reply from <Name>" and only repeats your question. Commands are in "Run" in `README.md`. Start it with `--no-addition=Dara` so step 5 shows the line every time. When you finish, switch the app back to your real settings, as "Run" in `README.md` describes.

## How the prompts were checked

Each prompt above was sent to the built app with the fake model, through the same API the browser uses (2026-10-08). The routed agents, the notes and How this turn ran matched this page; "nothing to add" was forced with `--no-addition=Dara`. The prompts are also the app's demo prompts (`src/components/demo-prompts.ts`). A test fails if a prompt there and its grey box here differ, or if a prompt stops bringing in the teammates this page names. In a browser check with the fake model, each click put the exact text in the box and sent nothing. The fake model cannot check what the agents say. Do one full rehearsal on the VPN with the real model before the event.
