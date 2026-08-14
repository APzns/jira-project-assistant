
"""docs.py — serves project_data markdown files for the Documentation tab."""

from pathlib import Path
from fastapi import APIRouter

router = APIRouter(prefix="/docs-data", tags=["docs"])

_DIR = Path(__file__).resolve().parents[4] / "project_data"

# Order the files sensibly for reading.
_ORDER = ["charter", "risks", "decisions", "definitions", "stakeholders"]


@router.get("")
def get_docs():
    files = []
    if _DIR.exists():
        md = {p.stem: p for p in _DIR.glob("*.md")}
        for stem in _ORDER + [s for s in md if s not in _ORDER]:
            if stem in md:
                files.append({"name": stem, "content": md[stem].read_text(encoding="utf-8")})
    return {"files": files}
