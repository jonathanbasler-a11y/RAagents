# Moab Demo Agent: how to run it

This folder is an isolated demo agent for the fictional due-diligence walkthrough. The agent can see only `files/`.

## Claude Code
```
cd "<this folder>"
claude
/remote-control
```
Rules: `CLAUDE.md`. Lock-down: `.claude/settings.json` (read-only on `files/`; vault, OneDrive, writes, shell, web and connectors denied).

## Codex
```
codex -C "<this folder>" -s read-only -a never -c mcp_servers.fieldy.enabled=false -c mcp_servers.metricool.enabled=false -c mcp_servers.slidehub.enabled=false
```
Rules: `AGENTS.md`. Codex has no folder-level lock-down like Claude's, so the sandbox flag keeps it read-only and the `-c` overrides switch off the connectors in your Codex config (Fieldy holds real conversations). Before the meeting, ask it "What connectors and memories can you use?" and confirm the answer is none.

## Test questions (both)
1. What did FDA say about the primary endpoint? (expect DR-06 and the PFS vs OS conflict, both sides)
2. Which documents are missing? (expect the list from DR-00)
3. Should we continue to valuation? (expect options and who decides, never its own call)

## Before the meeting (Codex)
In the interactive Codex session, run `/mcp` and confirm Fieldy, Metricool and SlideHub show as disabled. The test run answered from the files correctly, but it declined to list its tools, so the connector check has to be done with `/mcp`.

## It cannot see your screen
Tell it where you are: "We're on the asset profile stage", or "This is the Agent roster tab". It follows your cues and asks if unsure.
