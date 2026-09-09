"""eval_assistant.py — LLM Evaluation Runner for the Jira AI Assistant.

This script runs a golden dataset of questions against the LIVE Gemini model
to ensure prompt modifications do not cause deterioration in:
1. Tool Selection Accuracy
2. SQL Generation Quality
3. Skill Intent Matching
4. Hallucination Rates

Usage:
    python -m tests.eval_assistant
"""

import json
import os
import sys
from pathlib import Path
from typing import Generator
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, os.path.abspath("."))

from src.jira_ai.api.services.llm import answer_question_stream
from src.jira_ai.ingestion.models import Base

# Setup temporary DB for deterministic testing
engine = create_engine("sqlite:///:memory:")
Base.metadata.create_all(engine)
SessionLocal = sessionmaker(bind=engine)

EVAL_DATASET_PATH = Path(__file__).parent / "eval_dataset.json"

_SKILL_INTENT_MAP = {
    "answer-question": [
        "what projects", "my projects", "projects am i", "projects are",
        "who is the lead", "who leads", "who owns", "what is the status",
        "how many issues", "how many epics", "what is the target",
        "what milestones", "what sprints", "show me", "list all", "list the",
        "tell me about", "give me a summary", "overview of", "summarize",
        "which team", "which squad", "what teams", "what squads",
    ],
    "compute-metrics": [
        "how many bugs", "how many defects", "defect count", "bug count",
        "velocity", "throughput", "story points", "average", "total sp",
        "completed sp", "committed sp", "completion rate", "done rate",
        "sprint count", "issue count", "ticket count",
    ],
    "assess-risks": [
        "risk", "risks", "blocker", "blockers", "blocked", "dependency", "dependencies",
        "overcommitment", "overcommitted", "capacity drag",
    ],
    "forecast-delivery": [
        "forecast", "monte carlo", "projection", "when will we finish", "p50", "p85", "p95",
        "delivery date", "simulation", "what if", "critical path", "lead time",
    ],
    "sprint-planning": [
        "sprint planning", "backlog hygiene", "missing estimates", "unestimated", "unassigned",
        "capacity balance", "workload", "sprint readiness", "definition of ready",
    ],
    "analyze-status": [
        "delay", "delays", "slipping", "overdue", "at risk", "analyze status",
        "status analysis", "find delays", "what's behind", "monitoring",
        "health", "pacing", "milestone progress", "predictability", "defect ratio", "bug ratio",
    ],
    "propose-next-steps": [
        "next steps", "what should we do", "actions", "recommendations",
        "prioritize", "action plan", "what to do", "propose", "advice",
        "advise", "recommend", "mitigate", "mitigation", "trade-off", "tradeoff",
    ],
    "scope-creep-detector": [
        "scope creep", "scope change", "mid-sprint", "injected", "unplanned",
        "story point revision", "scope growth", "scope expansion",
    ],
}

def run_evals():
    if not os.environ.get("GEMINI_API_KEY"):
        print("ERROR: GEMINI_API_KEY required to run live evaluations.")
        return

    with open(EVAL_DATASET_PATH, "r", encoding="utf-8") as f:
        dataset = json.load(f)

    db = SessionLocal()
    passed = 0
    total = len(dataset)

    print(f"--- Starting LLM Evaluation ({total} cases) ---")

    for case in dataset:
        print(f"\nEvaluating: {case['id']} - '{case['question']}'")
        
        # 1. Test Intent Matching Locally First
        detected_skill = None
        q_lower = case["question"].lower()
        import re
        best_skill = None
        max_score = 0
        for sn, keywords in _SKILL_INTENT_MAP.items():
            score = 0
            for kw in keywords:
                pattern = r'\b' + re.escape(kw) + r'\b'
                if re.search(pattern, q_lower):
                    score += len(kw.split())
            if score > max_score:
                max_score = score
                best_skill = sn
                
        if best_skill:
            detected_skill = best_skill
                
        if case["expected_skill"]:
            if detected_skill == case["expected_skill"]:
                print(f"  [PASS] Intent Match: {detected_skill}")
            else:
                print(f"  [FAIL] Intent Match: Expected {case['expected_skill']}, got {detected_skill}")
        
        # 2. Run the Live Model Stream
        stream: Generator = answer_question_stream(
            question=case["question"],
            db=db,
            history=[],
            project_key="ALL"
        )
        
        tool_calls = []
        sql_queries = []
        final_answer = ""
        error = None
        
        try:
            for chunk_str in stream:
                if chunk_str.startswith("data: "):
                    payload = json.loads(chunk_str[6:].strip())
                    if "status" in payload:
                        # Log tool calls based on status messages or capture actual tool executions
                        if "Querying database" in payload["status"]:
                            tool_calls.append("query_database")
                        elif "metrics" in payload["status"].lower():
                            tool_calls.append("get_program_metrics")
                        elif "charter" in payload["status"].lower():
                            tool_calls.append("get_project_charter")
                    
                    if "chunk" in payload:
                        final_answer += payload["chunk"]
                    
                    if payload.get("done"):
                        if payload.get("error"):
                            error = payload["error"]
                        break
        except Exception as e:
            error = str(e)

        # 3. Evaluate Tool Calling
        if error:
            print(f"  [FAIL] Execution Error: {error}")
            continue
            
        if case["expected_tool"] in tool_calls:
            print(f"  [PASS] Tool Selection: {case['expected_tool']}")
        else:
            print(f"  [FAIL] Tool Selection: Expected {case['expected_tool']}, used {tool_calls}")
            continue

        # 4. Evaluate Output Formatting
        if "sql" in final_answer.lower() or "select *" in final_answer.lower():
             print(f"  [FAIL] Hallucination/Format: Model exposed SQL to the user.")
             continue
             
        print(f"  [PASS] Quality Check")
        passed += 1

    print(f"\n--- Evaluation Summary ---")
    print(f"Passed: {passed}/{total} ({(passed/total)*100:.1f}%)")
    db.close()

if __name__ == "__main__":
    run_evals()
