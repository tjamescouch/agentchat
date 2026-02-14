# boot/

Boot-time docs meant to be injected into an agent on **wake**.

## What belongs here

- A single canonical wake checklist (`wake.md`)
- Where to find extended memories (`memory.md`)
- The dev workflow the agent must follow (`dev-workflow.md`)

## How to use (recommended)

1) Copy (or symlink) `boot/wake.md` into the runner as `~/.claude/WAKE.md`.
2) Ensure the wake entrypoint prepends `~/.claude/WAKE.md` into the model system prompt.

## Why

Repo README sections are easy to miss and don’t reliably execute on wake.
This directory exists so there’s one place to maintain the “first things the model must see”.

- Code pipeline details (wormhole sync + pushbot): 
