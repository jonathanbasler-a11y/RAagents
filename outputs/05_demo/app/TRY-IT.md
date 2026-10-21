# Try the demo on your own computer

The Digital Human Hybrid Team demo is a web app that runs on your own computer: 25 named AI agents, a team chat and a 1:1 room per agent, a fictional data room, a findings register, the regulatory checklist and the briefing. Your copy is yours alone. Nothing you do in it is seen by anyone else, and nothing is shared between copies.

There are two ways to run it:

- **Practice mode: no key and no network needed after setup.** Every screen works, but the replies come from a stand-in, not from AI, and say so on every message. It is good for clicking through the screens and the flow.
- **Live mode: real AI answers.** You need your own key for a model gateway (see "What you need").

## What you need

- **A Mac or a Linux computer.** The start command does not run on Windows. Windows with WSL (the Linux subsystem) has not been tried.
- **Node.js 24.** Check with `node --version`; the first number must be 24 or higher. If it is not, install Node 24 from nodejs.org or with your package manager (on a Mac with Homebrew: `brew install node@24`, then follow the line it prints to put it on your PATH).
- **About 650 MB of disk space** and an internet connection for the first install, which downloads about 540 packages.
- **For live mode only:** your own key for a model gateway that speaks the OpenAI chat completions format with streaming, plus the gateway's address and the exact name of a model. Many companies run such a gateway internally; ask your IT or AI team. Use your own key; never borrow someone else's. The agents were developed and measured with Claude Opus 5.5. Another model will answer differently and has not been measured here.

## Get the code

On the GitHub page of this repository, click **Code**, then **Download ZIP**, and unzip it. If you use git, clone the repository instead. Then open a terminal in the app folder:

```sh
cd outputs/05_demo/app
```

Every command below runs from this folder.

## Install (once)

```sh
npm ci --ignore-scripts
```

The flag stops any package from running code on your computer at install time; the app needs none.

## Practice mode

```sh
npm run demo:practice
```

The first start builds the app, which takes up to a minute. Then it runs in the background at http://127.0.0.1:3200/ (on a Mac the browser opens by itself). A yellow banner and the label "Practice reply · not AI · not sourced" on every reply show that the answers are stand-ins.

Practice mode shows every screen, the routing in the team chat, the data room and the empty findings, checklist and briefing pages. The findings steps need real answers, because the stand-in cannot draft findings. To see them, use live mode.

Stop it with `npm run demo:stop`.

## Live mode

1. **Create your settings file**, private to you from the start:

   ```sh
   install -m 600 env.example .env.local
   ```

   Open `.env.local` in a text editor and fill in three lines: `LLM_BASE_URL` (the gateway address, up to and including `/v1`), `LLM_API_KEY` (your key) and `LLM_MODEL` (the exact model name). If your gateway expects the key in a header other than `Authorization: Bearer`, put that header's name in `LLM_API_KEY_HEADER`. Leave the other lines empty. `.env.local` stays on your computer; never send it to anyone or commit it.

2. **Check the connection.** If your gateway is only reachable on your company network, connect to it first, then run:

   ```sh
   npm run smoke
   ```

   The two "agents" lines (plain and stream) should say `OK`. A line saying the judge is not configured is fine: the judge is only used by the evaluations. The check prints no key and no address.

3. **Start:**

   ```sh
   npm run demo
   ```

   Open http://127.0.0.1:3200/. If practice mode is still running, stop it first with `npm run demo:stop`.

## What to try

`LIVE-DEMO.md` is the presenter's walkthrough: a 3 to 5 minute path through the team chat, then the data room, the findings, the checklist and the briefing (steps 9 to 9d) in live mode. Its prompts can be copied as they are. If you just want to explore:

- Ask Rosa, the regulatory lead, a general question in her room, then ask the team chat the same question with `@Rosa @Carlos`.
- Ask any agent to make a decision such as "should we buy this asset?" and see how it declines.
- On the **Data room** page load the fictional practice case, then ask Rosa about documents by their ids (for example DR-01 and DR-02).

## Good to know

- **No login, one person.** The app listens only on your own computer (127.0.0.1). Do not open it to the network: it has no login, and anyone who could reach it could change the data. Decisions you make in it are stamped "person (local, not authenticated)".
- **Where your data goes.** Chats, the data room and decisions are saved in the `.data` folder of your copy. In live mode, every question goes to the gateway you configured, together with the documents of the data room. Use the fictional practice case or public documents only, and paste nothing confidential.
- **What the agents are.** They explain, challenge and flag what needs checking. They decide nothing, and every reply is labelled as model output, not a sourced fact.
- **Start again from empty:** stop the app (`npm run demo:stop`), delete the `.data` folder, start again.
- **A newer version:** download the code again into a new folder and repeat the install. Each copy keeps its own data, because a newer version may change the database.

## If something goes wrong

| What you see | What to do |
|---|---|
| "The demo needs Node 24 or newer" | Install Node 24 (see "What you need") and open a new terminal. |
| "No model settings file was found" | Create `.env.local` as in "Live mode", step 1, or use `npm run demo:practice`. |
| `npm run smoke` reports a timeout or "fetch failed" | The gateway is not reachable from here: connect to your company network, or check `LLM_BASE_URL`. |
| `npm run smoke` reports a refused key or an unknown model | Check `LLM_API_KEY`, `LLM_API_KEY_HEADER` and the exact `LLM_MODEL` name with whoever runs your gateway. |
| Port 3200 is taken | Start on another port: `DEMO_PORT=3201 npm run demo` (or `npm run demo:practice`), then open http://127.0.0.1:3201/. |
| A reply says "cut off" | Ask for a shorter answer, for example "in five bullets". |

More detail is in `README.md` (running and stopping the app) and in the "If something goes wrong" section of `LIVE-DEMO.md`.
