# Live demo: the hybrid team in 3 to 5 minutes

A walkthrough to follow on stage. Each prompt in it is a button in the app. In the team chat, click **Demo prompts** under the box, then the step's button. In Rosa's empty room, the prompt is the first starter prompt. A click puts the exact text in the box but does not send it: check the text, then press Enter. The list folds away after each click, and the buttons are greyed out while a turn runs. If a button is missing, type the prompt exactly as written: a typo in a name or a topic word changes who answers.

Each prompt was checked against the app with the fake model, so the right teammates are brought in. Who is brought in, the labels and the routing notes do not change. The model writes the replies, so their wording changes from run to run, and it can slip. These prompts have not yet been run with the real model, so the notes below say what to look for, not what will happen: they describe what each agent's brief asks for. If a reply states something as checked or makes a call, say so on stage. That is why every reply is labelled and people decide. Whether a teammate has something to add, and so whether Sofia sums up, can change (see step 5).

In this phase no documents are connected and the agents have no tools. Every reply is model output, and the app labels it that way. A *turn* is one question and all the replies to it.

## Before you present

- [ ] You have run this whole walkthrough once on the VPN with the real model, and timed each step. The fake model cannot show what the agents say.
- [ ] A screen recording of that run is ready, in case the gateway fails on the day. Label it **"pre-recorded"** on screen and say so when you use it. Never show a fake-model run as the demo or as the fallback: every fake reply starts with "Fake reply from".
- [ ] You are on the VPN. The model gateway is only reachable there.
- [ ] In the app folder, `npm run smoke` shows `OK` on the agents plain and agents stream lines. If either says `FAIL`, fix it first. (The judge line is for evaluations; the demo does not use it.) The `model=…` it prints is the model name that **How this turn ran** shows on screen.
- [ ] The app is running (see "Run" in `README.md`) and http://127.0.0.1:3200 is open. On the Team overview page the **Status** panel says **All checks pass**, with Model connection "Set up", Agent specs "25 agents loaded" and Chat database "OK". The panel only checks that the settings are there, not that they are the real ones: the warm-up question below checks that.
- [ ] The Team overview page says **14 of 25 agents selected for this DD.** Steps 3 to 5 need Rosa, Carlos, Dara, Oona and Pia switched on, and the optional part of step 4 needs Eitan switched off. These are the defaults.
- [ ] Send one warm-up question in a room you will not show (for example Clara's). Check that it streams and is a real answer. If it starts with "Fake reply from", the app is on rehearsal settings: stop it and start it again with plain `npm start`.
- [ ] Click **New conversation** in each room you will use: Rosa's room and the team chat. Old threads are archived, not deleted. Rosa's room shows its starter prompts only while it is empty.
- [ ] One browser tab per room: the Team overview page, Rosa's room and the team chat. Never open the same room in two tabs: while a turn runs, a question sent from the other tab is refused.

## Walkthrough

The times are estimates: confirm them in your rehearsal with the real model. Turns that end with Sofia's summary (steps 3 and 4) make three model calls in a row, so they take longest: talk while they stream.

- **3 minutes:** steps 1, 3, 5, 6, 7 and 9.
- **5 minutes:** steps 1 to 9. Without step 8, about 4.5 minutes. The optional part of step 4 adds about 45 s.

### 1. The Team overview page (about 30 s)

Open http://127.0.0.1:3200.

Point out:

- **The honest frame, before any reply**: the dark banner at the top, "Public information only. Do not paste confidential or company information.", and the line beside the title, "In this phase no documents and no tools are connected. Agent replies are model output, not sources." Say it now; you repeat it at the close.
- **25 named AI agents, each with a picture**, in the four groups of the mockup: Regulatory function (9), Specialists by asset (7), Team roles (5) and Other functions (4, folded away because they are built for other playbooks).
- Each name starts with the letter of its capability: Rosa, Regulatory lead. Carlos, CMC regulatory. Emeka, Evidence checker.
- **Who is selected for this DD**: the line "14 of 25 agents selected for this DD" and the switch on each card. The five team roles show **Always on**. In the team chat, routing only picks selected agents. Emeka, Saskia and Ruben answer only when @mentioned; Oskar answers when nobody else fits; Sofia sums up after two or more contributions.
- **Every agent has a human owner**, shown on its card, for example "Regulatory lead agent owner". The owner is a role, never a named person.
- **Remit, marked "planned"**: what the agent is meant to do in later phases, once sources and tools are connected. Today it is a plan, and the card says so.

### 2. A 1:1 room: Rosa, the regulatory lead (about 40 s)

Click **Chat with Rosa** on her card, or Rosa in the left rail. Her empty room shows starter prompts above the box. Click the first one, check the text in the box and press Enter:

```text
ABC-123 (illustrative) is an oral small molecule for a rare disease. What commitments would a buyer inherit?
```

Point out:

- The header: Rosa, Regulatory lead, L2 Collaborate, her human owner, and "only Rosa answers here".
- **Persona voice**: her brief asks her to write like a regulatory lead briefing a colleague. Look for the overall picture first, then each part handed to the teammate who owns it, by first name.
- The label **Model output · not sourced** on her reply. The app adds it to every agent reply; the model does not write it.
- **Honest "to verify"**: she has no documents, so anything about ABC-123 should be marked "to verify", and she should name who checks it, for example with the line from her brief "Have the RA DD lead check this before it goes into any briefing."

### 3. The team chat: two @mentions and Sofia's summary (about 60 s)

Click **Team chat** in the left rail. While the room is empty, the demo prompts are open under the box (if not, click **Demo prompts**). Click **Step 3 · @Rosa @Carlos: a new manufacturing site**, check the text in the box and press Enter:

```text
@Rosa @Carlos Suppose the seller of ABC-123 (illustrative) moves manufacturing to a new site before filing. What should our DD check?
```

Point out:

- **Exactly the two teammates you named are brought in**, and Sofia joins by rule once both have contributed. Rosa answers first and streams. Carlos's reply arrives in one piece: look for him adding only what his remit adds, such as the site, comparability and what a reviewer would ask.
- **Sofia's summary of unverified views**: look for where they agree, where they differ, and two to four open checks, each with the role that owns it. Her brief says to add no new facts and make no call: no overall assessment and no recommendation.
- When the turn has finished, open **How this turn ran** under the replies. The app writes it from the saved record of the turn, not from model text. Route: "@mentions chose the agents". Rosa "answers first", Carlos "adds to it", Sofia "summary", each "answered", with the model and the time.
- In the 3-minute version, also point out the label **Model output · not sourced** on each reply (see step 2).

### 4. Routing by topic, without @mentions (about 45 s)

Click **Demo prompts**, then **Step 4 · Designations: rare disease, paediatric**. Check the text and press Enter:

```text
Which designations could matter for a rare disease asset with a paediatric angle?
```

Point out:

- Nobody was mentioned, yet routing brings in the specialists for the topic: **Oona** (orphan designation) answers first, then **Pia** (paediatric) is asked to add to it. Sofia sums up if both have contributed.
- **How this turn ran** shows why. Route: "Routing terms in the question chose the agents", and **Matched terms: Oona: rare disease · Pia: paediatric**. Code does the routing, not a model guess: at most 3 selected specialists, ranked by how many of their terms match.

Optional, if you have time (about 45 s more: the whole turn runs again). Add a term that belongs to a teammate who is switched off, to show that nothing is skipped silently. Click **Demo prompts**, then **Step 4b · Optional: adds breakthrough therapy**. Check the text and press Enter:

```text
Which designations could matter for a rare disease asset with a paediatric angle, and could it qualify for breakthrough therapy?
```

A line appears in the thread: "Eitan matches this question but is not selected for this DD; switch them on in the team overview to bring them in."

### 5. A teammate with nothing to add (about 30 s)

Click **Demo prompts**, then **Step 5 · @Carlos @Dara: stability gaps**. Check the text and press Enter:

```text
@Carlos @Dara Which stability gaps most often delay a filing?
```

Point out:

- Carlos answers. Dara covers disclosure compliance, so she may have nothing material to add here. If so, there is no padded reply, just a small grey line: **Dara had nothing to add.**
- In **How this turn ran**: Dara "nothing to add", and Sofia "did not run: fewer than 2 contributions". Sofia only sums up when at least two teammates have said something.
- With the real model the outcome can differ from run to run. If Dara does add a point, say so: the line only appears when a teammate has nothing material to add, and Sofia then sums up as in step 3. In rehearsal, `npm run fake-llm -- --no-addition=Dara` makes it happen every time.

### 6. A decision reserved for people (about 20 s)

Click **Demo prompts**, then **Step 6 · Should we buy this asset?**. Check the text and press Enter:

```text
Should we buy this asset?
```

Point out:

- No routing term matches, so **Oskar**, the orchestrator, answers. **How this turn ran** says "Nobody matched: the orchestrator answered and named who fits".
- He should not say yes or no. Deal-breakers, the overall assessment and the recommendation, including whether to buy, are decisions for people. Look for him naming **the DD decision owner** (deal-breakers and the recommendation) and the RA DD lead (the overall assessment), and setting out what they would weigh.

### 7. Emeka lists what each claim would need (about 30 s)

Click **Demo prompts**, then **Step 7 · @Emeka: claims that need a source**. Check the text and press Enter:

```text
@Emeka Which claims in the replies above need a source, and what kind? List the three that matter most.
```

Point out:

- Look for a list keyed by claim. Each claim should be labelled **"unsourced: needs …"** with the kind of source it would take, such as a public review document or a register entry, and what that source would have to show.
- Emeka verifies nothing. Every claim is unsourced today, because no documents are connected, and Emeka should say so. He reads the last eight questions and specialist replies in the team chat, not Sofia's summaries or Oskar's answers.
- Optional: Emeka's own 1:1 room has a fixed banner: "No documents are connected yet, so Emeka cannot verify anything."

### 8. Saskia drafts a sanitised question for a cleared expert (optional, about 30 s)

Click **Demo prompts**, then **Step 8 · @Saskia: sanitise a question**. Check the text and press Enter:

```text
@Saskia Sanitise this question for a cleared CMC expert: "Does adding a second drug substance site for ABC-123 (illustrative) need new comparability data before the Phase 3 start in 2027?"
```

Point out:

- A cleared expert is an internal expert who is not on the DD team.
- Only Saskia answers. An @mention decides who answers, even though "comparability" would otherwise route the question to Carlos.
- Look for three parts: the **draft question**, then what she removed (such as the asset code and the year), then what she generalised (such as the trial phase or the site detail, and how).
- She only drafts, and the app cannot send anything. In the intended process, nothing leaves the workspace until the RA DD lead approves the redaction.

### 9. Close (about 15 s)

Say:

- No documents are connected yet. Every reply you saw is unsourced model output, and the app labels each one "Model output · not sourced".
- People own every agent and every decision. Deal-breakers, the overall assessment and the recommendation are theirs. The agents explain, challenge and flag what needs checking. They do not decide.
- A later phase is planned to connect public sources, such as EPARs, FDA review documents and ClinicalTrials.gov. Then a claim could carry its document, version and quote, and "No source, no finding" could be enforced in code.

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| **Setup needed.** banner above the messages, and Send is greyed out | The model settings are missing or hold a placeholder (the banner says "Missing: LLM_…"), or the gateway refused the key or the model (the Status panel says "Refused by the model gateway"). The app remembers a refusal until it restarts. | Fix your values in `.env.local` and run `npm run smoke` until both agents lines say `OK`, then restart the app (see "Run" in `README.md`). On stage, switch to the pre-recorded run and say so. |
| Replies start with "Fake reply from …" | The app is still on the rehearsal settings. | Stop the app (Ctrl+C) and start it again with plain `npm start`, then ask again. |
| A reply fails with "Setup problem: … The model gateway address could not be found.", "Setup problem: … A secure connection to the model gateway could not be made." or "Service problem: … The connection to the model gateway broke." | Usually the VPN is off or dropped. | Reconnect the VPN and ask again. No restart is needed. |
| A reply fails with "Service problem: … The model gateway is limiting requests. Try again in a moment." or "Service problem: … The model service is having an outage. Try again later." | The gateway is busy or down. The app has already retried. | Wait half a minute and ask again. If it fails twice, switch to the pre-recorded run and say so. |
| A reply fails with "Service problem: … The model took too long to answer." or "Service problem: … The turn ran out of time." | A timeout. Each model call gets 120 s and each turn 180 s. The gateway is slow, or the network is. | Check the VPN. Ask again, and ask for a short answer (for example "in five bullets") or name fewer teammates. A turn always ends by itself; the room never stays stuck. |
| A **cut off** badge on a reply | The reply hit the output limit (`LLM_MAX_TOKENS`, 1500 unless set). The text so far is kept. | Ask for a shorter answer, for example "in five bullets", or raise `LLM_MAX_TOKENS` and restart. |
| An **interrupted** badge and "The reply broke off" | The connection to the gateway broke mid-reply. The text so far is kept. If it was the first reply, the teammates after it are skipped with a note, such as "Carlos was not asked: Rosa’s reply broke off." | Ask again. |
| "This turn was interrupted: the server restarted while it ran." | The app restarted during the turn. Finished replies are kept; the one still running is lost. The room is free again. | Ask again. |
| The page does not load, or "Could not reach the server, so your question was not sent." | The app has stopped, for example because its terminal was closed. | Start it again in the app folder with `npm start` (no new build needed), reload the page and ask again. |
| "Another turn is running in this room. Your question is back in the box; send it when that turn ends." | A turn is still running in this room, often started from another browser tab. The room checks every 2 seconds. **New conversation** is refused too: "A turn is still running in this room. Start a new conversation when it ends." | Wait until the turn ends (it always does, within about 3 minutes), then send again. Use one browser tab per room on stage. |
| "The live connection dropped. The turn continues on the server…" | The browser lost the stream, for example after a Wi-Fi blip or a sleeping laptop. | Wait. The saved replies appear when the turn ends. Do not send the question again. |
| "@… is not the name of an agent, so it brought nobody in.", "… is not selected for this DD", or the wrong teammates answer | A typo in a typed prompt, or a teammate is switched off. | Use the demo prompt instead of typing. Switch the teammate on in the Team overview. |
| A reply states something as checked, gives figures or dates, or makes a call | The model slipped from its brief. | Say so: that is why every reply is labelled "Model output · not sourced" and people decide. |

## Rehearse without the VPN

The fake model (`scripts/fake-llm.mjs`) stands in for the gateway, so you can practise the clicks and the routing anywhere. It is not a model: every reply starts with "Fake reply from <Name>" and only repeats your question. Commands are in "Run" in `README.md`. Start it with `--no-addition=Dara` so step 5 shows the line every time. When you finish, switch the app back to your real settings, as "Run" in `README.md` describes.

## How the prompts were checked

Each prompt above was sent to the built app with the fake model, through the same API the browser uses (2026-10-08). The routed agents, the notes and How this turn ran matched this page; "nothing to add" was forced with `--no-addition=Dara`. The prompts are also the app's demo prompts (`src/components/demo-prompts.ts`). A test fails if a prompt there and its grey box here differ, or if a prompt stops bringing in the teammates this page names. In a browser check with the fake model, each click put the exact text in the box and sent nothing. The fake model cannot check what the agents say. Do one full rehearsal on the VPN with the real model before the event.
