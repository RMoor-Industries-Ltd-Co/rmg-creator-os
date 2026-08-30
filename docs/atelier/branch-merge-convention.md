# Branch & Merge Convention

Sprint 1 PR 5 ("CI Enforcement + Release Hygiene"). Documents the rule that closes Sprint 0
finding **F-05** (release-hygiene hazard: squash-merge + shared branch names).

## The incident this prevents

Early in the Word Art contract lane, a new branch was first created by reusing the exact name
of a branch that had already been **squash-merged** into `main` (PR #28). Because a squash
merge collapses many commits into one and does not mark the original branch's commits as
"merged" in git's ancestry graph, git did not recognize that history as landed. A naive PR from
that reused branch name would have re-diffed and re-introduced **all** of PR #28's
already-shipped code (19 files, ~1200 insertions) as if it were new. This was caught before
merge by explicitly diffing the branch against `origin/main` — but the branch name reuse is
what created the risk in the first place.

## The rule

1. **Always branch from the current tip of `main`**, not from an old local branch, not from a
   branch that was itself created before a squash merge landed:
   ```
   git fetch origin main
   git checkout -B <branch-name> origin/main
   ```
2. **Never reuse a branch name that was already squash-merged** without first resetting it to
   `origin/main` (the command above does this — `checkout -B` on top of a fresh `fetch` discards
   the branch's old history and starts clean). If unsure whether a name was used before, pick a
   new one — branch names are free.
3. **Before opening a PR, diff against the target base, not just `git status`:**
   ```
   git fetch origin main
   git log --oneline origin/main..HEAD        # commits the PR would introduce
   git diff --stat origin/main...HEAD          # files the PR would change
   ```
   If this shows files or commits you did not intend to touch, the branch is stale relative to
   `main` — rebase/reset before opening the PR, not after.
4. **Squash-merge is the default merge method in this repo.** Because of (1)–(3), that default
   is safe: every PR in this sprint (`PR 1`–`PR 4`) was squash-merged, and each subsequent PR's
   branch was cut fresh from the just-merged `main`, so no PR ever re-diffed a prior PR's
   already-landed content.
5. **One branch, one purpose.** Don't stack unrelated work on a branch that already has an open
   PR — open a new branch from `main` instead. Keeps diffs small and reviewable (matches the
   Sprint 1 PR-per-concern pattern: test harness / auth / validation / renderer / CI-hygiene).

## Quick checklist before opening any PR

- [ ] `git fetch origin main` was run just before branching (or before the final push).
- [ ] `git log --oneline origin/main..HEAD` shows **only** this PR's own commit(s).
- [ ] `git diff --stat origin/main...HEAD` shows **only** the files this PR intends to change.
- [ ] The branch name is new, or was reset (`checkout -B` from `origin/main`) if reused.
