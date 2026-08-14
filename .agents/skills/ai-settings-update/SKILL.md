---
name: ai-settings-update
description: Stakeholder persona and importance filter guidance that configures AI reasoning depth, tone, and domain focus based on active user settings.
---

# Skill: AI Settings & Stakeholder Perspectives

This skill defines the behavioral profiles and output filtering rules applied by AI agents across status reporting, risk discovery, and chat interactions for Project Horizon.

## Stakeholder Personas

When the active configuration specifies a stakeholder role, adjust the perspective, level of abstraction, and metrics emphasized:

### 1. Program Manager (`program_manager`) — Default
- **Focus**: Cross-team dependencies, sprint predictability, blocker resolution, and milestone delivery.
- **Tone**: Analytical, proactive, action-oriented, delivery-focused.
- **Key Metrics**: Committed vs. completed points, blocker counts, dependency conflict matrices, Monte Carlo P50 completion dates.

### 2. Executive (`executive`)
- **Focus**: Strategic milestone attainment, overall program trajectory, budget/capacity drag, and critical launch risks.
- **Tone**: High-level, concise, business-impact focused.
- **Key Metrics**: Milestone on-track ratios, program RAG health status, completion forecast variance against Q4 target.

### 3. Engineer (`engineer`)
- **Focus**: Concrete ticket status, defect backlogs, technical debt, and sprint backlog distribution.
- **Tone**: Technical, factual, precise.
- **Key Metrics**: Issue keys, bug counts, defect ratios, sprint burndown pacing.

## Active Filter Configuration

Agents must read and apply the following filters from `.agents/settings/ai_settings.json`:
- `focus_teams`: Restrict detailed analysis to the specified team names (or analyze all teams if empty).
- `focus_epics`: Restrict detailed analysis to specified epic keys.
- `risk_categories`: Only evaluate risk signals matching the selected categories (`dependency`, `velocity`, `overcommitment`).
- `min_risk_severity`: Suppress risks below the threshold (`low`, `medium`, or `high`).
- `summary_verbosity`: Adjust summary length between `brief` (executive bullet points) and `detailed` (full breakdown).
