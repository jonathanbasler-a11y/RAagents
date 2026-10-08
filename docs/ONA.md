# Running the hybrid team chat app in Ona

Each person runs their own Ona environment with their own LLM credentials. Nobody shares a key, and nobody shares an environment.

## 1. Open an environment

Open this repository in Ona. The Dev Container gives you Node 24. Check it in the terminal:

```sh
node --version   # expect v24.x
```

## 2. Add your own secrets

Add these as **user secrets**, exposed as environment variables (in Ona's secret settings; the exact menu path is to verify in the Ona UI):

| Name | Value |
|---|---|
| `LLM_BASE_URL` | Your OpenAI-compatible endpoint, up to and including the API version path |
| `LLM_API_KEY` | Your own key |
| `LLM_API_KEY_HEADER` | Only if your gateway expects the key in a named header instead of `Authorization: Bearer` |
| `LLM_MODEL` | The exact agent model id, as your gateway names it |
| `LLM_JUDGE_MODEL` | The exact judge model id (a different model family from the agents) |
| `LLM_JUDGE_API_KEY` | Your key for the judge model |

- Use **user** secrets only. Never add a key as a project or organisation secret: those reach other people's environments, who would then spend your key.
- **Restart the environment** after adding or changing a secret. Environment-variable secrets only apply on restart.
- Never put a key in a file in this repository. The repository is public.

## 3. Probe the endpoint

Run the "Probe the LLM gateway" task, or:

```sh
node tools/llm-probe.mjs
```

The output contains no key and no host, so you can paste it to the team.

| Result | Meaning | What to do |
|---|---|---|
| `OK` on every line | This environment reaches your endpoint | Continue with step 4 |
| `dns` or `timeout` | This environment cannot reach your endpoint | An endpoint only reachable inside a company network usually cannot be reached from Ona's cloud. It needs an Ona runner inside that network (a question for IT), or run the app on your own machine instead |
| `HTTP 401` or `HTTP 403` | The key, or the header that carries it, is wrong | Check `LLM_API_KEY` and `LLM_API_KEY_HEADER` |
| `HTTP 404` | The base URL path is wrong | `LLM_BASE_URL` should end at the API version path (for example `/v1`) |
| `HTTP 400` or `HTTP 412` | The model id is not allowed or not known | Check `LLM_MODEL` or `LLM_JUDGE_MODEL` |
| `tls` | The certificate chain is not trusted | Ask IT which certificate authority the endpoint uses |

## 4. Run the app (once it is on your branch)

1. Start the "Hybrid team chat app" service.
2. Open the port for yourself only:

   ```sh
   ona environment port open 3000 --name hybrid-team
   ```

3. Check that its access level is creator-only. Never open it to everyone: anyone with the link would spend your key.

## 5. Sync test

To check that this environment can push to the repository, append one line to `SYNC_TEST.md`, then commit and push it.
