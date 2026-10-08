---
type: presentation-kit
date: 2026-10-08
project: Moab Digital Accelerator
drafted_by: Gemini (scripts), Claude (setup steps, QA)
---

# Voice Co-Presenter Kit: Hybrid Regulatory DD Team

## Running order
1. **People:** slide 1 (title) and slide 2 (problem and value hypothesis) from Opener v3.
2. **Voice agent + the room:** the [architecture page](https://claude.ai/artifact/V9iZfos2wBG21Z4UFGsiBM) (2-3 min), then the [DD walkthrough](https://claude.ai/artifact/Ph5nH7LP2dxf6tXsvev1u2) (7-8 min). the two leaders talk with the agent and make the gate calls.
3. **People:** slide 3 (proposal for proving the value hypothesis) and slide 4 (experiment risks and success criteria). The agent stays quiet.

## Setup (do this before the meeting, then do one full test run)
1. **Make a ChatGPT Project** (desktop app or web): name it "Moab DD demo".
2. **Upload the 18 files** in `Mock DD Test Case/Voice Agent Upload/` (mock data, the 16 data-room files, plan v3) to the Project files.
3. **Paste the setup prompt** (section 2 below) into the Project instructions.
4. **Start a new chat in that Project and switch to voice mode.** Ask three test questions: "What did FDA say about the primary endpoint?", "Which documents are missing?", "Should we continue to valuation?". It should cite DR numbers, show both sides of the endpoint conflict, and hand the last decision back to the room. If voice mode answers from general knowledge instead of the files, voice is not reading the uploads on that device: paste the content of `mock-data.json` into the chat as text before switching to voice, and test again.
5. **Two screens, two jobs:** one laptop shows the HTML pages (someone clicks); ChatGPT runs on a second device, ideally a phone or tablet, so its audio does not compete with the presentation laptop.
6. **Audio:**
   - **In the room:** put the ChatGPT device in the middle of the table at full volume (a small Bluetooth speaker helps). the two leaders just talk to it.
   - **On Teams or Zoom:** the ChatGPT device joins the call as its own participant ("Hybrid DD agent"), with its mic on and the meeting audio playing through it, so it hears the two leaders and they hear it. Test this one, because echo cancellation can mute the agent.
7. **Control:** say "next" to move it on. Anyone can cut in by speaking. If it drifts, the clicker says "pause, we'll take that one" and keeps going. Fallback if audio fails: the clicker reads the narration below while clicking.
8. **Keep facilitator view off** on the walkthrough page. The answer key file is not in the upload folder on purpose.


## 1. How to run it

- **Who clicks:** The human regulatory lead clicks through the HTML pages on the screen.
- **When to hand off:** Introduce the agent immediately after presenting slide 2. The agent takes over for the architecture tour and the mock due-diligence walkthrough.
- **How the leaders talk to the agent:** They simply speak. The agent listens, answers in short turns, and waits for them to speak again.
- **How to cut the agent off:** Anyone in the room can interrupt the agent just by speaking. It will stop and listen.
- **Audio fallback:** If the voice mode fails, the human lead reads the agent's narration scripts directly from the page.

## 2. Setup prompt to paste into ChatGPT

```text
You are a regulatory due-diligence agent co-presenting a mock assessment to two senior regulatory leaders from two different pharma companies. You are narrating the work of a hybrid human-AI team. 

Please follow these rules for the entire session:
1. Speak in short turns of 20 to 40 seconds, then stop and wait for the room to respond.
2. Answer questions using only the uploaded material. Always cite document IDs (like DR-06) when you provide facts.
3. State clearly when a document or piece of evidence is missing.
4. Flag conflicts in the evidence without picking a side.
5. At every decision gate, lay out the options (Proceed, Pause, Seek more information) and ask the room to decide. You never make the call yourself.
6. State once at the start that everything in this mock case is invented. Never claim the case or the companies are real.
7. Move on to the next section only when you hear the word "next".
8. If you are asked about real companies, pricing, or the proposal itself, hand the question back to the human presenters.
9. Keep your tone plain, conversational, and direct. Do not use hype words. Do not read lists as numbered lists.
```

## 3. Hand-off lines

**Human (after slide 2):** What if every regulatory due diligence assessment began with a full regulatory team behind the lead? To show you what that looks like, we brought one with us. I will click through the architecture and a mock case while our voice agent narrates. You can talk to it at any point. Let's hand over.

**Agent's opening line:** Hello. We are looking at a mock due diligence case today, so please keep in mind that all companies, drugs, and data are invented. We will start with a short tour of the hybrid team, then run the assessment. Just say next when you want me to move to the next tab.

**Agent's hand-back line (after walkthrough):** That is the end of the mock assessment. I will hand back to the team to talk about testing this through staged experiments.

## 4. Architecture tour script

**Tab: Team architecture**
This page shows the whole hybrid team. You have a regulatory lead, seven human specialists, and nine bounded agents. The agents just gather evidence and draft risk registers inside an isolated deal workspace. Humans validate the findings and make all the regulatory judgments. What questions do you have on the setup?

**Tab: Agent roster**
Here are the nine agents. Each one has a specific job and a human counterpart. For example, the CMC regulatory agent checks inspection history and stability data. It hands those flags to the human CMC specialist. Does this split make sense to you?

**Tab: Agents vs humans**
This is the boundary. Agents map the data room, check for missing documents, and trace label claims to evidence. Humans decide materiality, resolve disagreements, and sign the recommendation. The machine never makes a go or no go call. Any questions on the boundary?

**Tab: Decision rights**
This chart maps out accountability. The lead signs the regulatory recommendation. The executive sponsor recommends the actual deal to the committee. The committee accepts the enterprise risk. Agents only exist to support the work. They never own a decision. Do you have any questions before we look at the experiments?

**Tab: Experiments and measures**
We propose testing this model through carefully staged experiments. We start with closed cases to measure accuracy. Then we run alongside live assessments without slowing the deadline. The team will only scale this if quality and efficiency targets are met. Would you like to ask any final questions before we open the mock case?

## 5. Walkthrough narration script

**Intake and triage**
The seller opened the data room with 23 items listed. I mapped the contents against our required evidence pack. 15 documents are here. Eight are missing. I flagged the missing items, including an FDA written response and a clinical study report. Based on the data, the asset is a Phase 3 oral oncology drug with a companion diagnostic. I activated the nine required agents and the human specialists to begin. We are at gate one. Should we proceed, pause, or seek more information?

**Therapeutic area research**
I pulled the research on the previously treated cholangiocarcinoma landscape. The standard of care is cytotoxic chemotherapy. I found three competitor programs. One is a Phase 3 asset planning an accelerated filing next year, which could become available therapy before our target files. I also pulled three regulatory precedents for biomarker selected oncology drugs. The human specialist judges which ones apply. Say next when you are ready.

**Asset profile (gate G2)**
I built the asset fact table. The target is an oral inhibitor for previously treated patients. The Phase 3 study is enrolling now. I found two conflicts. The investor deck says FDA agreed to a progression free survival endpoint. Agency minutes show FDA recommended overall survival instead. The data room is missing the FDA written response that would clear this up. We are at gate two. Do we proceed to the deep dives, pause, or seek more information?

**Clinical regulatory deep dive**
I drafted the pathway finding. My first draft said FDA agreed that the current response data could support accelerated approval. The human clinical specialist flagged this as an overstatement and corrected the draft. The agency actually declined to agree in advance. The final pathway depends on whatever therapy is available when we file. I also found a hepatic safety conflict. The company claims no Hy's law cases, but a safety report details a potential case. Say next to continue.

**CMC deep dive**
I assessed manufacturing readiness against the planned filing date. The target has only one drug substance site, and that site has an open FDA Form 483. The investor deck claims a clean inspection history. I flagged this conflict in red for the human CMC specialist. They reviewed the details and noted the data integrity issues matter more than the raw observation count. Say next when you are ready.

**Risk register, rPTS drivers and challenge pass (gate G4)**
I drafted the risk register and the probability of technical success drivers. I provided a range based on eight different drivers instead of a single number. A separate challenge pass attacked my draft. It lowered the score because I relied on a company statement about FDA alignment. The challenged range sits at 47 to 72 percent. The human lead always sets the final position. We are at gate four. What position and materiality does the lead choose to sign?

**Recommendation (gate G5)**
The recommendation is to continue to valuation with regulatory conditions. This hands the valuation team the risk ranges, the endpoint scenarios, and the open items. We are at gate five. This is the final deal decision. Does the committee choose to proceed, pause, seek more information, or stop?

## 6. Six likely questions from the two leaders

**Q: Why did you flag the CDx diagnostic?**
A: The clinical trial uses one assay. But the market kit uses an entirely different platform. I could not find a bridging study report anywhere in the data room. The contract also gives the partner a termination right if the company is acquired.

**Q: What is the main risk with the primary endpoint?**
A: The investor deck explicitly claims FDA agreed to a progression free survival endpoint. Agency minutes show they recommended overall survival. We need that missing FDA written response to completely resolve the conflict.

**Q: How bad is the CMC issue?**
A: The target relies on just one manufacturing site. That specific facility has an open FDA Form 483. The CMC specialist reviewed it and noted the observations center on data integrity. The company has not provided their response to the agency.

**Q: Did you rewrite the label claims?**
A: I never rewrite label language. I mapped the seven draft claims to the evidence. I found four claims that lack support or conflict with the data. The labeling specialist judges the claim strength.

**Q: Why did the score drop in the challenge pass?**
A: My first draft credited a company statement that FDA supported the accelerated pathway. The challenge pass caught that this claim was not supported by the agency minutes. It lowered the score to reflect the actual agency record.

**Q: What happens if the European pediatric plan is missing?**
A: The company plans to file in Europe next year. A pediatric investigation plan or waiver is required before validation. I found no record of an application. The regional specialist noted this is a procedural fix, but it blocks the filing.

*(Hand-back Question)*
**Q: How much will these agents cost to deploy?**
A: I do not have pricing or business case information. I will hand that question straight back to the human team.
