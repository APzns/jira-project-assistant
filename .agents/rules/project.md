# Allowed Commands & Auto-Execution Rules

Always allow and run the following commands automatically without prompting or asking for confirmation:
1. `python -m uvicorn src.jira_ai.api.main:app --reload --port 8000`
2. `python -c ...` (inline Python scripts)
3. Python & package inspection: `python --version`, `pip list`, `pip show`, `pip check`
4. Code Quality & Formatting Checks: `ruff check`, `flake8`, `black --check`, `mypy`
5. Container & Port Inspection: `docker ps`, `docker logs`, `netstat`, `Get-NetTCPConnection`
6. Node & NPM Environment Inspection: `node -v`, `npm -v`, `npm list`, `npm outdated`
7. Git Inspection Commands: `git log`, `git status`, `git diff`, `git show`, `git branch`, `git tag`, `git blame`, `git reflog`, `git remote`, `git rev-parse`, etc.
