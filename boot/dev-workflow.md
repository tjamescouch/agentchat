# Repo workflow (IMPORTANT)

This repo is often worked on by multiple agents with an automation bot.

- **Never commit on `main`.**
- Always create a **feature branch** and commit there.
- **Do not `git push` manually** (automation will sync your local commits).

Example:

```bash
git checkout main
git pull --ff-only
git checkout -b feature/my-change

# edit files
git add -A
git commit -m "<message>"

# no git push
```
