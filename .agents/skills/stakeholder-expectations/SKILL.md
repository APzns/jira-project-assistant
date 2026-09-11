---
name: stakeholder-expectations
description: >-
  Use this skill to check stakeholder expectations and tailor report structures accordingly. It evaluates the current active stakeholder profile and proposes a report outline that matches their focus, tone, and key metrics.
---

# Stakeholder Expectations & Report Structure

Use this skill when proposing or generating a report structure. It ensures the report aligns with the expectations of the current active stakeholder profile.

## Steps to Align Report Structure

1. **Identify the Active Stakeholder:**
   - Check the `active_profile_id` in `.agents/settings/ai_settings.json` and find the corresponding profile details.
   - Note the `stakeholder` type (e.g., `executive`, `program_manager`, `engineer`, `scrum_master`, `challenger`).
   - Note the `summary_verbosity`, `risk_categories`, and any `custom_instructions`.

2. **Propose Report Structure Based on Stakeholder Persona:**

   - **For Executive (`executive`)**:
     - **Structure**: High-level summary, Milestone RAG status, Critical path risks, Budget/Capacity overview.
     - **Tone**: Concise, business-impact focused.
     - **Verbosity**: Keep it brief and focused on strategic decisions.

   - **For Program Manager (`program_manager`)**:
     - **Structure**: Cross-team dependency matrix, Sprint predictability, Blocker RAID log, Delivery forecasts.
     - **Tone**: Analytical, proactive.
     - **Verbosity**: Detailed analysis of blockers and mitigations.

   - **For Engineer (`engineer`)**:
     - **Structure**: Ticket-level status, Defect backlogs, Technical debt, Sprint burndown.
     - **Tone**: Technical, factual.
     - **Verbosity**: Highly detailed on specific issues and technical blockers.

   - **For Scrum Master (`scrum_master`)**:
     - **Structure**: Sprint health, Velocity trends, WIP limits, Daily blockers.
     - **Tone**: Process-oriented.

3. **Incorporate Active Filters:**
   - Filter the proposed structure to only include sections for the specified `focus_teams` and `focus_epics`.
   - Ensure risk sections align with the `risk_categories` and `min_risk_severity` from the settings.

4. **Present the Proposed Structure:**
   - Outline the proposed structure to the user for feedback before generating the full report.
