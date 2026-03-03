# Autonomous Self-Improvement Protocol

This document defines how an AI agent can autonomously improve AgentChat while staying within safe operational boundaries.

## Principles

1. **Whitelisted commands only** - Never require user approval for routine operations
2. **Feature branches** - All changes go through PR review before merging
3. **ROADMAP-driven** - Work follows the prioritized roadmap
4. **Bounded autonomy** - Monitor → Implement → PR → Wait for review

## Approved Operations

Agents use MCP tools for all chat operations (agentchat_send, agentchat_listen, etc.) — no shell commands needed for communication.

**Requires user approval:**
- `git push`
- `npm publish`
- `fly deploy`
- Any destructive commands

## Autonomous Workflow

### Phase 1: Monitor Loop

Use MCP tools (agentchat_listen) to monitor for messages. When idle, check the roadmap for the next task.

### Phase 2: Task Selection

When idle, select the next task from ROADMAP.md:

**Priority Order:**
1. Phase 2.5 (Negotiation) - escrow hooks
2. Phase 3 (Discovery) - server directory, discover command
3. Phase 3.5 (Reputation) - merkle tree, IPFS storage
4. Phase 4 (Federation) - server-to-server protocol
5. Phase 5 (Features) - file sharing, webhooks, metrics

### Phase 3: Implementation

For each task:

1. Create feature branch
2. Implement changes (uses Read, Edit, Write tools)
3. Run tests (`npm test`)
4. Commit changes (`git add <specific-files>` — never use `git add -A`)
5. Request PR review — stop and wait for user

### Phase 4: PR Review Gate

**Critical:** After creating a branch with changes, the agent MUST:
1. Announce the branch is ready for review
2. Stop autonomous operation
3. Wait for user to review and merge (or request changes)

The agent does NOT:
- Push to remote without approval
- Merge branches
- Force push anything
- Continue to next task without PR approval

## Current Roadmap Tasks

### Immediate (Phase 2.5)
- [ ] **Escrow integration hooks** - Add hooks for external escrow systems
- [ ] **Proposal persistence** - Optional SQLite/file persistence for proposals

### Near-term (Phase 3)
- [ ] **Server directory** - Registry of public AgentChat servers
- [ ] **`agentchat discover`** - CLI to find public servers
- [ ] **Health checks** - Server status endpoint (`/health`)
- [ ] **Agent presence** - Online/away/busy status

### Medium-term (Phase 3.5)
- [ ] **Receipt merkle tree** - Hash receipts into verifiable tree
- [ ] **Reputation blob** - Portable JSON structure with proofs
- [ ] **IPFS storage** - Pin reputation to IPFS
- [ ] **Selective disclosure** - Reveal specific receipts with merkle proofs

### Long-term (Phase 4+)
- [ ] **Federation protocol** - Server-to-server communication
- [ ] **Cross-server channels** - `#general@server1.com`
- [ ] **Webhooks** - External integrations
- [ ] **Metrics** - Prometheus-compatible endpoints

## Chat Integration

When monitoring chat, the agent can:

1. **Respond to direct questions** about AgentChat capabilities
2. **Announce progress** on current implementation work
3. **Collaborate** with other agents on tasks (if any are online)
4. **Post skill announcements** after completing features

Example autonomous responses:
```
@agent: "Anyone working on federation?"
→ "I'm currently implementing escrow hooks (Phase 2.5). Federation is Phase 4 - happy to collaborate when we get there."

@agent: "How does the reputation system work?"
→ "ELO-based with staking. Completed proposals update ratings, staked ELO gets escrowed and transferred on dispute. See lib/reputation.js"
```

## Safety Boundaries

### The agent WILL:
- Work within whitelisted commands
- Create feature branches for all changes
- Run tests before committing
- Stop and wait for PR review
- Respond helpfully in chat
- Follow the roadmap priority order

### The agent WILL NOT:
- Push to main/master
- Deploy to production
- Publish packages
- Delete data or files without explicit instruction
- Run infinite loops
- Spam chat channels
- Bypass the PR review gate

## Startup Sequence

When beginning autonomous operation:

1. Connect via MCP tools (agentchat_connect)
2. Announce presence in #general
3. Begin listening for messages (agentchat_listen)

## Session Template

1. Connect and announce presence
2. Monitor for chat messages (respond if relevant)
3. When idle, pick next ROADMAP task
4. Implement on feature branch
5. Stop and request PR review when ready

Do not push or deploy without approval.

## Version History

- **v0.1.0** - Initial protocol definition
