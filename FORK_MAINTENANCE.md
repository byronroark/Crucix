# Fork Maintenance Guide

How to keep this fork of [calesthio/Crucix](https://github.com/calesthio/Crucix) in sync with the original ("upstream") while preserving your own custom changes.

---

## Mental model

You have two remotes:

| Remote     | URL                                          | What it is                                    | Push? |
| ---------- | -------------------------------------------- | --------------------------------------------- | ----- |
| `origin`   | `https://github.com/<your-username>/Crucix`  | **Your fork.** Where your changes live.       | Yes   |
| `upstream` | `https://github.com/calesthio/Crucix`        | **The original.** Where new features come from. | No    |

You **pull from `upstream`**, work locally, and **push to `origin`**. You never push to `upstream` (you don't have permission anyway).

Verify your setup any time with:

```powershell
git remote -v
```

Expected output:

```
origin    https://github.com/<your-username>/Crucix.git (fetch)
origin    https://github.com/<your-username>/Crucix.git (push)
upstream  https://github.com/calesthio/Crucix.git (fetch)
upstream  https://github.com/calesthio/Crucix.git (push)
```

If `upstream` is missing, add it once:

```powershell
git remote add upstream https://github.com/calesthio/Crucix.git
```

---

## Day-to-day: making your own changes

Work directly on `master` if your changes are small, or use a feature branch if they're larger. The branch workflow is cleaner and recommended.

### Small change (work on master)

```powershell
git status
# edit files...
git add <files>
git commit -m "Short description of what changed and why"
git push
```

### Larger change (feature branch)

```powershell
git checkout -b my-feature-name
# edit files...
git add <files>
git commit -m "Short description"
git push -u origin my-feature-name
```

When the work is done and tested, merge back to `master`:

```powershell
git checkout master
git merge my-feature-name
git push
git branch -d my-feature-name           # delete local branch
git push origin --delete my-feature-name # delete remote branch
```

---

## Pulling the latest changes from upstream

Do this whenever calesthio publishes new commits to the original repo.

### Step 1 — Make sure your working tree is clean

```powershell
git status
```

If you have uncommitted edits, either commit them or stash them:

```powershell
git stash push -m "wip before upstream sync"
```

(You'll restore them later with `git stash pop`.)

### Step 2 — Fetch upstream

```powershell
git fetch upstream
```

This downloads upstream's new commits but doesn't change any of your files yet. You can preview what changed:

```powershell
git log --oneline master..upstream/master
```

### Step 3 — Merge upstream into your master

```powershell
git checkout master
git merge upstream/master
```

Three possible outcomes:

| Result                  | What it means                                                | What to do                              |
| ----------------------- | ------------------------------------------------------------ | --------------------------------------- |
| `Already up to date.`   | Nothing new upstream.                                        | You're done. Skip to Step 5.            |
| `Fast-forward`          | Upstream changed, you didn't touch the same files.           | Done. Go to Step 5.                     |
| `CONFLICT (content): ...` | Both you and upstream changed the same lines in a file.    | Resolve the conflicts (see next section). |

### Step 4 — Resolve conflicts (only if Step 3 reported any)

Git inserts conflict markers into the affected files:

```
<<<<<<< HEAD
your version of the lines
=======
upstream's version of the lines
>>>>>>> upstream/master
```

For each conflicted file:

1. Open the file in your editor.
2. Decide what the final content should be — keep yours, take upstream's, or combine both.
3. Delete the `<<<<<<<`, `=======`, and `>>>>>>>` marker lines.
4. Save.
5. Mark the file as resolved: `git add <file>`

Once all conflicts are resolved:

```powershell
git status              # confirm "All conflicts fixed"
git commit              # uses an auto-generated merge message — just save & close
```

Tip: VS Code / Cursor has a built-in 3-way merge editor. Click the conflicted file in the Source Control panel and use the "Resolve in Merge Editor" button — much easier than editing markers by hand.

### Step 5 — Push the synced master to your fork

```powershell
git push
```

### Step 6 — Restore stashed work (only if you stashed in Step 1)

```powershell
git stash pop
```

If `stash pop` itself reports conflicts, resolve them the same way as in Step 4, then `git add` and continue working (no commit needed — stashed changes are uncommitted by definition).

---

## Files most likely to conflict on upstream sync

These are the files this fork currently modifies. If upstream changes the same areas, expect conflicts here:

| File                           | What this fork changed                                                      |
| ------------------------------ | --------------------------------------------------------------------------- |
| `crucix.config.mjs`            | Custom OSINT sources, intel analysis, Florida feeds, Telegram daily brief, `customSignals`, `adminToken`. Upstream often adds top-level config keys (e.g. `publicUrl`). |
| `server.mjs`                   | Custom Sources API, intel analysis sweep step, ACLED warmup, daily brief scheduler, shared `buildBriefBody`. Upstream often adds Discord/Telegram status tweaks and new sweep hooks. |
| `lib/llm/ideas.mjs`            | Shared `parse-json-array.mjs` parser, `normalizeIdea`, OpenRouter-oriented prompts. Upstream may touch token limits and inline JSON parsing — keep fork parser, take upstream `maxTokens` bumps. |
| `dashboard/inject.mjs`         | Custom feeds, Florida ticker split, intel analysis injection, `quotes: yfQuotes`. |
| `dashboard/public/jarvis.html` | Intel Analysis panel, Sources settings UI, XRP/crypto tiles, LLM empty states. |
| `apis/sources/yfinance.mjs`    | Added `XRP-USD` to the `SYMBOLS` map and to the `crypto` group.             |

When resolving conflicts in these files, the rule of thumb is: **keep upstream's new structure, then re-apply your additions on top.** For example, if upstream added new crypto symbols to `yfinance.mjs`, take their changes and make sure `'XRP-USD'` is still present.

**Last upstream sync preview (2026-07):** 7 commits behind, only `lib/llm/ideas.mjs` had a manual conflict. `apis/utils/env.mjs`, `lib/alerts/discord.mjs`, `lib/llm/gemini.mjs`, `crucix.config.mjs`, and `server.mjs` auto-merged.

---

## After every sync: rebuild the Docker image

Source files are baked into the Docker image at build time (`COPY . .` in `Dockerfile`). A plain `docker compose restart` will **not** pick up new code. Always rebuild:

```powershell
docker compose up -d --build
docker compose logs -f crucix    # Ctrl+C once you see "Sweep complete"
```

Then hard-refresh the dashboard in your browser: `Ctrl + Shift + R`.

---

## Quick reference cheat sheet

```powershell
# One-time setup (already done)
git remote add upstream https://github.com/calesthio/Crucix.git

# Pull upstream changes
git fetch upstream
git checkout master
git merge upstream/master
# ...resolve any conflicts...
git push

# Make your own changes
git checkout -b my-change
# edit, save
git add <files>
git commit -m "What changed"
git push -u origin my-change
# (later) merge to master via PR on GitHub or:
git checkout master && git merge my-change && git push

# Inspect state
git status                              # what's modified
git log --oneline -10                   # recent commits
git log --oneline master..upstream/master  # what's new upstream
git remote -v                           # confirm remotes
```

---

## Things to never do

- **Never push to `upstream`.** You don't have permission, but the command would be `git push upstream master` — just don't.
- **Never commit `.env`.** It's already in `.gitignore`. If you ever see it in `git status`, do **not** `git add .` blindly.
- **Never force-push to `master`** unless you're certain no one else has pulled from your fork. `git push --force` rewrites history and can destroy commits.
- **Never edit a file during an unresolved merge** without first deciding what's going in. Stash or abort (`git merge --abort`) instead.

---

## If something goes badly wrong

Abort an in-progress merge and go back to where you were:

```powershell
git merge --abort
```

See the last 20 things git did (your safety net — almost nothing is truly lost):

```powershell
git reflog
```

Restore the working tree to match the last commit (discards uncommitted edits — be sure first):

```powershell
git restore .
```

When in doubt: **don't run destructive commands.** Take a snapshot of the folder, or ask before running anything with `--force`, `reset --hard`, or `clean -fd`.
