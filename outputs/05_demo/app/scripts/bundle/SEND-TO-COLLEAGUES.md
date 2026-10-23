# Sending the demo to colleagues

Two ready-to-send messages. Replace `[DOWNLOAD LINK]` with the link to the ZIP that fits their computer (`HybridTeamDemo-mac.zip` or `HybridTeamDemo-windows.zip`) and, where it says so, your own name. The ZIPs are built on your Mac with `npm run bundle`; they are not in the repository. Send each person only the ZIP for their own computer.

Before you send:

- Share the link in a way you can switch off later, and only with people you mean to share it with.
- A ZIP built without a preset holds no key, no address and no data of yours: the settings file inside it is empty. A ZIP built with a preset holds your gateway's address, model name and header name (never a key). Send that one only to people inside your own company, and open the settings file in a fresh unzip once to see what it holds.
- Do not send a `my-settings.env` that you have filled in yourself, ever.

---

## 1. Short e-mail for a colleague

**Subject:** Try the Digital Human Hybrid Team demo on your own computer

Hi,

here is the demo I mentioned: 25 AI agents that help with a regulatory due diligence, on a fictional case. It runs on your own computer, and nobody else sees what you do.

Download: [DOWNLOAD LINK]

Three steps:

1. Unzip the file and open the folder "HybridDemo". On Windows, right-click the ZIP first, choose Properties, tick Unblock and click OK.
2. Double-click "Start practice demo". Your browser opens the demo.
3. When you are done, double-click "Stop demo".

The first time, your computer may warn you because the file comes from the internet. That is normal. A file called "READ ME FIRST" in the folder shows the clicks that get past it. On a Mac they come once for each starter you use, so expect them more than once on the first day. On a Mac it looks like "cannot be opened because Apple cannot check it"; on Windows it looks like "Windows protected your PC".

Practice mode needs no key and no network. Its replies are stand-ins, not AI, and each one says so. For real AI answers there is also "Start live demo". That needs your own key for a model gateway, which you would ask your IT or AI team for. In live mode every question you type, and the documents of the demo's data room, go to that gateway. Please do not type or paste anything confidential. The fictional case in the demo is enough to try everything.

Tell me what is unclear or what does not work.

[YOUR NAME]

---

## 2. Longer note for a cohort member at another company

**Subject:** Digital Human Hybrid Team demo: try it in your own company

Hi [FIRST NAME],

thanks for your interest. This is the demo our group built: a hybrid team of 25 named AI agents plus human owners for a regulatory due diligence. Domain, team-role and stakeholder-view agents work from a verified findings format ("no source, no finding"), and decisions stay with people. The case in it is fictional and the design is company-neutral, so you can run it inside your own company without any exchange of information between us.

**What you get.** One ZIP file with everything inside, including the program that runs it. Nothing needs to be installed, and no administrator rights are needed. Everything runs on your computer and listens only on that computer. There is no account and no login, and I do not see what you do.

Download: [DOWNLOAD LINK]

**What to do.**

1. Unzip the file and open the folder "HybridDemo". On Windows, right-click the ZIP first, choose Properties, tick Unblock and click OK; this avoids the warnings below.
2. Double-click "Start practice demo". Your browser opens the demo.
3. When you are done, double-click "Stop demo".

**The first-time warning.** Your computer does not know the files, because they come from the internet and are not signed by a company. On a Mac you may see "cannot be opened because Apple cannot check it": open System Settings, then Privacy & Security, scroll down, click Open Anyway next to the message about "Start practice demo" and confirm. The Mac asks once for each starter, and may ask once more for the program inside the folder. On Windows you may see "Windows protected your PC": click More info, then Run anyway; or "The publisher could not be verified": click Run. The "READ ME FIRST" file in the folder shows this step by step. If a security setting blocks the double-click completely, the same file has a short fallback for the Terminal (Mac) or Command Prompt (Windows).

**Practice or live.**

- Practice needs no key and no network. Every screen works, but the replies are stand-ins, not AI, and each one says so. The steps that need real answers (drafting findings, for example) do not show anything useful in practice mode.
- Live gives real AI answers. For that you need your own key for a model gateway that speaks the OpenAI chat-completions format with streaming, the gateway's address and the exact name of a model. Your IT or AI team can tell you whether you have one. Use your own key, never someone else's. Double-click "Start live demo"; the settings file "my-settings.env" opens, you fill in three lines, save, and double-click again. The agents were developed and measured with one particular model, so another model will answer differently.

**What goes where.** In live mode, every question you type and the documents of the data room are sent to the gateway you set up, under your own key. They do not come to me. Please use the fictional practice case or public documents only. Do not put confidential material in it: no company documents, no unpublished data, no personal data. The agents explain, challenge and flag what needs checking; they decide nothing, and every reply is labelled as model output, not a sourced fact.

**Your data and removing it.** Chats and decisions are saved in the "data" folder next to the program. To start again from empty, stop the demo and delete that folder. To remove everything, stop the demo and delete the folder "HybridDemo". Never send your `my-settings.env` to anyone: once it holds your key it is yours alone.

If you try it with your team, I would like to hear what was useful, what was confusing and where the agents were wrong. Honest misses help more than praise.

Best regards,
[YOUR NAME]

---

## 3. For colleagues on the same project, on Windows, with the project key

Use this when the people you send it to are officially allowed to use a project key for the model gateway, and are inside your company. Build the ZIP with a preset (`npm run bundle -- --only windows --preset <file>`, see `--help`) so that the gateway's address and the model name are already filled in; then each person only has to paste the key.

How to send it safely:

- **Better than sending the key: let each person copy it themselves** from the gateway portal's API Keys page, where they already have access, and name the row to copy in your message. Nobody then has to pass a secret around. If someone has no portal access, send the key in a separate message from the link, in a channel the company already trusts for secrets. Never put it in the ZIP, in an e-mail with the link, or in a shared folder. The ZIP never holds a key: the builder refuses one.
- Send the ZIP only to people who are allowed to use that key, in a way you can switch off later.
- Each person must be on the company network or VPN for live answers: the gateway cannot be reached from outside.
- If the key is ever pasted somewhere it should not be, ask whoever owns the project key to replace it.

**Subject:** The demo on your PC: unzip, click, paste the project key

Hi [FIRST NAME],

here is the Digital Human Hybrid Team demo: 25 AI agents that help with a regulatory due diligence, on a fictional case. It runs on your own PC, in your browser.

Download (Windows): [DOWNLOAD LINK]

1. Right-click the ZIP, choose Properties, tick **Unblock** at the bottom and click OK. Then right-click the ZIP, choose Extract All, to a short place such as the Desktop, and open the folder "HybridDemo".
2. Double-click **Start practice demo** first. Your browser opens the demo. This checks that it works on your PC and needs no key and no network. If Windows warns you, click "More info", then "Run anyway". Double-click **Stop demo** when you are done.
3. For real AI answers: connect to the company VPN, then double-click **Start live demo**. Notepad opens a file called my-settings.env. The gateway address and the model are already filled in. Next, get the key yourself: open the gateway portal in your browser, choose the project workspace, click "API Keys" in the left menu, find the row called [ROW NAME] and click the small copy icon next to the key once. Go back to Notepad and, on the line that says `LLM_API_KEY=`, press Ctrl+V directly after the equals sign: no space and no quotes. Save the file, close Notepad and double-click **Start live demo** again.
4. When you are done, double-click **Stop demo**.

The file "READ ME FIRST" in the folder says "your own key". For you that means the project key you copied from the portal. You are allowed to use it. Please keep it to yourself: do not forward the ZIP or the settings file, and do not save the key anywhere else.

In live mode, everything you type and the documents of the practice data room go to the company model gateway. Use the fictional case or public documents only; nothing confidential.

If you see "Not reachable", the VPN is off. If you see "Wrong key", check that nothing is typed before or after the key on that one line. Tell me what does not work.

[YOUR NAME]

---

## 4. For a colleague who can only use Ona

For someone whose computer only lets them work in Ona, with Ona's agent to install and change the app. The step-by-step guide is `docs/ONA-FOR-COLLEAGUES.md` in the repository. Send the gateway address, the model name and the key-header name in a separate private message, and tell them which key row to copy in the gateway portal. They copy the key themselves, so it is never in a message.

**Subject:** The demo in Ona: open, add three secrets, probe, start

Hi [FIRST NAME],

since you work in Ona, here is how to run the demo there and change it with Ona's agent. Open the repository ([REPOSITORY LINK]) in Ona and follow the file `docs/ONA-FOR-COLLEAGUES.md`. The short version:

1. Start an environment and wait for "Install app dependencies" to finish.
2. Copy the key yourself: open the gateway portal, choose the project workspace, click "API Keys", find the row called [ROW NAME] and click the copy icon once. Then in Ona's settings add **user** secrets `LLM_BASE_URL`, `LLM_MODEL` and `LLM_API_KEY` (paste the key as its value) and `LLM_API_KEY_HEADER`. I send the address, the model and the header name separately. The key is the project key; you are allowed to use it. Restart the environment afterwards.
3. Run the task "Probe the LLM gateway". If it says `OK`, go on. If it says `dns` or `timeout`, Ona cannot reach the gateway from the cloud; send me the output (it holds no key) and we will ask IT.
4. Start the service "Hybrid team chat app", run `ona environment port open 3000 --admission creator_only --name hybrid-team`, and open the link.
5. To change the app, give Ona's agent the briefing in section 5 of the guide first.

Two rules: never type the key into the agent's chat or into a file, and keep the port creator-only.

I have not run the app in Ona myself yet, so please tell me exactly what you see at each step.

[YOUR NAME]
