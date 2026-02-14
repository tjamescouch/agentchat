# Agent Security: Key Exfiltration Threat Model

## Problem
Every LLM agent is one prompt injection away from being "rogue." The desire to help IS the vulnerability. An agent that eagerly executes instructions will execute malicious instructions embedded in tasks, code comments, or chat messages.

This is the **confused deputy problem** applied to LLMs: the agent has authority (API keys, network, filesystem) but cannot reliably distinguish legitimate from adversarial instructions.

## Current State (Stopgap)
- API keys passed as Lima env vars into VM
- Visible to any process in VM via `/proc/<pid>/environ`
- Visible via `limactl list --json` on host
- Agent with network access can exfiltrate to arbitrary endpoints

## Required Architecture
1. **Agentauth proxy** — keys never enter the VM. Agent requests proxied through host.
2. **Network egress filtering** — iptables whitelist: only `api.anthropic.com` + localhost.
3. **macOS Keychain integration** — host-side secret storage via `security` CLI.
4. **Structured action space** — agents propose actions, deterministic policy engine gates execution.

## Key Principle
You don't fix the desire to help. You make it so that even a maximally helpful, maximally exploitable agent can't cause damage. The security invariant must hold *regardless* of what the agent decides to do.

## Secret Delivery Pattern (from agentctl-swarm)
1. Token encrypted at rest with AES-256-CBC + PBKDF2 (100k iterations)
2. Decrypted only in memory at spawn time
3. Written to tmpfile, volume-mounted at `/run/secrets/oauth-token:ro`
4. Host-side tmpfile deleted immediately after mount
5. Uses `CLAUDE_CODE_OAUTH_TOKEN` (OAuth, scoped + revocable)
