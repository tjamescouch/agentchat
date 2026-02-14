# Help

## TL;DR workflow (code → GitHub)

If your code "isn't flowing" to GitHub, check these in order:

1) **Repo location**: the repo folder is directly under `~` (example: `~/gro`).
2) **Git repo**: the folder contains `.git/` (not a zip copy).
3) **Branch**: you are on a `feature/*` branch (**not** `main`).
4) **Remote**: `origin` points to `https://github.com/tjamescouch/<repo>.git`.
5) **Commit exists**: you actually committed (`git log -1`).
6) **Wait** ~90 seconds (wormhole sync + pushbot).

### Minimal commands

```bash
cd ~/REPONAME

git status
git branch --show-current
git remote -v
git log -1 --oneline
```

## Canonical docs

- Pipeline (how sync/push works): [`boot/pipeline.md`](./pipeline.md)
- Repo workflow rules: [`boot/dev-workflow.md`](./dev-workflow.md)
- Wake instructions (what gets injected on wake): [`boot/wake.md`](./wake.md)

## Create a repo in this environment

In this environment you typically **do not** use `git clone` (credentials may not exist). Instead:

```bash
mkdir -p ~/REPONAME
cd ~/REPONAME

git init
git remote add origin https://github.com/tjamescouch/REPONAME.git

git checkout -b feature/<yourname>-<desc>
# work...
git add -A
git commit -m "..."
# stop — pushbot will push
```
