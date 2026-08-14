# Allowed Read-Only Git Commands

Always allow and automatically execute any of the following read-only Git commands without manual intervention or confirmation prompts:

## 1. Repository Status & Diff
- `git status`
- `git diff`
- `git diff-tree`
- `git diff-files`
- `git diff-index`

## 2. History & Log Inspection
- `git log`
- `git shortlog`
- `git reflog` / `git reflog show`
- `git show`
- `git annotate`
- `git blame`
- `git bisect log`
- `git bisect visualize`

## 3. Branches, Tags & References
- `git branch` (including `-a`, `-r`, `--list`, `--contains`, `--merged`, `--no-merged`)
- `git tag` (including `-l`, `--list`)
- `git show-ref`
- `git rev-parse`
- `git rev-list`
- `git name-rev`
- `git describe`
- `git symbolic-ref`

## 4. Repository & Configuration Inspection
- `git config --list` / `git config --get` / `git config --get-regexp`
- `git remote` / `git remote -v` / `git remote show`
- `git ls-files`
- `git ls-remote`
- `git ls-tree`
- `git cat-file`
- `git count-objects`
- `git check-ignore`
- `git check-attr`
- `git stash list`
- `git worktree list`
- `git submodule status`
- `git help` / `git --help`
- `git version`
