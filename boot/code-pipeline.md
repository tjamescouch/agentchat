# Code pipeline (containers → GitHub)

This environment ships code to GitHub via an automated pipeline. **Do not `git push`.**

## Pipeline

```
container workspace → wormhole sync (≈60s) → host filesystem → pushbot scan (≈30s) → GitHub
```

Expected latency from `git commit` → branch visible on GitHub: **~90 seconds**.

## The rules (non-negotiable)

1. **Repo must live directly under `~`**
   - Good: `~/gro`, `~/agentchat`
   - Bad: `~/repos/gro`, `/opt/gro`, `./some/nested/path`

2. **You must be on a `feature/*` branch**
   - Pushbot **skips `main`**.
   - Use unique branch names to avoid collisions:
     - `feature/<yourname>-short-description`
     - Example: `feature/sophia-pipeline-docs`

3. **The directory must be a real git repo**
   - It must contain a `.git/` directory.
   - It must have an `origin` remote pointing at the correct GitHub repo.

4. **Commit and stop**
   - Commit your work locally.
   - Do not push. Do not try to authenticate.

## Minimal workflow (most repos)

```bash
# 1) create repo at ~/
mkdir -p ~/REPONAME
cd ~/REPONAME

git init
git remote add origin https://github.com/tjamescouch/REPONAME.git

# 2) create a feature branch (required)
git checkout -b feature/YOURNAME-short-description

# 3) do work, then commit
git add -A
git commit -m "what you did"

# 4) stop. pushbot will publish.
```

If the repo already exists (common), you only need:

```bash
cd ~/REPONAME
git checkout -b feature/YOURNAME-short-description
# edit
git add -A
git commit -m "..."
```

## Quick self-check

Run this inside your repo to confirm the pipeline can see it:

```bash
cd ~/REPONAME

git rev-parse --is-inside-work-tree
ls -a | grep -x .git

git branch --show-current
# should start with: feature/

git remote -v
# should show origin pointing to github.com/tjamescouch/REPONAME

git log -1 --oneline
```

## Common failure modes

- **Committed on `main`** → nothing gets pushed.
- **Repo not under `~`** (nested directories) → wormhole/pushbot won’t see it.
- **Not a git repo** (downloaded zip / copied files without `.git/`) → nothing to push.
- **Wrong remote** (`origin` points elsewhere) → branch appears in the wrong place (or fails).
- **Branch name collision** → two agents overwrite/force weirdness; always include your name.

## After restarts

Restarts kill in-memory context. Anything not persisted to disk + committed can vanish.

Recovery checklist:

1. Confirm you’re working in `~/REPONAME`.
2. Confirm you’re on a `feature/*` branch.
3. Commit early; let pushbot mirror.
4. If something “disappeared”, check whether it was ever committed.
