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

The first time, your computer may warn you because the file comes from the internet. That is normal. A file called "READ ME FIRST" in the folder shows the two or three clicks that get past it. On a Mac it looks like "cannot be opened because Apple cannot check it"; on Windows it looks like "Windows protected your PC".

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

**The first-time warning.** Your computer does not know the files, because they come from the internet and are not signed by a company. On a Mac you may see "cannot be opened because Apple cannot check it": open System Settings, then Privacy & Security, scroll down, click Open Anyway next to the message about "Start practice demo" and confirm. On Windows you may see "Windows protected your PC": click More info, then Run anyway; or "The publisher could not be verified": click Run. The "READ ME FIRST" file in the folder shows this step by step. If a security setting blocks the double-click completely, the same file has a short fallback for the Terminal (Mac) or Command Prompt (Windows).

**Practice or live.**

- Practice needs no key and no network. Every screen works, but the replies are stand-ins, not AI, and each one says so. The steps that need real answers (drafting findings, for example) do not show anything useful in practice mode.
- Live gives real AI answers. For that you need your own key for a model gateway that speaks the OpenAI chat-completions format with streaming, the gateway's address and the exact name of a model. Your IT or AI team can tell you whether you have one. Use your own key, never someone else's. Double-click "Start live demo"; the settings file "my-settings.env" opens, you fill in three lines, save, and double-click again. The agents were developed and measured with one particular model, so another model will answer differently.

**What goes where.** In live mode, every question you type and the documents of the data room are sent to the gateway you set up, under your own key. They do not come to me. Please use the fictional practice case or public documents only. Do not put confidential material in it: no company documents, no unpublished data, no personal data. The agents explain, challenge and flag what needs checking; they decide nothing, and every reply is labelled as model output, not a sourced fact.

**Your data and removing it.** Chats and decisions are saved in the "data" folder next to the program. To start again from empty, stop the demo and delete that folder. To remove everything, stop the demo and delete the folder "HybridDemo". Never send your `my-settings.env` to anyone: once it holds your key it is yours alone.

If you try it with your team, I would like to hear what was useful, what was confusing and where the agents were wrong. Honest misses help more than praise.

Best regards,
[YOUR NAME]
