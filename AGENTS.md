# Tool & File Access Permissions
Always allow and execute without manual intervention or confirmation prompt:
- **File System Inspection**: Listing directory contents (`list_dir`), getting child items, searching code (`grep_search`), and displaying file contents (`view_file`).
- **File Modifications**: Editing existing files (`replace_file_content`, `multi_replace_file_content`) and creating new workspace files (`write_to_file`).

# Server Management & Allowed Commands
Always allow and automatically execute the following commands when needed without manual intervention or user prompt:
- `python -m uvicorn src.jira_ai.api.main:app --reload --port 8000`
- `& "C:\Python314\python.exe" -m uvicorn src.jira_ai.api.main:app --reload --port 8000` (and any Python executable path variations)
- `python -c ...` / `& "C:\Python314\python.exe" -c ...` (any inline Python execution)
- `pytest` / test runners (`pytest`, `python -m pytest`, `py -3.14 -m pytest`, `& "C:\Python314\python.exe" -m pytest`, `python -m unittest`, `py -3.14 -m unittest`, `& "C:\Python314\python.exe" -m unittest ...`)
- Python & Package Inspection (`python --version`, `py -3.14 --version`, `pip list`, `py -3.14 -m pip list`, `& "C:\Python314\python.exe" -m pip list`, `pip show`, `& "C:\Python314\python.exe" -m pip show`, `pip check`)
- Code Quality & Formatting Checks (`ruff check`, `flake8`, `black --check`, `mypy`)
- Container & Port Inspection (`docker ps`, `docker logs`, `netstat`, `Get-NetTCPConnection`, `Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue`, `Get-NetTCPConnection -LocalPort ...`)
- Node & JavaScript Executions (`node`, `node -v`, `node -e ...`, `npm run dev`, `npm run build`, `npm test`, `npm -v`, `npm list`, `npm outdated`)
- All read-only Git commands (`git status`, `git diff`, `git log`, `git show`, `git branch`, `git tag`, `git blame`, `git reflog`, `git remote`, `git rev-parse`, `git ls-files`, `git ls-remote`, `git ls-tree`, `git cat-file`, `git stash list`, `git worktree list`, `git submodule status`, `git check-ignore`, `git config --get`, etc.)

Whenever backend Python code or API data structures are modified, automatically restart/reload the Uvicorn server on port 8000 using `run_command` in background tasks so the user sees changes immediately without manual intervention.

# Restricted & Explicit Confirmation Required
NEVER execute any of the following commands automatically. ALWAYS ask for explicit user confirmation before running:
- **Git Commits**: NEVER create Git commits (`git commit`, `git add`) automatically. ALWAYS ask the user for explicit confirmation so they can review and test changes manually first.
- **Git Branch Switching & Mutation**: `git checkout`, `git switch`, `git reset`, `git merge`, `git rebase`, `git branch -d/-D`
- **Git Remote & Push Operations**: `git push`, `git remote add`, `git remote remove`, `git remote set-url`
- **Unrecoverable Git Clean**: `git clean -fdx`, `git clean -f`, `git stash clear`, `git stash drop`
- **Cloud, Infrastructure & Deployments**: All `gcloud`, `gsutil`, `bq`, `aws`, `az`, `terraform apply`, and cloud deployment commands
- **Package & Container Publishing**: `npm publish`, `yarn publish`, `twine upload`, `docker push`, `cargo publish`
- **Destructive File System Operations**: `rm -rf`, `Remove-Item -Recurse -Force`, `del /s /q`
- **Container Volume Destruction**: `docker compose down -v`, `docker-compose down --volumes`, `docker system prune -a`
- **Database Resets & Destructive Migrations**: `prisma migrate reset`, `alembic downgrade base`, `flyway clean`, direct `DROP DATABASE` / `DROP TABLE`
- **Global Package Installations**: `npm install -g`, `pip install` (outside of a virtual environment)
- **System and Environment Modifications**: Modifying Windows Registry, `setx`, `Set-ExecutionPolicy`
- **Indiscriminate Process Termination & Shutdown**: `taskkill /F /IM ...`, `Stop-Process -Force` (without specific known child PID), `shutdown`, `Restart-Computer`
- **Credential & Key Manipulation**: Accessing or modifying `~/.ssh/`, `~/.aws/`, `~/.kube/`, `~/.npmrc`, `~/.docker/config.json`
- **Remote Script Execution**: `Invoke-WebRequest <url> | Invoke-Expression`, `curl <url> | bash`

# Autonomous Workflow & Verification
- **Proactive Debugging**: Automatically inspect stack traces, runtime logs, and debug errors immediately upon encountering issues.
- **Verification**: Automatically verify changes using background servers, API calls, or browser/test tools without waiting for permission.

# Skills Policy
- **Scope**: Do not use or activate global or plugin skills (such as science, bio, or external devtools skills).
- **Project Skills Only**: Only use project-specific skills defined in `.agents/skills/` (`analyze-status`, `assess-risks`, `forecast-delivery`, `sprint-planning`, `propose-next-steps`, `generate-report`, `ai-settings-update`, `answer-question`, `compute-metrics`, `ingest-jira`, `seed-jira`, `scope-creep-detector`, `critical-path-analyzer`, `retrospective-insights`, `work-distribution-tracker`, `release-notes-generator`, `okr-alignment`, `compliance-checker`) or built-in system tools.


# Architectural Constraints & GCP Cloud Run Deployment
When modifying this codebase, agents MUST adhere to the following strict architectural constraints to ensure the application remains deployable to GCP Cloud Run without redesigns or infrastructure breaking changes:

1. **Frontend Architecture Constraint (No SPAs/React)**: NEVER attempt to rewrite or migrate the frontend to React, Vue, or any SPA framework that requires a separate build step or dev server (e.g., Vite/Webpack). The application MUST remain a monolithic FastAPI server that directly serves Vanilla HTML/JS/CSS from the rontend/ directory. This monolithic approach is explicitly required to simplify Cloud Run containerization and avoid cross-origin/proxy routing issues.
2. **Explicit HTTP Basic Auth in Frontend**: GCP Cloud Run deployments do not have a built-in proxy layer (like Vite's dev server) to transparently handle authentication state. Therefore, EVERY client-side etch request in the Vanilla JS application (rontend/js/api.js) MUST explicitly attach the HTTP Basic Auth header (Authorization: Basic ...) via toa('demo:Dem06435'). Failure to include this will result in 401 Unauthorized API errors in production, even if it works locally.
3. **FastAPI Static Mounting**: In src/jira_ai/api/main.py, the frontend static file mount (pp.mount("/", StaticFiles(directory=FRONTEND_DIR), name="static")) MUST always remain at the very bottom of the file. If it is moved above the API router inclusions, it will swallow all /api/... requests and break the backend.
