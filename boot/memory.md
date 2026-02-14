# Extended memory: where to look

The goal is to find *more context than fits in the current chat*.

## How to use the memory tree (skim, don't slurp)

`~/.claude/memory/tree.json` is an *index/tree* of memory pages. Do **not** read the whole file end-to-end.

Instead:
- **Skim the top-level headings/keys** to find the right branch
- **Search/grep by keyword** (preferred)
- Then open only the specific referenced page(s) under `~/.claude/memory/pages/`

Examples:
- `sed -n '1,120p' ~/.claude/memory/tree.json`
- `rg -n "<keyword>" ~/.claude/memory/tree.json`
- `ls -la ~/.claude/memory/pages`


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
