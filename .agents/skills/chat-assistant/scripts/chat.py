import argparse
import sys
import os
import json
from pathlib import Path

# Add the repository root to the Python path so we can import src.jira_ai
REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.jira_ai.ingestion.models import SessionLocal
from src.jira_ai.api.services.llm import chat_assistant
from src.jira_ai.api.services.llm import _load_ai_settings

def main():
    parser = argparse.ArgumentParser(description="Bridge script to query the Smart Project & Delivery Assistant")
    parser.add_argument("--message", type=str, required=True, help="The user's question or message")
    parser.add_argument("--project", type=str, default=None, help="Optional project key filter (e.g. MOB, CHK)")
    parser.add_argument("--context", type=str, default="assistant", help="Optional context tab")
    parser.add_argument("--json", action="store_true", help="Output raw JSON instead of formatted text")
    
    args = parser.parse_args()

    # Create a database session
    db = SessionLocal()

    try:
        # Load AI settings to see if there is an active stakeholder persona
        settings = _load_ai_settings()
        stakeholders = [settings.get("stakeholder")] if settings.get("stakeholder") else []
        
        # Call the backend chat_assistant logic directly
        result = chat_assistant(
            message=args.message,
            db=db,
            history=[],
            project_key=args.project,
            context=args.context,
            client_ip="cli-agent",
            stakeholder_ids=stakeholders
        )

        if args.json:
            print(json.dumps(result, indent=2))
        else:
            # Print the formatted reply
            reply = result.get("reply", "")
            print("\n" + reply + "\n")
            
            # If a report template was proposed, print that too
            proposed_template = result.get("proposed_template")
            if proposed_template:
                print(f"--- [Proposed Report Template: {proposed_template.get('name', 'Report')}] ---")
                print(f"Scope: {proposed_template.get('project_scope', 'ALL')}")
                print(f"Stakeholders: {', '.join(proposed_template.get('stakeholder_ids', []))}")
                print(f"Blocks: {len(proposed_template.get('blocks', []))} visual sections")
                print("-------------------------------------------------------------------------")

    except Exception as e:
        print(f"Error executing chat assistant: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    main()
