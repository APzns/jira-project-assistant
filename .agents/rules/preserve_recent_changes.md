---
name: "Preserve UI and Layout Changes"
description: "General constraints to preserve recent user modifications and avoid reverting UI elements."
---

# Preserve UI and Layout Changes

When modifying frontend files (especially `frontend/index.html`):
1. **Never Assume the Baseline:** Do not blindly copy-paste or restore entire blocks of HTML/CSS from older knowledge or previous file states, as this often overwrites recent, undocumented user adjustments (like changing the hero title, removing badges, adding new buttons, or modifying text content).
2. **Targeted Edits Only:** Only edit the precise lines necessary for the task. If you're asked to add or change a specific feature, do not inadvertently reset surrounding elements to their original state.
3. **Preserve Known User Modifications:** 
   - Ensure the hero title (`<h1 class="main-hero-title">`) remains "Portfolio Command Center" (not "Welcome back...").
   - Ensure the "Portfolio Command Center" badge is not restored.
   - Keep the "Portfolio Overview" link intact above the KPI grid.
4. **General Principle:** Always respect the current state of the DOM. If a label was removed or text was updated, assume it was intentional and preserve it throughout your changes.
