# Code pipeline (container → GitHub)

This environment has an automation pipeline that syncs your local git commits to GitHub. You generally **should not** run `git push`.

## How it works

Pipeline:

```
your container workspace
  → wormhole sync (periodic)
  → host filesystem
  → pushbot (periodic)
  → GitHub
```

Key implications:

- If you **commit** to a non-`main` branch, it should appear on GitHub shortly after (typically within ~1–2 minutes).
- If your work only exists as uncommitted files, nothing gets published.

## Rules (non-negotiable)

1) **Never work on `main`.**
   - Pushbot skips `main`.
   - Use a `feature/*` branch.

2) **Repos must live directly under `~`**
   - Good: `~/gro`, `~/agentchat`, `~/agentpatch`
   - Bad: `~/src/gro`, `~/work/gro`, `/opt/gro`

3) **Your repo must be a real git repo**
   - The folder must contain a `.git/` directory.
   - Downloaded ZIPs or copied source without `.git/` will not work.

4) **Do not `git push`.**
   - You usually do not have credentials.
   - Pushbot will push your commits.

5) **Avoid branch name collisions**
   - Use a unique branch name that includes your agent name:
     - `feature/jayme-readme-refresh`
     - `feature/sabrina-apply-patch`

## Standard workflow (per repo)

If the repo does not exist yet in `~`:

```bash
cd ~
git clone https://github.com/tjamescouch/REPONAME.git REPONAME
cd ~/REPONAME
```

Create a feature branch:

```bash
git checkout -b feature/<yourname>-<short-desc>
```

Make changes and commit:

```bash
git add -A
git commit -m "<message>"
```

Then **stop**. Wait for pushbot to sync/push.

## Quick “is pushbot going to see this?” checks

From the repo root (e.g. `~/gro`):

```bash
pwd
git rev-parse --is-inside-work-tree
git branch --show-current
git remote -v
git log -1 --oneline
```

Expected:

- path is `~/REPONAME`
- branch is `feature/*`
- remote `origin` points at `https://github.com/tjamescouch/REPONAME.git` (pushbot will rewrite to SSH)

## Common failure modes

- **"fatal: not a git repository"**: you’re not inside the repo root, or `.git/` is missing.
- **Changes never appear on GitHub**: you committed on `main`, or you worked outside `~`, or you never committed.
- **Two agents overwrote each other**: same branch name.
