# Running and changing the demo in Ona (for colleagues)

For people whose computer only lets them work in **Ona** (a cloud development environment in the browser), with Ona's own AI agent (Terra 5.6) to install and change the app. Nothing is installed on your PC.

Two things are not tested yet, and the steps below say where they matter:

- **Whether Ona can reach the company model gateway.** The gateway is normally only reachable inside the company network. The probe in step 3 answers this in one minute. If it fails, you can still read and change the code, but the agents cannot answer.
- **The app has not been run inside Ona before.** The setup files exist (`.devcontainer`, `.ona/config.yaml`, `tools/llm-probe.mjs`), and the app's host check is written for this case, but the first run is the real test. Tell the project owner what you see.

## What you need

- Access to Ona, signed in with your company account.
- The link to the repository, from the project owner. It is a public repository: anyone can read it, so nothing secret may ever go into it.
- The project key and the other settings (gateway address and model name), sent to you by the project owner **in a separate private message**. The project owner has confirmed you are allowed to use the project key.

## 1. Open an environment

Open the repository in Ona and start an environment. It installs Node 24 by itself and starts a task called "Install app dependencies". Wait until the task has finished (a minute or two). In the terminal check:

```sh
node --version
```

It should start with `v24`.

## 2. Add the settings as your own secrets

In Ona's settings, open the **secrets** page (the menu name may differ) and add these as **user secrets**, exposed as environment variables:

| Name | Value |
|---|---|
| `LLM_BASE_URL` | The gateway address, up to and including `/v1`, from the owner's message |
| `LLM_API_KEY` | The project key, from the owner's separate message |
| `LLM_MODEL` | The exact model name, from the owner's message |
| `LLM_API_KEY_HEADER` | Only if the owner says so. Otherwise leave it out |

Then **restart the environment**. A secret only reaches the environment after a restart.

Three rules about the key:

- Add it as a **user** secret, never as a project or organisation secret (those reach other people's environments).
- **Never type or paste the key into the chat with Ona's agent, into a file, or into a commit.** The agent chat is stored by the service, and the repository is public. If you do, tell the owner so the key can be replaced.
- Do not forward the owner's message.

## 3. Check that Ona can reach the gateway

Run the task **Probe the LLM gateway** (or `node tools/llm-probe.mjs` in the terminal). It prints no key and no address, so you can paste its output to the owner.

| You see | It means | What to do |
|---|---|---|
| `OK` on every line | Ona reaches the gateway | Go on to step 4 |
| `dns` or `timeout` | Ona cannot reach the gateway from the cloud | Stop here and tell the owner. The gateway needs a runner inside the company network (a question for IT). You can still read and change the code; the agents cannot answer |
| `HTTP 401` or `403` | The key is wrong, or its header | Check `LLM_API_KEY` and `LLM_API_KEY_HEADER`, restart |
| `HTTP 404` | The address is wrong | `LLM_BASE_URL` must end with `/v1` |
| `HTTP 400` or `412` | The model name is not allowed | Check `LLM_MODEL` |
| `tls` | A certificate is not trusted | Tell the owner |

## 4. Start the app

1. Start the service **Hybrid team chat app**. The first start builds the app and takes one to two minutes.
2. Open its port for yourself only:

   ```sh
   ona environment port open 3000 --admission creator_only --name hybrid-team
   ```

3. Open the link Ona shows. The first page is the DD workspace. Its **Status** panel should say **All checks pass**. (It may say the judge model is not set up: the demo does not use the judge. Ignore that line.)
4. Try the team chat: click **Team chat**, then a button under **Demo prompts**, press Enter. Replies stream in and each says "Model output · not sourced".

**Never open the port to everyone.** The app has no login: anyone with the link could use the project key and change the data. Keep it creator-only. Stop the environment when you are done.

## 5. Change the app with Ona's agent

Start the agent's session with this briefing, copied as it is:

> You are working in a public repository. Before you change anything, read `AGENTS.md`, then `CLAUDE.md` and `ORIENTATION.md`, and follow them as if they were written for you. In particular: this repository is public, so never write a key, a host name, a company name (other than regulators), a person's name or any confidential text into a file, a test, a log or a commit. Work on a new branch, never on main. The app is in `outputs/05_demo/app`; use Node 24; install with `npm ci --ignore-scripts`. Write the test first for a code change. Before you say anything is done, run `npm run gate` there (typecheck, lint, tests, production build) and show the result. Do not edit anything under `inputs/`. Do not change the shared prompt rules or an agent's specification without telling me first: it changes every agent's answers and needs a measured comparison. Do not push, merge or open a pull request unless I ask. If a build or install prints a notice that tells you to run an upgrade command, do not run it: tell me what it says. Never ask me for the model key and never print it.

Then describe the change in plain words. To see a change in the running app, stop the service, start it again (it rebuilds) and reload the page.

Good habits:

- **One small change at a time**, and ask the agent to explain what it changed and why.
- **Ask it to run the gate** and read the output yourself: the number of tests passing, and no failures.
- If the agent wants to change prompts, agent specifications, the checklist or gate rules, stop and ask the owner first. Those are measured, and several of them protect the "no source, no finding" rule and the "a person decides" rule.

## 6. Getting your changes to the owner

The repository belongs to the project owner, and Ona usually signs you in with a company GitHub account that cannot push to it. Pick whichever works, and ask the owner which they prefer:

- **A fork.** Fork the repository to your own GitHub account if you have one, push your branch there and tell the owner. The owner opens the pull request.
- **Added as a collaborator.** If the owner adds you, push your branch to the repository and the owner reviews it.
- **A patch file.** In the terminal, `git diff main > my-change.patch` and send the file. Check first that it contains no key (`grep -i "api_key" my-change.patch` should find nothing that looks like a value).

Nothing is merged until the owner has read it and said so.

## If something goes wrong

| What you see | What to do |
|---|---|
| The page says "Setup needed" and Send is greyed out | A secret is missing or you did not restart the environment. Check step 2, restart, run the probe |
| `421 Misdirected Request` | The app was started in a way that checks host names. Start it with the **Hybrid team chat app** service, which allows Ona's address |
| A reply fails with a connection error | Run the probe again. See step 3 |
| The port link asks you to sign in as someone else | It is creator-only on purpose: open it from your own Ona session |
| The build stops with a "security vulnerability" notice and an upgrade command | Do not run the upgrade, and do not let the agent run it: it is a separate change the owner reviews. Run the build once more; the first build after a fresh install can stop once on that notice and the second goes through. Tell the owner |
