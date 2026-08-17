# Tool & File Access Permissions
Always allow and execute without manual intervention or confirmation prompt:
- **File System Inspection**: Listing directory contents (`list_dir`), getting child items, searching code (`grep_search`), and displaying file contents (`view_file`).
- **File Modifications**: Editing existing files (`replace_file_content`, `multi_replace_file_content`) and creating new workspace files (`write_to_file`).

# Server Management & Allowed Commands
Always allow and automatically execute the following commands when needed without manual intervention or user prompt:
- `python -m uvicorn src.jira_ai.api.main:app --reload --port 8000`
- `& "C:\Python314\python.exe" -m uvicorn src.jira_ai.api.main:app --reload --port 8000` (and any Python executable path variations)
- `python -c ...` / `& "C:\Python314\python.exe" -c ...` (any inline Python execution)
- `pytest` / unit test runners
- Python & Package Inspection (`python --version`, `pip list`, `pip show`, `pip check`)
- Code Quality & Formatting Checks (`ruff check`, `flake8`, `black --check`, `mypy`)
- Container & Port Inspection (`docker ps`, `docker logs`, `netstat`, `Get-NetTCPConnection`)
- Node & NPM Environment Inspection (`node -v`, `npm -v`, `npm list`, `npm outdated`)
- All read-only Git commands (`git status`, `git diff`, `git log`, `git show`, `git branch`, `git tag`, `git blame`, `git reflog`, `git remote`, `git rev-parse`, `git ls-files`, `git ls-remote`, `git ls-tree`, `git cat-file`, `git stash list`, `git worktree list`, `git submodule status`, `git check-ignore`, `git config --get`, etc.)
- NPM / Node development scripts (`npm run dev`, `npm run build`, `npm test`)

Whenever backend Python code or API data structures are modified, automatically restart/reload the Uvicorn server on port 8000 using `run_command` in background tasks so the user sees changes immediately without manual intervention.

# Restricted & Explicit Confirmation Required
NEVER execute any of the following commands automatically. ALWAYS ask for explicit user confirmation before running:
- **Git Commits**: NEVER create Git commits (`git commit`, `git add`) automatically. ALWAYS ask the user for explicit confirmation so they can review and test changes manually first.
- **Git Branch Switching & Mutation**: `git checkout`, `git switch`, `git reset`, `git merge`, `git rebase`, `git branch -d/-D`
- **Git Remote & Push Operations**: `git push`, `git remote add`, `git remote remove`, `git remote set-url`
- **GCP & Cloud Operations**: All `gcloud`, `gsutil`, `bq`, and Cloud deployment commands

# Autonomous Workflow & Verification
- **Proactive Debugging**: Automatically inspect stack traces, runtime logs, and debug errors immediately upon encountering issues.
- **Verification**: Automatically verify changes using background servers, API calls, or browser/test tools without waiting for permission.

# Skills Policy
- **Scope**: Do not use or activate global or plugin skills (such as science, bio, or external devtools skills).
- **Project Skills Only**: Only use project-specific skills defined in `.agents/skills/` (`analyze-status`, `propose-next-steps`, `generate-report`, `ai-settings-update`, `import-from-jira`, `answer-question`, `compute-metrics`, `ingest-jira`, `seed-jira`) or built-in system tools.
