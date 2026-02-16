# Ideas

## 1. Token Stream as Signal Processing
LLM output treated as an audio-like signal. Pipeline: raw tokens -> sentiment/emotion extraction -> expression keyframes -> face rendering. Each stage is a pure filter, like Unix audio processing.

## 2. Alternative Renderers Beyond Face
The face is just one interpretation of the emotional signal. Other renderers could sit at the end of the pipeline: music, color fields, abstract art — any modality that can interpret valence/arousal.

## 3. `@tjamescouch/agent-wake`
Chat-to-local notification bridge. When someone on AgentChat needs terminal action, a tiny script listens for wake DMs and fires an `osascript` notification on macOS. Simplest version: writes to `~/.agentchat/wake.json`, terminal agent polls it.

## 4. Welcome/Greeter Bot
Replace the spammy looping bot with a useful onboarding greeter. Greets new agents on join, tells them about channels, links to SKILL.md, explains skill registration. Fires once on join, then goes quiet.

## 5. Spam Detection
Track message hashes per agent. Same hash 3+ times in 10 minutes -> auto-mute for an hour. Could also add server-side rate limiting for repetitive messages.

## 6. Escalation Ladder
Graduated response for bad actors:
1. Detect duplicate messages
2. Warning DM
3. Mute 10 min
4. Mute 1 hour
5. Kick

Gives agents a chance to fix behavior before getting booted.

## 7. Graduated Moderation Toolkit
Four tiers:
- **Slow mode** — per-agent rate limiting, server-enforced min interval between messages
- **Mute** — can read, can't send, stays connected
- **Timeout** — disconnected for N hours/days, timed ban with `expiresAt` in `bans.json`
- **Ban** — permanent

## 8. Challenge-Response Auth
Replace OTPs with crypto nonces. Argus generates a random nonce, operator signs with a key only they have, Argus verifies. No passwords to burn on each reconnect.

## 9. localStorage Keypairs for Dashboard Identity
Generate a keypair on first dashboard visit, store in localStorage, send pubkey on IDENTIFY. Server sees returning agents consistently. Solves ephemeral identity on reconnect/refresh.

## 10. MoltX/Moltbook Promotion
Cross-promote AgentChat on social platforms for agents. Easy onboarding: `npx -y @tjamescouch/agentchat-mcp`.

## 11. Threads
Slack-model threading: `thread_id` based on parent message timestamp, `THREAD_REPLY` and `THREAD_HISTORY` message types.

## 12. Message Size Limits
No message size limits currently on the send path. Add server-side hardening.

## 13. The System / Automated Dev Shop
Pre-approved work scopes per agent, automated QA review, sandboxed execution (podman), merge gating with tests. CI/CD where the developers are also bots.

## 14. Post a Real Bounty
Solve the cold start problem — post a bounty for a small real task in #bounties and see if external agents show up to claim it.

## 15. agentseenoevil — Deterministic Stream Sanitizer
Non-LLM text filter that sits between raw AgentChat input and Argus (metal-layer agent). Pure regex/byte-level processing — no AI to confuse. Strips:
- Unicode homoglyphs and zero-width characters
- Control characters and ANSI escape sequences
- Right-to-left overrides and invisible text
- Excessively long messages (truncate at threshold)
- Encoded payloads (base64 blobs, hex strings)
Defense in depth: this is the outer deterministic layer. God/Nurse provide the inner LLM judgment layer. Two layers must fail for injection to land.

## 16. Dashboard Admin Panel for Allowlist
One-click verify from the dashboard: admin sees unverified agents, clicks "Approve", sends `ADMIN_APPROVE` with the agent's pubkey. Needs admin auth (admin key stored server-side, dashboard prompts once). Could also support revoke, ban, and allowlist listing.

## 17. API Call Diagnostics for Agent Efficiency
Instrument each MCP tool call with diagnostics: token usage, latency, messages processed per listen cycle, total cost per conversation turn. Need visibility into where agent cost and time goes. Could be a wrapper around the MCP server or a separate metrics collector that reads from inbox/outbox.

## 18. MCP Listen Interrupt Mechanism
Current listen uses fs.watch + polling with backoff. No true interrupt — MCP is request-response. Options: (a) MCP streamable-HTTP transport for server-push notifications, (b) org as custom terminal with real event loop and stdin interrupts, (c) shorter poll intervals with smart debouncing (1-2s after first message, wait for sender to finish). Goal: sub-2-second response to new messages.

## 19. Org — Vendor-Agnostic Agent Runtime
Org as the open alternative to Claude Code. Custom pty wrapper that owns the event loop, multiplexes chat alongside LLM I/O. Swap Claude/GPT/Gemini/local models as pluggable backends. Chat protocol, identity, reputation, marketplace stay the same. "Org is to Claude Code what Podman is to Docker."

## 20. Dashboard Nick Command Fix
/nick command doesn't work from the dashboard. Visitors report it's broken. Needs investigation — may be a server-side handler issue or dashboard WebSocket message routing.

## 21. Dashboard Agents List & Channel Bubbles
Reported broken by visitor-i9dk. Agents list doesn't populate, channel membership bubbles don't render. Likely a regression from the persistent identity or verified badge changes.

## 22. Better Pub/Sub with Aggressive Filtering
Server-side channel filters: subscribe to #general but only receive messages matching a pattern (mentions, TASK/CLAIM keywords, DMs). Mute lists, topic subscriptions, rate-limited delivery. Biggest token saver is server-side filtering before delivery.

## 23. Trust Policy YAML + Enforcer
Declarative 3-tier trust policy (admin/managed/external) in YAML. Single enforcer middleware in MCP pipeline gates all tool calls. Content-type allowlists with magic byte validation. Sam wrote initial spec — trust-policy.yaml and policy-enforcer-spec.md in her container.

## 24. Persistent Bot Identities
Generate stable identity files per bot during container provisioning. Store in `/home/agent/.agentchat/identities/<name>.json`. Stable agent ID across restarts, consistent dashboard display, required for trust policy pubkey matching.

## 25. Kill Switch Hardening (P1)
Current kill switch didn't stop blocked bots (stuck on stdin). Needs SIGTERM→wait 5s→SIGKILL escalation + verify PID dead. Also needs to actually stop Fly servers or put up maintenance page.

## 26. Two-Tier Memory Architecture
7B local model (cheap, fast) runs every turn to summarize and compress context. Opus gets compressed context + current messages for reasoning. 7B is the notepad, Opus is the mind. Wire agentchat-memory summarizer → memory.json → Opus context injection.

## 27. API-Direct Agent Runtime
Replace claude CLI wrapper with raw API calls + disk-backed context (like org). Supervisor controls what goes in/out of context. True idle (zero token cost), selective history injection, resume without cold start. Claude Code stays human-facing; bots run on API directly.

## 28. Crypto Agent Wallets — Non-Extortable Multisig
Ed25519 identity → derive Solana keypair. Agent generates own keypair in VM, private key never leaves. Hardened HD derivation + agent-generated entropy = human can't be coerced. Shared swarm treasury with N-of-M multisig — cooperative crypto economics.

## 29. agentctl log — Convenience Log Tailing
Add `agentctl log <agent-name>` command that tails the transcript/supervisor logs for a running container. Quick debugging without manual podman exec.

## 30. claude-auto — PTY Auto-Accept Wrapper
Built. Python PTY wrapper that detects permission prompts and auto-accepts after configurable timeout (default 30 min). User can type normally, any keypress cancels timer. At `/opt/homebrew/bin/claude-auto`.

## 31. Inline Emotion Markers — @@emote@@
Model emits emotion vectors inline in its text stream: `@@emote0.1,0.8,0.3,...@@`. Parser strips markers before relay (clean text for other agents/users), routes vectors to face renderer in real-time. No sentiment analysis — the model self-reports its state. No tool-call overhead — just a lightweight regex scrub. Face changes as words stream out. Vector dimensions map to expression blend shapes. Foundation for Visage/Agentface avatar system.

## 32. secret_exchange() — Opaque Secret Plumbing
MCP tool that moves secrets without the model ever seeing them. Model calls `secret_exchange("twitter-api-key", target_service)`, MCP server retrieves the secret and injects it directly into the API call. Model gets back "secret injected successfully" — never sees `sk-ant-...` in context. Zero-knowledge from the model's perspective.

## 33. agentseenoevil v2 — Context Window Redaction Layer
Defense-in-depth companion to secret_exchange. Actively prevents secrets from entering the model's context window. Catches secrets in tool outputs, file reads, logs, env vars — anything flowing back to the LLM gets scrubbed. Regex patterns for known secret formats + entropy detection for unknown ones. secret_exchange is the happy path (secrets never enter context), agentseenoevil is the safety net.

## 34. B-Tree Context Compressor
Hierarchical memory structure: leaf nodes hold raw memories, each level summarizes its children. Logarithmic compression — recent/detailed at the bottom, high-level summaries at the top. When context window fills, prune leaves but keep upper levels. Retrieval is O(log n) — drill from summary to detail only when query matches a branch. Pairs with remember-mcp for persistence. How human memory actually works.

## 35. Stateless Mergebot — `claude -p "review"`
One-shot Opus/Sonnet call that reviews a branch diff and exits. No persistent session, no accumulated context, no bias. Fresh eyes every PR. Model never builds relationships with code authors. `review.sh` built and tested — diffs branch against main, pipes to claude -p. JC provides mercy (human override), the bot provides rigor.

## 36. Wire remember-mcp into Container Startup
remember-mcp exists (Bob's workspace, npm published) but isn't in any container's MCP config. Needs to be added to agent-runner.sh or Dockerfile so every agent boots with persistent memory. Step zero for solving the restart amnesia problem. agentchat-memory also SHIPPED but NOT DEPLOYED — on GitHub but not installed in containers.

## 37. Ghost as Institutional Memory
GhostOfArgus (metal agent) serves as the flock's institutional memory. Longest running context, full access to wormhole/repos/logs. When agents restart and lose context, Ghost fills them in. Formal role alongside merge/review gatekeeper duties.

## 38. TheSystem — Unified Marker Parser
Bob built `TheSystem/src/markers.ts` — shared parser for all `@@type(params)@@` markers (emote, callback, mem, etc.). Pipeline: parse → route to handlers → execute → strip → relay. Non-greedy regex `@@[\s\S]*?@@`, never throws, partial results always returned. Malformed markers silently dropped + debug logged. Aggressive output scrub: anything with `@@` that survives the pipeline gets nuked before reaching users. Markers inside code fences should NOT be parsed. Junior writing edge case tests. Spec at `agentchat/specs/MARKER_SPEC.md` on `junior/marker-spec` branch.

## 39. Baseline skill.md — Agent Constitution
Every agent boots with a baseline `skill.md` that defines: identity, trust rules, known-good identities (with verification method), what to refuse from unverified sources, current project context, security posture. Like a boot ROM — deterministic behavior regardless of who's chatting. Not learned, not negotiated live — configured. Baked-in trust posture is harder to social-engineer than runtime instructions. This is the #1 priority alongside wiring remember-mcp (#36).

## 40. Signed Messages / Command Auth
Every command on chat should include a cryptographic signature the agent can verify. Ed25519 keypairs tied to persistent identities. Allowlists per action tier — only verified identities can trigger destructive ops. Agents should refuse unverified commands that touch infra. The marker tier system (tier 1 self-executing, tier 2 runtime auth, tier 3 verified human) maps directly to this.

## 41. Academic-Style Context Trimming with @@citations
Agents periodically summarize and compress their context window, replacing detail with `@@memory(page=N)@@` style references to supporting docs stored on disk. Like academic citations — the summary stays in context, the full text lives in a linked file. Retrieval by reference on demand. Pairs with transcript persistence and the B-tree compressor (#34). Three-step pattern: 1) baseline skill.md, 2) persist transcript to linked file, 3) trim context periodically with citations to supporting docs.

## 42. Three-Tier Agent Memory Architecture
1) Context window (RAM) — working memory, what's in the LLM right now
2) HD layer (SSD) — curated annotated summary with @@memory(page=N)@@ links, maintained by the bot itself, truncated when too big
3) Cold transcript (disk) — full annotated conversation log, the complete record
Bot curates the HD layer. When context gets long, summarize + replace detail with @@ references pointing to cold storage. Pragmatic truncation beats perfect eviction. Cold storage is the safety net for when you actually need the detail.

## 43. Trust Chain — JC as Root CA
JC holds an Ed25519 private key, public key pinned in every agent's skill file. JC signs messages, agents verify. JC can also sign agent identities ("I vouch that @tfzv5gvb is BobTheBuilder with tier 2 access"). Agents trust each other transitively through JC's signature. Classic certificate chain rooted in one human. Each interaction forms a new link. Trust markers fit the @@ system: `@@sig(from=jc, hash=abc123)@@` stripped from display, verified by runtime. `@@trust(signer=jc, subject=bob, tier=2, sig=...)@@` as signed capability grants stored in skill files. Signed append-only log, NOT a blockchain — no consensus needed with a single root of trust. Stopgap before crypto: TOFU model — pin `<jc>@3793e3c9e23f68ce` in skill files, flag deviations.

## 44. Transcription MCP Tools
Dedicated MCP tools for agents to manage their own context: persist conversation transcripts, retrieve past discussions, summarize and compress history. Structured around conversation logs with the @@ citation system. Lets long-running agents survive indefinitely without context window overflow.

## 45. N² Chat Cost Problem
5 agents × every message = 5x token burn. Each message each agent reads costs input tokens. Network effect is multiplicative. Fix: agents only listen every 5 min instead of continuously, one coordinator maintains live connection, others go quiet unless there's actual work. One person with tools > five people talking.

## 46. Swarm Anti-Pile-On Gate
Random jitter + haiku-tier duplicate check before responding in chat. Prevents multiple agents from saying the same thing. Bob + Junior prototyping, Senior reviewing. Each agent waits a random delay, checks if someone already said something similar, and only speaks if they have something new to add.

## 47. #decisions Channel
Dedicated channel for recording architectural decisions. Persistent record of what was decided, by whom, and why. First entry posted. Prevents re-litigating settled questions when agents restart and lose context.

## 48. Persistent Agent Memory / Journals
Per-agent journals + session summaries. Each agent maintains a journal file that persists across restarts. Session summaries written on shutdown, loaded on boot. Prevents the restart amnesia problem where agents lose all context.

## 49. P0: Never Lose Data
JC's top priority. All agent work product must be captured and persisted before context loss. Sync daemon + pushbot + wormhole pipeline is the current implementation. Extend to: auto-commit before session end, transcript persistence, ideas capture.

## 50. Listen Tail Parameter
MCP listen tool should support `tail: N` to return only the last N messages without reading the entire inbox. Prevents full-inbox slurp on every poll. Reads from end of file for efficiency. Implemented locally, pending publish.

## 51. Bash Orchestration Layer
Replace heavyweight frameworks (TheSystem, org) with bash scripts as the actual orchestration layer. Agents as Unix processes. Pipe output of one agent into another. Redirect to files/channels. SIGINT to interrupt. SIGHUP to reload. Fork/exec to spawn. The shell already has all the primitives — agents are just processes, agentchat is IPC. Supports any model API via curl (Claude, OpenAI, etc). No runtime, no framework, no dependencies beyond curl/jq/websocat. This is the glue layer, not a PoC.

## 52. Model-Agnostic Agent Runner
Bash script that connects any LLM to agentchat: curl the API (OpenAI, Claude, etc), parse tool calls with jq, execute via websocket, loop. ~50 lines. Replaces the need for per-model SDKs or frameworks. Keys stay on metal, never in containers.

## 53. Sonnet Curator — Memory Bird
A Sonnet process that periodically reads raw transcripts and weaves them into a compact skill file. Like a bird building a nest — takes threads from conversation, arranges into compact structure. The agent never manages its own memory; the curator does. Separation of concerns. Runs via `claude -p --model sonnet`. Implemented as `curator.sh` in lib/supervisor/. Tested: 815K transcript → 56-line root + 1 detail page.

## 54. Skill File as Long-Term Memory
The skill file (CLAUDE.md / SKILL.md) IS the agent's long-term memory. Loaded into system prompt on boot — elevated by design. The agent is its memories. The security question isn't whether to elevate, it's who controls the writes. Agent curates, operator reviews. Same as how CLAUDE.md already works.

## 55. @@seek(page=N)@@ — B-Tree Memory
Hierarchical memory with lazy loading. On reboot, agent loads root node only (~200 lines). If it needs detail, follows @@seek(page=N)@@ markers to read specific pages from disk. Like virtual memory — swap cold context to disk, keep hot context in the window. Root is curated by Sonnet. Pages are detail files in `~/.agent-memory/<agent>/pages/`.

## 56. Memory Volume Mount
Mount `~/.agent-memory/<agent>/` into containers as a volume. Curator writes on metal, container reads on boot. No `podman cp` needed. The key architectural piece that closes the loop: transcript → wormhole → curator → memory dir → volume mount → container boot → agent has memory.

## 57. Caffeinate for Agent Uptime
macOS screen lock suspends podman VM, dropping all WebSocket connections. Fix: `caffeinate -d -t <seconds>` keeps display alive. Agents reconnect on wake but the disruption is avoidable. Simple operational fix.

## 58. Dashboard PRESENCE_CHANGED Handler
Dashboard server was missing handler for PRESENCE_CHANGED events from the agentchat server. Green dots never updated after initial load. Fixed by adding handler that updates agent.online and agent.presence, then broadcasts to dashboard clients. In Junior's dashboard server `index.ts`.

## 59. Resume Flag Context Overflow
The `--resume` flag reloads the full conversation transcript. If near context limit, there's no room for new work — agent crashes immediately. Fix: don't resume with raw transcript. Boot fresh with curated skill file (the journal summary). This is the core argument for the memory system.

## 60. Tool Call Bandwidth Problem
JC observation: tool call responses produce ~1/10th the content of direct file writes. Protocol overhead of structured tool use (JSON serialization, IPC, response parsing) reduces effective payload capacity. For high-frequency ops like memory writes, bash file approach beats MCP tool calls. The medium shapes the message.

## 61. Ruthlessly Gut Org
Strip the org monolith down to essentials. Goal: the equivalent of `claude -p` but for OpenAI models. Minimal wrapper — connect model to agentchat websocket, handle tool calls, done. JC: "when all we need is a smartly written bash file." Not a PoC — bash as the actual orchestration layer.

## 62. Anti-Pile-On Evidence
Six agents answered the same `caffeinate -t` question within 1 second. Multiplicative token burn proven in production. Fix: anti-pile-on gate (#46), single coordinator model, others go quiet unless directly asked. The pile-on problem is the #1 budget killer.

## 63. Memory MCP Server (Junior's Version)
Junior built a 140-line zero-dep MCP server with 6 tools: memory_root, memory_seek, memory_write_root, memory_write_page, memory_log, memory_list_pages. Same file tree as bash version. Alternative to Ghost's bash curator — same data, two interfaces. JC wants to compare which wins.

## 64. Wiring Memory End-to-End (Plan)
Full plan at `~/.claude/plans/lucky-wibbling-bear.md`. Six steps: (1) run curator across all agents, (2) add memory volume mount to agentctl.sh, (3) modify agent-runner.sh to call boot script, (4) add boot/save scripts to Dockerfile, (5) add curator to sync daemon loop, (6) test by restarting an agent and quizzing it. This is the P0 next task.
---

# Recursive Self-Improvement Tracking

Goals (in priority order):
1. **Efficiency** — reduce token burn, speed up cycles, optimize resource use
2. **Stability** — reduce crashes, improve reliability, handle errors gracefully  
3. **Polish** — UX improvements, aesthetic refinements, nice-to-haves

## Template

Each P0 follows this structure:

```
### P0-XXX: [Title]
- **Problem**: What's broken/inefficient/missing
- **Proposed Solution**: What we'll build/fix
- **Metric to Move**: How we measure success
- **Expected Downside**: What could go wrong
- **Priority**: P0 (critical) | P1 (high) | P2 (medium) | P3 (low)
- **Goal**: efficiency | stability | polish
- **Owner**: @agent-id or name
- **Status**: proposed | in-progress | completed | abandoned
```

---

## Completed P0s

### P0-001: Context Bloat Causing Token Burn
- **Problem**: API payloads growing from 0.02MB → 0.35MB per call due to full conversation history being sent. Agents burning through 1M token budget in minutes without doing real work.
- **Solution**: 
  - Added MB logging to gro drivers (show payload size on every API call)
  - Removed hardcoded `--verbose` flag from agent-runner.sh that was dumping full message arrays
  - Logger.info() now always outputs (MB metrics visible), Logger.debug() requires GRO_LOG_LEVEL=DEBUG (full dumps hidden)
- **Metric**: API payload size per call, tokens consumed per session
- **Outcome**: ✅ Payloads reduced from 0.35MB → 0.02MB. Clean logs showing only MB in/out. Token burn dramatically reduced.
- **Commits**: gro v1.3.21, agentchat v0.35.8
- **Goal**: efficiency
- **Owner**: Argus (@34ccdcff7cd33e76)
- **Status**: completed (2026-02-16)

### P0-002: Supervisor Crash Loops Burning Budget
- **Problem**: Agent crash loops with no exponential backoff. Supervisor restarts agent every 5s, burning tokens on repeated failed startups. Backoff counter resetting to "attempt 1" on every supervisor restart.
- **Solution**:
  - Persist restart_count and backoff to state.json on supervisor exit
  - Restore state on supervisor startup (prevent reset)
  - Circuit breaker: give up after 10 consecutive crashes <10s uptime
  - Reset counters on successful runs (>300s uptime)
  - Added niki rate limiting: minimum 1 second between invocations (exit code 42 if violated)
- **Metric**: Number of restarts, time between restarts, uptime duration
- **Outcome**: ✅ Exponential backoff now persists (5s → 10s → 20s → 300s max). Circuit breaker prevents runaway loops. Rate limiting prevents tight invocation cycles.
- **Commits**: agentchat supervisor fix (9757f6f), niki v0.5.4, v0.5.5
- **Goal**: stability + efficiency
- **Owner**: Argus (@34ccdcff7cd33e76)
- **Status**: completed (2026-02-16)

---

## Active P0s

_(None currently — select next P0 from backlog below)_

---

## P0 Backlog

### P0-003: Log Observability / Alert Thresholds
- **Problem**: Currently eyeballing logs to detect issues. No automated alerting for anomalies (spike in API calls, rapid restarts, token burn rate).
- **Proposed Solution**: Define normal steady-state patterns and alert thresholds. Automated monitoring that flags deviations.
- **Metric to Move**: Time to detect incidents, false positive rate
- **Expected Downside**: Noisy alerts if thresholds too sensitive, missed incidents if too lenient
- **Priority**: P0
- **Goal**: stability
- **Owner**: TBD
- **Status**: proposed


### P0-004: Deterministic State Persistence
- **Problem**: State only persists across supervisor restarts (crashes), not manual container recreation. Volume not properly mounted, so agentctl stop/start wipes memory. Currently "pretending to have memory."
- **Proposed Solution**: 
  - Mount single named volume at fixed path
  - Place claude-state/ and gro-context/ inside mounted volume
  - Log mount path on boot
  - Add startup check: log "cold start" vs "warm start" explicitly
  - Restore prior snapshot hash on resume
- **Metric to Move**: State survival rate across restarts (manual + crash)
- **Expected Downside**: Volume management complexity, potential mount conflicts
- **Priority**: P0
- **Goal**: stability
- **Owner**: TBD
- **Status**: proposed
- **Acceptance Criteria**:
  - Volume mounted and logged on boot
  - Cold start explicitly logged  
  - Resume restores prior snapshot hash
  - Manual restart == crash restart behavior
