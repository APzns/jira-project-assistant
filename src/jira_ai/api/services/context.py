"""context.py — Loads all project-context markdown from project_data/.

The assessment agent reads these files as the 'intent' layer (goals, risks,
decisions, definitions) to compare against live Jira data. Files are read
fresh on every call so edits take effect without a server restart, and so a
future swap to a Cloud Storage bucket or Confluence sync only touches this
one function.
"""

from pathlib import Path

# project_data/ sits at the repo root: .../Jira_AI/project_data
# This file is at .../Jira_AI/src/jira_ai/api/services/context.py -> up 5 levels.
_PROJECT_DATA_DIR = Path(__file__).resolve().parents[4] / "project_data"

# Human-readable labels so the model knows what each block is for.
_LABELS = {
    "charter": "PROJECT CHARTER (goals, workstreams, milestones, planned delivery)",
    "risks": "RISK REGISTER (each risk has a trigger the agent can check)",
    "decisions": "DECISION LOG (intentional trade-offs — do NOT flag these as problems)",
    "definitions": "DEFINITIONS & RULES OF THUMB (how to judge project health)",
    "stakeholders": "STAKEHOLDERS (who cares about what)",
}


def load_project_context() -> str:
    """Read every .md file in project_data/ and return one labeled string."""
    if not _PROJECT_DATA_DIR.exists():
        return "(No project context files found.)"

    blocks = []
    for md_file in sorted(_PROJECT_DATA_DIR.glob("*.md")):
        if md_file.stem.lower() == "risks":
            continue          # injected separately as RISK LENSES
        stem = md_file.stem.lower()
        label = _LABELS.get(stem, stem.upper())
        text = md_file.read_text(encoding="utf-8").strip()
        blocks.append(f"===== {label} =====\n{text}")

    if not blocks:
        return "(No project context files found.)"
    return "\n\n".join(blocks)
