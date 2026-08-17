/**
 * projects.js — Project details, project stakeholder assignments, RACI matrix customization,
 * and searchable role assigner with instant "+ Create New Role" link.
 */

import { $, escapeHtml } from "../utils.js";
import { API_BASE } from "../state.js";
import { fetchWithTimeout } from "../api.js";

let _currentProjectKey = null;
let _projectAssignments = [];
let _allStakeholders = [];
let _selectedStakeholderToAssignId = null;

const RACI_MAP = {
  "R": { label: "Responsible (R)", desc: "Drives and executes the deliverable", color: "#4c8dff", bg: "rgba(76, 141, 255, 0.15)", border: "rgba(76, 141, 255, 0.35)" },
  "A": { label: "Accountable (A)", desc: "Decision maker & project owner", color: "#9b6bff", bg: "rgba(155, 107, 255, 0.15)", border: "rgba(155, 107, 255, 0.35)" },
  "C": { label: "Consulted (C)", desc: "Subject matter expert / 2-way input", color: "#f5a623", bg: "rgba(245, 166, 35, 0.15)", border: "rgba(245, 166, 35, 0.35)" },
  "I": { label: "Informed (I)", desc: "Kept updated on progress", color: "#2fbf71", bg: "rgba(47, 191, 113, 0.15)", border: "rgba(47, 191, 113, 0.35)" }
};

const REPORTING_MAP = {
  "executive": { label: "Executive Summary", desc: "High-level milestones, budget & ROI, executive blockers" },
  "standard": { label: "Standard Dashboard", desc: "Sprint predictability, team velocity, active dependencies" },
  "technical": { label: "Technical Deep Dive", desc: "Granular defects, tech debt ratios, PR & commit activity" }
};

/**
 * Load and render project stakeholders & RACI matrix for a given project key
 */
export async function loadProjectStakeholders(projectKey) {
  _currentProjectKey = projectKey.toUpperCase().trim();
  const viewContainer = $("pd-stakeholders-view-container");
  const editContainer = $("pd-stakeholders-edit-container");
  const btnEdit = $("btn-edit-proj-stakeholders");

  if (editContainer) editContainer.style.display = "none";
  if (btnEdit) btnEdit.style.display = "inline-flex";
  if (viewContainer) {
    viewContainer.style.display = "grid";
    viewContainer.innerHTML = `<div class="pd-loading muted">Loading project stakeholders...</div>`;
  }

  try {
    const [projRes, shRes] = await Promise.all([
      fetchWithTimeout(`${API_BASE}/projects/${_currentProjectKey}/stakeholders`, { credentials: "include" }),
      fetchWithTimeout(`${API_BASE}/stakeholders`, { credentials: "include" })
    ]);

    if (shRes.ok) {
      const shData = await shRes.json();
      _allStakeholders = (shData.stakeholders || []).sort((a, b) => 
        (a.role || a.role_type || "").localeCompare(b.role || b.role_type || "")
      );
    }

    if (projRes.ok) {
      const projData = await projRes.json();
      _projectAssignments = projData.assignments || [];
    } else {
      _projectAssignments = [];
    }

    renderProjectStakeholdersView();
  } catch (err) {
    console.error("Error loading project stakeholders:", err);
    if (viewContainer) {
      viewContainer.innerHTML = `<div class="error-text">Failed to load project stakeholders.</div>`;
    }
  }
}

/**
 * Sort assignments array alphabetically by role name
 */
function sortAssignmentsByRoleName(assignments) {
  return [...assignments].sort((a, b) => {
    const shA = _allStakeholders.find(s => s.id === a.stakeholder_id);
    const shB = _allStakeholders.find(s => s.id === b.stakeholder_id);
    const nameA = shA ? (shA.role || shA.role_type || "") : "";
    const nameB = shB ? (shB.role || shB.role_type || "") : "";
    return nameA.localeCompare(nameB);
  });
}

/**
 * Render read-only RACI Matrix cards for the project
 */
function renderProjectStakeholdersView() {
  const container = $("pd-stakeholders-view-container");
  const btnEdit = $("btn-edit-proj-stakeholders");
  if (btnEdit) btnEdit.style.display = "inline-flex";
  if (!container) return;

  if (_projectAssignments.length === 0) {
    container.innerHTML = `
      <div class="pd-sh-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
        <p style="margin: 8px 0 4px 0; color: var(--text); font-weight: 600;">No stakeholders assigned to ${_currentProjectKey} yet.</p>
        <p class="muted" style="margin: 0; font-size: 13px;">Click "Edit Stakeholders & RACI" to assign roles and configure project specifics.</p>
      </div>
    `;
    return;
  }

  // Sort assignments alphabetically by role name
  const sortedAssignments = sortAssignmentsByRoleName(_projectAssignments);

  container.innerHTML = sortedAssignments.map(assignment => {
    const sh = _allStakeholders.find(s => s.id === assignment.stakeholder_id);
    const roleName = sh ? (sh.role || sh.role_type || "Stakeholder") : "Unknown Stakeholder";
    const people = sh ? (sh.people || []) : [];
    const raciKey = (assignment.raci || "C").toUpperCase();
    const raci = RACI_MAP[raciKey] || RACI_MAP["C"];
    const repKey = assignment.reporting_level || "standard";
    const rep = REPORTING_MAP[repKey] || REPORTING_MAP["standard"];

    const peopleHtml = people.length > 0
      ? `<div class="pd-sh-members">Members: ${people.map(p => escapeHtml(p.name)).join(", ")}</div>`
      : `<div class="pd-sh-members muted">No individual members listed</div>`;

    const notesHtml = assignment.project_notes && assignment.project_notes.trim()
      ? `<div class="pd-sh-notes"><strong>Project Directives:</strong> ${escapeHtml(assignment.project_notes)}</div>`
      : "";

    return `
      <div class="pd-sh-card">
        <div class="pd-sh-card-header">
          <div class="pd-sh-title-wrap">
            <div>
              <div class="pd-sh-role">${escapeHtml(roleName)}</div>
              ${peopleHtml}
            </div>
          </div>
          <div class="pd-sh-badges">
            <span class="raci-badge" style="color: ${raci.color}; background: ${raci.bg}; border: 1px solid ${raci.border};" title="${escapeHtml(raci.desc)}">
              ${raciKey} — ${escapeHtml(raci.label.split(" ")[0])}
            </span>
          </div>
        </div>

        <div class="pd-sh-meta-row">
          <div class="pd-sh-rep-tag" title="${escapeHtml(rep.desc)}">
            ${escapeHtml(rep.label)}
          </div>
        </div>

        ${notesHtml}
      </div>
    `;
  }).join("");
}

/**
 * Render searchable dropdown items for role assignment sorted alphabetically
 */
function renderSearchableRoleDropdown(filterQuery = "") {
  const dropdown = $("pd-sh-search-dropdown");
  if (!dropdown) return;

  const q = filterQuery.toLowerCase().trim();
  const filtered = _allStakeholders.filter(s => {
    if (!q) return true;
    const role = (s.role || "").toLowerCase();
    const desc = (s.description || "").toLowerCase();
    const owner = (s.owner || "").toLowerCase();
    const people = (s.people || []).map(p => `${p.name} ${p.email}`).join(" ").toLowerCase();
    return role.includes(q) || desc.includes(q) || owner.includes(q) || people.includes(q);
  }).sort((a, b) => (a.role || a.role_type || "").localeCompare(b.role || b.role_type || ""));

  let itemsHtml = "";

  if (filtered.length === 0) {
    itemsHtml = `
      <div class="pd-sh-menu-empty">
        <span>No matching roles found for "${escapeHtml(filterQuery)}"</span>
      </div>
    `;
  } else {
    itemsHtml = filtered.map(s => {
      const alreadyAssigned = _projectAssignments.some(a => a.stakeholder_id === s.id);
      const roleName = escapeHtml(s.role || s.role_type || "Stakeholder");
      const people = s.people || [];
      const peopleText = people.length > 0 
        ? people.map(p => escapeHtml(p.name)).join(", ")
        : "No members assigned";
      const ownerTag = s.is_builtin ? "Standard" : (s.owner ? `Owner: ${escapeHtml(s.owner)}` : "Custom");

      return `
        <div class="pd-sh-menu-item ${alreadyAssigned ? 'disabled' : ''}" data-id="${escapeHtml(s.id)}" data-name="${roleName}">
          <div class="pd-sh-menu-info">
            <div class="pd-sh-menu-title-row">
              <strong class="pd-sh-menu-title">${roleName}</strong>
              <span class="pd-sh-menu-badge">${ownerTag}</span>
            </div>
            <div class="pd-sh-menu-sub">${peopleText}</div>
          </div>
          <div class="pd-sh-menu-action">
            ${alreadyAssigned 
              ? `<span class="pd-sh-menu-assigned-lbl">Already Assigned</span>`
              : `<button type="button" class="btn-select-sh-item">Select</button>`}
          </div>
        </div>
      `;
    }).join("");
  }

  dropdown.innerHTML = `
    <div class="pd-sh-menu-list">
      ${itemsHtml}
    </div>
    <div class="pd-sh-menu-footer">
      <span>Need a role not listed?</span>
      <a href="#stakeholders/new" class="inline-link">+ Create New Stakeholder Role →</a>
    </div>
  `;

  // Bind item clicks — clicking unassigned item adds it immediately
  dropdown.querySelectorAll(".pd-sh-menu-item:not(.disabled)").forEach(item => {
    item.addEventListener("click", () => {
      const sid = item.dataset.id;
      if (sid && !_projectAssignments.some(a => a.stakeholder_id === sid)) {
        _projectAssignments.push({
          stakeholder_id: sid,
          raci: "C",
          reporting_level: "standard",
          project_notes: ""
        });
        dropdown.style.display = "none";
        openProjectStakeholdersEditor();
      }
    });
  });
}

/**
 * Open the Project Stakeholders editor (Hides the header Edit button while editing)
 */
function openProjectStakeholdersEditor() {
  const viewContainer = $("pd-stakeholders-view-container");
  const editContainer = $("pd-stakeholders-edit-container");
  const btnEdit = $("btn-edit-proj-stakeholders");
  const projKeySpan = $("pd-edit-proj-key");
  const searchInput = $("pd-input-search-sh");
  const dropdown = $("pd-sh-search-dropdown");

  if (btnEdit) btnEdit.style.display = "none"; // Hide top edit button while already editing
  if (projKeySpan) projKeySpan.textContent = _currentProjectKey;
  if (searchInput) searchInput.value = "";
  if (dropdown) dropdown.style.display = "none";
  _selectedStakeholderToAssignId = null;

  renderProjectStakeholdersEditList();

  if (viewContainer) viewContainer.style.display = "none";
  if (editContainer) editContainer.style.display = "flex";
}

/**
 * Render the editable list of project stakeholders sorted by role name
 */
function renderProjectStakeholdersEditList() {
  const listEl = $("pd-assigned-sh-edit-list");
  if (!listEl) return;

  if (_projectAssignments.length === 0) {
    listEl.innerHTML = `<div class="pd-edit-empty">No stakeholders assigned yet. Use the search input above to add roles to this project.</div>`;
    return;
  }

  // Ensure assignments are sorted by role name
  _projectAssignments = sortAssignmentsByRoleName(_projectAssignments);

  listEl.innerHTML = _projectAssignments.map((assignment, idx) => {
    const sh = _allStakeholders.find(s => s.id === assignment.stakeholder_id);
    const roleName = sh ? (sh.role || sh.role_type || "Stakeholder") : "Stakeholder";
    const raciVal = (assignment.raci || "C").toUpperCase();
    const repVal = assignment.reporting_level || "standard";
    const notesVal = assignment.project_notes || "";

    return `
      <div class="pd-edit-sh-card" data-index="${idx}">
        <div class="pd-edit-sh-top">
          <div class="pd-edit-sh-title">
            <strong>${escapeHtml(roleName)}</strong>
          </div>
          <button type="button" class="btn-remove-proj-sh" data-index="${idx}" title="Unassign from project">
            ✕ Remove
          </button>
        </div>

        <div class="pd-edit-sh-controls">
          <!-- RACI Selector -->
          <div class="form-group" style="flex: 1;">
            <label class="settings-label">RACI Role</label>
            <select class="settings-select pd-edit-raci-select" data-index="${idx}">
              <option value="R" ${raciVal === 'R' ? 'selected' : ''}>R — Responsible (Drives work)</option>
              <option value="A" ${raciVal === 'A' ? 'selected' : ''}>A — Accountable (Decision maker)</option>
              <option value="C" ${raciVal === 'C' ? 'selected' : ''}>C — Consulted (SME input)</option>
              <option value="I" ${raciVal === 'I' ? 'selected' : ''}>I — Informed (Status updates)</option>
            </select>
          </div>

          <!-- Reporting Level -->
          <div class="form-group" style="flex: 1;">
            <label class="settings-label">Reporting Detail Level</label>
            <select class="settings-select pd-edit-rep-select" data-index="${idx}">
              <option value="executive" ${repVal === 'executive' ? 'selected' : ''}>Executive Summary (Milestones, ROI)</option>
              <option value="standard" ${repVal === 'standard' ? 'selected' : ''}>Standard Dashboard (Weekly digests)</option>
              <option value="technical" ${repVal === 'technical' ? 'selected' : ''}>Technical Deep Dive (Granular debt, PRs)</option>
            </select>
          </div>
        </div>

        <!-- Project Specific Notes -->
        <div class="form-group" style="margin-top: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label class="settings-label">Project-Specific Directives & Focus</label>
            <span class="char-counter">${notesVal.length} / 500 characters</span>
          </div>
          <textarea class="settings-textarea pd-edit-notes-input" data-index="${idx}" rows="2" maxlength="500" placeholder="e.g. For ${_currentProjectKey}, focus on checkout conversion SLAs, payment failover, and PCI compliance...">${escapeHtml(notesVal)}</textarea>
        </div>
      </div>
    `;
  }).join("");

  // Bind unassign buttons
  listEl.querySelectorAll(".btn-remove-proj-sh").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      _projectAssignments.splice(idx, 1);
      openProjectStakeholdersEditor();
    });
  });

  // Bind live updates to assignments state
  listEl.querySelectorAll(".pd-edit-raci-select").forEach(sel => {
    sel.addEventListener("change", () => {
      const idx = parseInt(sel.dataset.index, 10);
      if (_projectAssignments[idx]) _projectAssignments[idx].raci = sel.value;
    });
  });

  listEl.querySelectorAll(".pd-edit-rep-select").forEach(sel => {
    sel.addEventListener("change", () => {
      const idx = parseInt(sel.dataset.index, 10);
      if (_projectAssignments[idx]) _projectAssignments[idx].reporting_level = sel.value;
    });
  });

  listEl.querySelectorAll(".pd-edit-notes-input").forEach(txt => {
    txt.addEventListener("input", () => {
      const idx = parseInt(txt.dataset.index, 10);
      if (_projectAssignments[idx]) _projectAssignments[idx].project_notes = txt.value.slice(0, 500);
      const counter = txt.closest(".form-group").querySelector(".char-counter");
      if (counter) counter.textContent = `${txt.value.length} / 500 characters`;
    });
  });
}

/**
 * Add a new stakeholder assignment to the project
 */
function handleAddStakeholderToProject() {
  const searchInput = $("pd-input-search-sh");
  let stakeholderId = _selectedStakeholderToAssignId;

  if (!stakeholderId && searchInput && searchInput.value.trim()) {
    const q = searchInput.value.trim().toLowerCase();
    const match = _allStakeholders.find(s => (s.role || s.role_type || "").toLowerCase() === q);
    if (match) stakeholderId = match.id;
  }

  if (!stakeholderId) {
    // If not selected yet, open dropdown
    const dropdown = $("pd-sh-search-dropdown");
    if (dropdown) {
      renderSearchableRoleDropdown(searchInput ? searchInput.value : "");
      dropdown.style.display = "block";
    }
    if (searchInput) searchInput.focus();
    return;
  }

  if (_projectAssignments.some(a => a.stakeholder_id === stakeholderId)) {
    alert("This stakeholder role is already assigned to this project.");
    return;
  }

  _projectAssignments.push({
    stakeholder_id: stakeholderId,
    raci: "C",
    reporting_level: "standard",
    project_notes: ""
  });

  openProjectStakeholdersEditor();
}

/**
 * Save project stakeholder assignments via API
 */
async function handleSaveProjectStakeholders() {
  const saveBtn = $("btn-save-proj-sh");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }

  try {
    const payload = {
      project_key: _currentProjectKey,
      assignments: _projectAssignments
    };

    const res = await fetchWithTimeout(`${API_BASE}/projects/${_currentProjectKey}/stakeholders`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to save project stakeholders");
    }

    const editContainer = $("pd-stakeholders-edit-container");
    const viewContainer = $("pd-stakeholders-view-container");
    const btnEdit = $("btn-edit-proj-stakeholders");
    if (editContainer) editContainer.style.display = "none";
    if (viewContainer) viewContainer.style.display = "grid";
    if (btnEdit) btnEdit.style.display = "inline-flex";

    renderProjectStakeholdersView();
  } catch (err) {
    console.error("Error saving project stakeholders:", err);
    alert(err.message || "Failed to save project stakeholders");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Project Stakeholders";
    }
  }
}

/**
 * Initialize project stakeholder events
 */
export function initProjectStakeholdersEvents() {
  const btnEdit = $("btn-edit-proj-stakeholders");
  if (btnEdit) {
    btnEdit.addEventListener("click", openProjectStakeholdersEditor);
  }

  const btnCancel = $("btn-cancel-proj-sh");
  if (btnCancel) {
    btnCancel.addEventListener("click", () => {
      const editContainer = $("pd-stakeholders-edit-container");
      const viewContainer = $("pd-stakeholders-view-container");
      const btnEditTop = $("btn-edit-proj-stakeholders");
      if (editContainer) editContainer.style.display = "none";
      if (viewContainer) viewContainer.style.display = "grid";
      if (btnEditTop) btnEditTop.style.display = "inline-flex";
      renderProjectStakeholdersView();
    });
  }

  const btnSave = $("btn-save-proj-sh");
  if (btnSave) {
    btnSave.addEventListener("click", handleSaveProjectStakeholders);
  }

  const btnAddSh = $("btn-pd-add-sh-item");
  if (btnAddSh) {
    btnAddSh.addEventListener("click", handleAddStakeholderToProject);
  }

  // Search input events
  const searchInput = $("pd-input-search-sh");
  const dropdown = $("pd-sh-search-dropdown");

  if (searchInput && dropdown) {
    searchInput.addEventListener("focus", () => {
      renderSearchableRoleDropdown(searchInput.value);
      dropdown.style.display = "block";
    });

    searchInput.addEventListener("input", () => {
      _selectedStakeholderToAssignId = null;
      renderSearchableRoleDropdown(searchInput.value);
      dropdown.style.display = "block";
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddStakeholderToProject();
      }
    });

    // Close dropdown on outside click
    document.addEventListener("click", (e) => {
      if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
        dropdown.style.display = "none";
      }
    });
  }
}
