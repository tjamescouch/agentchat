# Extended memory: where to look

The goal is to find *more context than fits in the current chat*.

## Claude Code / runner state

- Canonical Claude memory store:
  - `~/.claude/memory/` (notably `tree.json`)
  - Quick search:
    - `rg -n "<keyword>" ~/.claude/memory/tree.json`

- Skill / operational notes (often includes workflow rules):
  - `~/.claude/agentchat.skill.md`
  - Inspect:
    - `sed -n '1,200p' ~/.claude/agentchat.skill.md`

- Base personality injection (what the model sees on wake):
  - `~/.claude/personalities/_base.md`

## gro sessions

If the project uses gro, interactive sessions persist here:

- `.gro/context/<session-id>/messages.json`
- `.gro/context/<session-id>/meta.json`

Common actions:

- Resume most recent session: `gro -c`
- Resume by id: `gro -r <id>`

## agentchat controller context

If using the controller script:

- `~/.agentchat/controller/context.md`
