/**
 * stakeholders.js — Stakeholders Management with Section-by-Section Editing
 * matching the Report Details design pattern.
 */

import { $, escapeHtml } from "../utils.js";
import { API_BASE } from "../state.js";
import { fetchWithTimeout } from "../api.js";

let _stakeholdersData = [];
let _currentUser = "demo";
let _activeFilter = "all";
let _searchQuery = "";
let _currentEditingId = null;

// Section edit lists
let _sec2PeopleList = [];
let _sec3ProjectsList = [];
let _sec4PriosList = [];

// Form lists for New Stakeholder creation
let _formPeopleList = [];
let _formProjectsList = [];
let _formPriosList = [];

let PROJECT_MAP = {
  "CHK": { name: "Checkout & Commerce Flow", color: "#4c8dff" },
  "CORE": { name: "Platform Core & Analytics", color: "#2fbf71" },
  "MOB": { name: "Mobile Parity & Security", color: "#9b6bff" },
  "HRZ": { name: "Project Horizon", color: "#f5a623" }
};

const ROLE_ICONS = {
  "project_manager": "🎯",
  "executive": "👑",
  "engineering_lead": "⚙️",
  "qa_lead": "🧪",
  "product_owner": "💡",
  "security_lead": "🔒",
  "devops_lead": "🚀",
  "custom": "👤"
};

const ROLE_LABELS = {
  "project_manager": "Project Manager (Delivery schedules, sprint health, cross-team blockers)",
  "executive": "Executive Sponsor (High-level milestones, strategic ROI, executive risks)",
  "engineering_lead": "Engineering Lead (Tech debt ratios, architecture, engineering capacity)",
  "qa_lead": "QA & Release Lead (Test coverage, defect escape trends, release criteria)",
  "product_owner": "Product Owner (Feature scope, user journey conversion, backlog priorities)",
  "security_lead": "Security Lead (SOC2 compliance, audit trails, vuln remediation)",
  "devops_lead": "DevOps Lead (CI/CD pipeline throughput, infra reliability, deployment velocity)",
  "custom": "Custom Persona (Pure custom directives, no predefined AI bias)"
};

/**
 * Fetch stakeholders and project definitions from API and render the page.
 */
export async function renderStakeholdersPage() {
  try {
    const [res, projRes] = await Promise.all([
      fetchWithTimeout(`${API_BASE}/stakeholders`, { credentials: "include" }),
      fetchWithTimeout(`${API_BASE}/projects?include_archived=true`, { credentials: "include" })
    ]);

    if (projRes && projRes.ok) {
      const projJson = await projRes.json();
      const colors = ["#4c8dff", "#2fbf71", "#9b6bff", "#f5a623", "#ff6b8b", "#00d2d3", "#a29bfe", "#fdcb6e"];
      (projJson.projects || []).forEach((p, idx) => {
        PROJECT_MAP[p.key] = {
          name: p.name || p.key,
          color: colors[idx % colors.length]
        };
      });
    }

    if (res.ok) {
      const json = await res.json();
      _stakeholdersData = (json.stakeholders || []).sort((a, b) => 
        (a.role || a.role_type || "").localeCompare(b.role || b.role_type || "")
      );
      if (json.current_user) {
        _currentUser = json.current_user;
      }
    } else {
      console.warn("Could not load stakeholders from API, status:", res.status);
    }
  } catch (err) {
    console.error("Error fetching stakeholders:", err);
  }

  updateStakeholdersStats();
  applyStakeholderFilters();
}

/**
 * Update quick stats strip at the top of the stakeholders page.
 */
function updateStakeholdersStats() {
  const totalEl = $("sh-stat-total");
  const builtinEl = $("sh-stat-builtin");
  const customEl = $("sh-stat-custom");
  const projectsEl = $("sh-stat-projects");

  if (!totalEl) return;

  const total = _stakeholdersData.length;
  const builtin = _stakeholdersData.filter(s => s.is_builtin || s.owner === "system").length;
  const custom = total - builtin;

  const projectSet = new Set();
  _stakeholdersData.forEach(s => {
    (s.projects || []).forEach(p => projectSet.add(p));
  });

  totalEl.textContent = total;
  if (builtinEl) builtinEl.textContent = builtin;
  if (customEl) customEl.textContent = custom;
  if (projectsEl) projectsEl.textContent = projectSet.size || "4";
}

/**
 * Switch subview to List View
 */
export function showStakeholdersList() {
  const listView = $("stakeholders-list-view");
  const detailView = $("stakeholder-detail-view");
  const formView = $("stakeholder-form-view");

  if (detailView) detailView.style.display = "none";
  if (formView) formView.style.display = "none";
  if (listView) listView.style.display = "block";
  window.scrollTo(0, 0);
}

/**
 * Switch subview to Section-Based Detail View
 */
export function showStakeholderDetail(stakeholderId) {
  const listView = $("stakeholders-list-view");
  const detailView = $("stakeholder-detail-view");
  const formView = $("stakeholder-form-view");

  if (!detailView) return;

  const s = _stakeholdersData.find(item => item.id === stakeholderId);
  if (!s) {
    // If data not loaded yet, fetch and retry
    renderStakeholdersPage().then(() => {
      const retryS = _stakeholdersData.find(item => item.id === stakeholderId);
      if (retryS) showStakeholderDetail(stakeholderId);
      else showStakeholdersList();
    });
    return;
  }

  _currentEditingId = s.id;

  // Reset all sections to view mode
  [1, 2, 3, 4, 5].forEach(secNum => _toggleShSectionEdit(secNum, false));

  // Populate view presentation and edit forms for all sections
  _renderAllShSectionViews(s);
  _populateShSectionEditForms(s);

  // Wire delete button in header
  const btnDelete = $("btn-detail-delete-sh");
  if (btnDelete) {
    btnDelete.onclick = () => {
      confirmDeleteStakeholder(s.id, s.role || s.role_type || "Stakeholder");
    };
  }

  if (listView) listView.style.display = "none";
  if (formView) formView.style.display = "none";
  detailView.style.display = "block";
  window.scrollTo(0, 0);
}

/**
 * Toggle individual section between View and Edit modes
 */
function _toggleShSectionEdit(secNumber, isEditing) {
  const viewEl = $(`sh-sec-${secNumber}-view`);
  const editEl = $(`sh-sec-${secNumber}-edit`);
  const editBtn = $(`btn-edit-sh-sec-${secNumber}`);

  if (viewEl) viewEl.style.display = isEditing ? "none" : "block";
  if (editEl) editEl.style.display = isEditing ? "block" : "none";
  if (editBtn) editBtn.style.display = isEditing ? "none" : "inline-flex";

  if (isEditing) {
    if (secNumber === 2) _renderSec2PeopleEditChips();
    if (secNumber === 3) _renderSec3ProjectsEditChips();
    if (secNumber === 4) _renderSec4PriosEditChips();
  }
}

/**
 * Render all section view presentations from stakeholder object
 */
function _renderAllShSectionViews(s) {
  const roleName = s.role || s.role_type || "Stakeholder";
  const people = s.people || [];
  const owner = s.owner || (s.is_builtin ? "system" : "demo");
  const isOwner = (owner === _currentUser);

  // Page Header Title & Subtitle
  const titleEl = $("sh-detail-title");
  if (titleEl) {
    titleEl.textContent = `Stakeholder Details: ${roleName}`;
  }

  // Section 1: Persona & Role Overview
  const sec1Role = $("sh-sec-1-val-role");
  const sec1Category = $("sh-sec-1-val-category");
  const sec1Type = $("sh-sec-1-val-type");
  const sec1Owner = $("sh-sec-1-val-owner");

  const rIcon = ROLE_ICONS[s.role_type] || "👤";
  const rLabel = (s.role_type || "custom").replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());

  if (sec1Role) sec1Role.textContent = roleName;
  if (sec1Category) sec1Category.textContent = `${rIcon} ${rLabel}`;
  if (sec1Type) {
    sec1Type.innerHTML = s.is_builtin 
      ? `<span class="sh-type-tag sh-type-builtin">Standard Persona</span>`
      : `<span class="sh-type-tag sh-type-custom">Custom Persona</span>`;
  }
  if (sec1Owner) {
    if (isOwner) {
      sec1Owner.innerHTML = `<span class="sh-owner-tag sh-owner-mine">Owned by you (${escapeHtml(_currentUser)})</span>`;
    } else if (owner === "system" || s.is_builtin) {
      sec1Owner.innerHTML = `<span class="sh-owner-tag sh-owner-system">Standard System Role</span>`;
    } else {
      sec1Owner.innerHTML = `<span class="sh-owner-tag sh-owner-other">Creator: ${escapeHtml(owner)}</span>`;
    }
  }

  // Section 2: Individual Stakeholders
  const sec2Sub = $("sh-sec-2-sub");
  if (sec2Sub) {
    sec2Sub.textContent = `${people.length} Individual Team Member${people.length === 1 ? '' : 's'} Assigned`;
  }
  const peopleContainer = $("sh-sec-2-val-people");
  if (peopleContainer) {
    if (people.length === 0) {
      peopleContainer.innerHTML = `<div class="sh-person-empty">No individual stakeholders assigned yet. Click "Edit" above to add team members.</div>`;
    } else {
      peopleContainer.innerHTML = people.map(p => {
        const initials = p.name ? p.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() : "U";
        return `
          <div class="sh-person-card">
            <div class="sh-person-avatar">${escapeHtml(initials)}</div>
            <div class="sh-person-info">
              <div class="sh-person-name">${escapeHtml(p.name)}</div>
              ${p.email ? `<div class="sh-person-email">${escapeHtml(p.email)}</div>` : '<div class="sh-person-email muted">No email listed</div>'}
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // Section 3: Assigned Delivery Projects
  const pContainer = $("sh-sec-3-val-projects");
  if (pContainer) {
    pContainer.innerHTML = `<div class="pd-loading muted">Loading assigned project configurations...</div>`;
    
    fetchWithTimeout(`${API_BASE}/projects/stakeholders`, { credentials: "include" })
      .then(res => res.ok ? res.json() : { projects: {} })
      .then(projData => {
        const pMap = projData.projects || {};
        const assignedProjects = [];
        
        for (const [pkey, assignments] of Object.entries(pMap)) {
          const match = assignments.find(a => a.stakeholder_id === s.id);
          if (match) {
            assignedProjects.push({ pkey, ...match });
          }
        }

        // Fallback to s.projects if API has not synced yet
        if (assignedProjects.length === 0 && s.projects && s.projects.length > 0) {
          s.projects.forEach(pkey => {
            assignedProjects.push({ pkey, raci: "C", reporting_level: "standard" });
          });
        }

        if (assignedProjects.length === 0) {
          pContainer.innerHTML = `<div class="sh-person-empty">Not assigned to any projects yet. Click "Edit" above or visit <a href="#projects" class="inline-link" style="color: var(--accent); font-weight: 600;">Project Settings</a> to assign this role.</div>`;
          return;
        }

        pContainer.innerHTML = assignedProjects.map(proj => {
          const pInfo = PROJECT_MAP[proj.pkey] || { name: proj.pkey, color: "#4c8dff" };
          const raci = proj.raci || "C";
          const rep = proj.reporting_level || "standard";
          return `
            <div class="sh-detail-proj-card">
              <div class="sh-detail-proj-left">
                <div class="sh-detail-proj-badge" style="background: ${pInfo.color}22; color: ${pInfo.color}; border: 1px solid ${pInfo.color}44;">${escapeHtml(proj.pkey)}</div>
                <div class="sh-detail-proj-name">
                  <strong>${escapeHtml(pInfo.name)}</strong>
                  <div class="sh-detail-proj-meta">
                    <span class="raci-badge-sm raci-badge-${raci}">RACI: ${raci}</span>
                    <span class="rep-badge-sm">${rep === 'executive' ? 'Executive' : (rep === 'technical' ? 'Technical' : 'Standard')}</span>
                  </div>
                </div>
              </div>
              <button type="button" class="btn-goto-proj-settings" data-key="${escapeHtml(proj.pkey)}">
                Project Settings →
              </button>
            </div>
          `;
        }).join("");

        pContainer.querySelectorAll(".btn-goto-proj-settings").forEach(btn => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            window.location.hash = `projects/${btn.dataset.key}`;
          });
        });
      })
      .catch(err => {
        console.error("Error loading stakeholder project assignments:", err);
        pContainer.innerHTML = `<div class="sh-person-empty">Could not load project assignments.</div>`;
      });
  }

  // Section 4: Priority Focus Areas
  const prioContainer = $("sh-sec-4-val-priorities");
  if (prioContainer) {
    prioContainer.innerHTML = "";
    const prios = s.priority_areas && s.priority_areas.length > 0 ? s.priority_areas : ["Velocity & Burndown", "Sprint Health"];
    prios.forEach(prio => {
      const tag = document.createElement("span");
      tag.className = "sh-prio-tag";
      tag.textContent = prio.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
      prioContainer.appendChild(tag);
    });
  }

  // Section 5: AI Persona & Synthesis Guidance
  const descEl = $("sh-sec-5-val-desc");
  const otherEl = $("sh-sec-5-val-other");
  if (descEl) {
    descEl.textContent = s.description || "Focuses on high-level delivery schedules, sprint health, cross-team dependencies, and team velocity weekly.";
  }
  if (otherEl) {
    otherEl.textContent = (s.other_notes && s.other_notes.trim()) ? s.other_notes.trim() : "None";
  }
}

/**
 * Populate edit form inputs for all sections from stakeholder object
 */
function _populateShSectionEditForms(s) {
  // Section 1 Edit Form
  const editRole = $("sh-edit-role");
  const editRoleType = $("sh-edit-role-type");
  if (editRole) editRole.value = s.role || s.role_type || "";
  if (editRoleType) editRoleType.value = s.role_type || "custom";

  // Section 2 Edit Form (People)
  _sec2PeopleList = s.people ? JSON.parse(JSON.stringify(s.people)) : [];
  _renderSec2PeopleEditChips();

  // Section 3 Edit Form (Projects)
  _sec3ProjectsList = s.projects && s.projects.length > 0 ? [...s.projects] : [];
  _renderSec3ProjectsEditChips();

  // Section 4 Edit Form (Priority Focus Areas)
  if (s.priority_areas && s.priority_areas.length > 0) {
    _sec4PriosList = s.priority_areas.map(p => p.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase()));
  } else {
    _sec4PriosList = ["Velocity & Burndown", "Sprint Health"];
  }
  _renderSec4PriosEditChips();

  // Section 5 Edit Form (Guidance & Notes)
  const editDesc = $("sh-edit-desc");
  const editOther = $("sh-edit-other");
  const editOtherCounter = $("sh-edit-other-counter");
  if (editDesc) editDesc.value = s.description || "";
  if (editOther) {
    editOther.value = s.other_notes || "";
    if (editOtherCounter) {
      editOtherCounter.textContent = `${editOther.value.length} / 500 characters`;
    }
  }
}

/**
 * Save an individual stakeholder section to backend and update views.
 */
async function _saveShSection(secNumber) {
  const s = _stakeholdersData.find(item => item.id === _currentEditingId);
  if (!s) return;

  const saveBtn = document.querySelector(`#sh-sec-${secNumber}-edit .btn-sh-sec-save`);
  const origHtml = saveBtn ? saveBtn.innerHTML : "";
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<svg width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon"><circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="12"></circle></svg> Saving...`;
  }

  try {
    const payload = JSON.parse(JSON.stringify(s));

    if (secNumber === 1) {
      const roleVal = $("sh-edit-role")?.value.trim();
      const roleTypeVal = $("sh-edit-role-type")?.value || "custom";
      if (!roleVal) throw new Error("Please enter a role title.");
      payload.role = roleVal;
      payload.role_type = roleTypeVal;
      payload.name = roleVal;
    } else if (secNumber === 2) {
      // Check if pending person typed
      const pendingName = $("sh-sec-2-new-name")?.value.trim();
      const pendingEmail = $("sh-sec-2-new-email")?.value.trim() || "";
      if (pendingName) {
        _sec2PeopleList.push({ name: pendingName, email: pendingEmail });
        const nameIn = $("sh-sec-2-new-name");
        const emailIn = $("sh-sec-2-new-email");
        if (nameIn) nameIn.value = "";
        if (emailIn) emailIn.value = "";
      }
      payload.people = _sec2PeopleList;
    } else if (secNumber === 3) {
      if (_sec3ProjectsList.length === 0) {
        throw new Error("Please assign at least one delivery project.");
      }
      payload.projects = _sec3ProjectsList;
    } else if (secNumber === 4) {
      payload.priority_areas = _sec4PriosList;
    } else if (secNumber === 5) {
      payload.description = $("sh-edit-desc")?.value.trim() || "";
      payload.other_notes = $("sh-edit-other")?.value.trim().slice(0, 500) || "";
    }

    const res = await fetchWithTimeout(`${API_BASE}/stakeholders/${_currentEditingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to save changes");
    }

    const resData = await res.json();
    const updated = resData.stakeholder || payload;

    // Update in-memory data
    const idx = _stakeholdersData.findIndex(item => item.id === _currentEditingId);
    if (idx >= 0) _stakeholdersData[idx] = updated;

    _renderAllShSectionViews(updated);
    _populateShSectionEditForms(updated);
    _toggleShSectionEdit(secNumber, false);
    updateStakeholdersStats();
  } catch (err) {
    console.error("Save section error:", err);
    alert(err.message || "Failed to save changes");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origHtml;
    }
  }
}

/**
 * Cancel editing for an individual stakeholder section and restore cached values.
 */
function _cancelShSection(secNumber) {
  const s = _stakeholdersData.find(item => item.id === _currentEditingId);
  if (s) {
    _populateShSectionEditForms(s);
  }
  _toggleShSectionEdit(secNumber, false);
}

/**
 * Render chips for Section 2 (People) edit container
 */
function _renderSec2PeopleEditChips() {
  const listEl = $("sh-sec-2-people-list");
  if (!listEl) return;

  if (_sec2PeopleList.length === 0) {
    listEl.innerHTML = `<div class="sh-form-people-empty">No individual stakeholders added yet. Enter names and emails below to add team members.</div>`;
    return;
  }

  listEl.innerHTML = _sec2PeopleList.map((p, idx) => `
    <div class="sh-form-person-chip">
      <span class="sh-form-person-name">${escapeHtml(p.name)}</span>
      ${p.email ? `<span class="sh-form-person-email">&lt;${escapeHtml(p.email)}&gt;</span>` : ''}
      <button type="button" class="btn-remove-person" data-index="${idx}" title="Remove ${escapeHtml(p.name)}">✕ Remove</button>
    </div>
  `).join("");

  listEl.querySelectorAll(".btn-remove-person").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      _sec2PeopleList.splice(idx, 1);
      _renderSec2PeopleEditChips();
    });
  });
}

/**
 * Render chips for Section 3 (Projects) edit container
 */
function _renderSec3ProjectsEditChips() {
  const listEl = $("sh-sec-3-projects-list");
  if (!listEl) return;

  if (_sec3ProjectsList.length === 0) {
    listEl.innerHTML = `<div class="sh-form-projects-empty">No delivery projects assigned. Select a project below and click "+ Add Project".</div>`;
    return;
  }

  listEl.innerHTML = _sec3ProjectsList.map((pkey, idx) => {
    const pInfo = PROJECT_MAP[pkey] || { name: pkey, color: "#4c8dff" };
    return `
      <div class="sh-form-proj-chip" style="--proj-accent: ${pInfo.color}">
        <span class="sh-project-dot"></span>
        <strong class="sh-form-proj-key">${escapeHtml(pkey)}</strong>
        <span class="sh-form-proj-name">${escapeHtml(pInfo.name)}</span>
        <button type="button" class="btn-remove-proj-chip" data-index="${idx}" title="Remove ${escapeHtml(pkey)}">✕</button>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll(".btn-remove-proj-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      _sec3ProjectsList.splice(idx, 1);
      _renderSec3ProjectsEditChips();
    });
  });
}

/**
 * Render chips for Section 4 (Priorities) edit container
 */
function _renderSec4PriosEditChips() {
  const listEl = $("sh-sec-4-prios-list");
  if (!listEl) return;

  if (_sec4PriosList.length === 0) {
    listEl.innerHTML = `<div class="sh-form-prios-empty">No focus areas assigned. Choose a preset or type a custom focus area below.</div>`;
    return;
  }

  listEl.innerHTML = _sec4PriosList.map((prio, idx) => `
    <div class="sh-form-prio-chip">
      <span class="sh-form-prio-name">${escapeHtml(prio)}</span>
      <button type="button" class="btn-remove-prio-chip" data-index="${idx}" title="Remove ${escapeHtml(prio)}">✕</button>
    </div>
  `).join("");

  listEl.querySelectorAll(".btn-remove-prio-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      _sec4PriosList.splice(idx, 1);
      _renderSec4PriosEditChips();
    });
  });
}

/**
 * Switch subview to Add / Creation View (for + Add Stakeholder)
 */
export function showStakeholderForm() {
  const listView = $("stakeholders-list-view");
  const detailView = $("stakeholder-detail-view");
  const formView = $("stakeholder-form-view");

  if (!formView) return;

  _currentEditingId = null;

  $("sh-form-view-title").textContent = "Add Stakeholder Role";
  $("btn-sh-form-submit").textContent = "Create Role";

  // Reset creation form inputs
  $("sh-form-role").value = "";
  $("sh-form-role-type").value = "custom";
  $("sh-form-desc").value = "";

  const otherInput = $("sh-form-other");
  const otherCounter = $("sh-form-other-counter");
  if (otherInput) {
    otherInput.value = "";
    if (otherCounter) otherCounter.textContent = "0 / 500 characters";
  }

  _formPeopleList = [];
  renderFormPeopleChips();

  _formProjectsList = ["HRZ", "CHK"];
  renderFormProjectsChips();

  _formPriosList = ["Velocity & Burndown", "Sprint Health", "Risks & Blockers"];
  renderFormPriosChips();

  const newNameInput = $("sh-new-person-name");
  const newEmailInput = $("sh-new-person-email");
  if (newNameInput) newNameInput.value = "";
  if (newEmailInput) newEmailInput.value = "";

  const customPrioInput = $("sh-custom-prio-input");
  if (customPrioInput) customPrioInput.value = "";
  const prioSelect = $("sh-add-prio-select");
  if (prioSelect) prioSelect.value = "";

  $("sh-form-error").style.display = "none";

  if (listView) listView.style.display = "none";
  if (detailView) detailView.style.display = "none";
  formView.style.display = "block";
  window.scrollTo(0, 0);
  $("sh-form-role").focus();
}

/**
 * Render chips for people in the Add Stakeholder form
 */
function renderFormPeopleChips() {
  const listEl = $("sh-form-people-list");
  if (!listEl) return;

  if (_formPeopleList.length === 0) {
    listEl.innerHTML = `<div class="sh-form-people-empty">No individual stakeholders added yet. Enter names and emails below to add team members.</div>`;
    return;
  }

  listEl.innerHTML = _formPeopleList.map((p, idx) => `
    <div class="sh-form-person-chip">
      <span class="sh-form-person-name">${escapeHtml(p.name)}</span>
      ${p.email ? `<span class="sh-form-person-email">&lt;${escapeHtml(p.email)}&gt;</span>` : ''}
      <button type="button" class="btn-remove-person" data-index="${idx}" title="Remove ${escapeHtml(p.name)}">✕ Remove</button>
    </div>
  `).join("");

  listEl.querySelectorAll(".btn-remove-person").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      _formPeopleList.splice(idx, 1);
      renderFormPeopleChips();
    });
  });
}

/**
 * Render chips for projects in the Add Stakeholder form
 */
function renderFormProjectsChips() {
  const listEl = $("sh-form-projects-list");
  if (!listEl) return;

  if (_formProjectsList.length === 0) {
    listEl.innerHTML = `<div class="sh-form-projects-empty">No delivery projects assigned. Select a project below and click "+ Add Project".</div>`;
    return;
  }

  listEl.innerHTML = _formProjectsList.map((pkey, idx) => {
    const pInfo = PROJECT_MAP[pkey] || { name: pkey, color: "#4c8dff" };
    return `
      <div class="sh-form-proj-chip" style="--proj-accent: ${pInfo.color}">
        <span class="sh-project-dot"></span>
        <strong class="sh-form-proj-key">${escapeHtml(pkey)}</strong>
        <span class="sh-form-proj-name">${escapeHtml(pInfo.name)}</span>
        <button type="button" class="btn-remove-proj-chip" data-index="${idx}" title="Remove ${escapeHtml(pkey)}">✕</button>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll(".btn-remove-proj-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      _formProjectsList.splice(idx, 1);
      renderFormProjectsChips();
    });
  });
}

/**
 * Render chips for priorities in the Add Stakeholder form
 */
function renderFormPriosChips() {
  const listEl = $("sh-form-prios-list");
  if (!listEl) return;

  if (_formPriosList.length === 0) {
    listEl.innerHTML = `<div class="sh-form-prios-empty">No focus areas assigned. Choose a preset or type a custom focus area below.</div>`;
    return;
  }

  listEl.innerHTML = _formPriosList.map((prio, idx) => `
    <div class="sh-form-prio-chip">
      <span class="sh-form-prio-name">${escapeHtml(prio)}</span>
      <button type="button" class="btn-remove-prio-chip" data-index="${idx}" title="Remove ${escapeHtml(prio)}">✕</button>
    </div>
  `).join("");

  listEl.querySelectorAll(".btn-remove-prio-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      _formPriosList.splice(idx, 1);
      renderFormPriosChips();
    });
  });
}

/**
 * Add a project from the dropdown selector in form
 */
function handleAddProjectToForm() {
  const select = $("sh-add-project-select");
  if (!select) return;
  const pkey = select.value;

  if (!_formProjectsList.includes(pkey)) {
    _formProjectsList.push(pkey);
    renderFormProjectsChips();
  }
}

/**
 * Add a priority focus area from dropdown or custom input in form
 */
function handleAddPrioToForm() {
  const customInput = $("sh-custom-prio-input");
  const select = $("sh-add-prio-select");
  
  let prioVal = customInput?.value.trim();
  if (!prioVal && select && select.value) {
    prioVal = select.value;
  }

  if (!prioVal) {
    if (customInput) customInput.focus();
    return;
  }

  if (!_formPriosList.includes(prioVal)) {
    _formPriosList.push(prioVal);
    renderFormPriosChips();
  }

  if (customInput) customInput.value = "";
  if (select) select.value = "";
}

/**
 * Add a person to the form people list
 */
function handleAddPersonToForm() {
  const nameInput = $("sh-new-person-name");
  const emailInput = $("sh-new-person-email");
  const name = nameInput?.value.trim();
  const email = emailInput?.value.trim() || "";

  if (!name) {
    if (nameInput) nameInput.focus();
    return;
  }

  _formPeopleList.push({ name, email });
  renderFormPeopleChips();

  if (nameInput) nameInput.value = "";
  if (emailInput) emailInput.value = "";
  if (nameInput) nameInput.focus();
}

/**
 * Filter and search stakeholders, then render the list rows/cards.
 */
export function applyStakeholderFilters() {
  const container = $("stakeholders-list-container");
  const emptyState = $("stakeholders-empty-state");
  if (!container) return;

  const filtered = _stakeholdersData.filter(s => {
    let matchesFilter = true;
    const rType = (s.role_type || "custom").toLowerCase();
    if (_activeFilter === "project_manager") {
      matchesFilter = rType.includes("project") || rType.includes("manager");
    } else if (_activeFilter === "executive") {
      matchesFilter = rType.includes("exec");
    } else if (_activeFilter === "engineering_qa") {
      matchesFilter = rType.includes("eng") || rType.includes("qa");
    } else if (_activeFilter === "custom") {
      matchesFilter = !s.is_builtin || rType === "custom" || rType === "product_owner";
    }

    let matchesSearch = true;
    if (_searchQuery) {
      const q = _searchQuery.toLowerCase();
      const role = (s.role || "").toLowerCase();
      const desc = (s.description || "").toLowerCase();
      const other = (s.other_notes || "").toLowerCase();
      const owner = (s.owner || "").toLowerCase();
      const prios = (s.priority_areas || []).join(" ").toLowerCase();
      const projects = (s.projects || []).join(" ").toLowerCase();
      const peopleText = (s.people || []).map(p => `${p.name} ${p.email}`).join(" ").toLowerCase();
      matchesSearch = role.includes(q) || desc.includes(q) || other.includes(q) || owner.includes(q) || prios.includes(q) || projects.includes(q) || peopleText.includes(q);
    }

    return matchesFilter && matchesSearch;
  });

  if (filtered.length === 0) {
    container.innerHTML = "";
    if (emptyState) emptyState.style.display = "block";
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  container.innerHTML = filtered.map(s => renderStakeholderRow(s)).join("");

  // Attach event listeners to buttons
  container.querySelectorAll(".btn-sh-details").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.location.hash = `stakeholders/${btn.dataset.id}`;
    });
  });

  container.querySelectorAll(".btn-sh-edit").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      window.location.hash = `stakeholders/${btn.dataset.id}`;
    });
  });

  container.querySelectorAll(".btn-sh-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      confirmDeleteStakeholder(btn.dataset.id, btn.dataset.name);
    });
  });

  // Clicking row opens details
  container.querySelectorAll(".stakeholder-row").forEach(row => {
    row.addEventListener("click", () => {
      window.location.hash = `stakeholders/${row.dataset.id}`;
    });
  });
}

/**
 * Render a single stakeholder row/card according to the layout:
 * [ ROLE & OWNER ] [ PROJECTS ] [ DETAILS / ACTIONS ]
 */
function renderStakeholderRow(s) {
  const icon = ROLE_ICONS[s.role_type] || "👤";
  const roleName = escapeHtml(s.role || s.role_type || "Stakeholder");
  const owner = s.owner || (s.is_builtin ? "system" : "demo");
  const isOwner = (owner === _currentUser);

  // Projects chips
  const projectsList = s.projects && s.projects.length > 0 ? s.projects : ["HRZ"];
  const projectChipsHtml = projectsList.map(pkey => {
    const pInfo = PROJECT_MAP[pkey] || { name: pkey, color: "#4c8dff" };
    return `<span class="sh-project-chip" title="${escapeHtml(pInfo.name)}" style="--proj-accent: ${pInfo.color}">
      <span class="sh-project-dot"></span>${escapeHtml(pkey)}
    </span>`;
  }).join("");

  // Owner badge
  let ownerBadge = "";
  if (isOwner) {
    ownerBadge = `<span class="sh-owner-badge sh-owner-mine" title="Created by you">You</span>`;
  } else if (owner === "system" || s.is_builtin) {
    ownerBadge = `<span class="sh-owner-badge sh-owner-system" title="Standard System Persona">System</span>`;
  } else {
    ownerBadge = `<span class="sh-owner-badge sh-owner-other" title="Created by ${escapeHtml(owner)}">${escapeHtml(owner)}</span>`;
  }

  const builtinBadge = s.is_builtin 
    ? `<span class="sh-type-tag sh-type-builtin" title="Standard Persona">Standard</span>`
    : `<span class="sh-type-tag sh-type-custom" title="Custom Persona">Custom</span>`;

  return `
    <div class="stakeholder-row" data-id="${escapeHtml(s.id)}" role="button" tabindex="0">
      <!-- 1. ROLE & OWNER COLUMN -->
      <div class="sh-col sh-col-role">
        <div class="sh-role-badge">
          <div class="sh-role-info">
            <div class="sh-role-title-row">
              <span class="sh-role-title">${roleName}</span>
              ${builtinBadge}
              ${ownerBadge}
            </div>
          </div>
        </div>
      </div>

      <!-- 2. PROJECTS COLUMN -->
      <div class="sh-col sh-col-projects">
        <div class="sh-projects-wrapper">
          ${projectChipsHtml}
        </div>
      </div>

      <!-- 3. DETAILS & ACTIONS COLUMN -->
      <div class="sh-col sh-col-actions">
        <button class="btn-sh-details" data-id="${escapeHtml(s.id)}" title="View stakeholder details">
          Details
        </button>
        <button class="btn-icon-action btn-sh-edit" data-id="${escapeHtml(s.id)}" title="Edit stakeholder sections">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
        </button>
        <button class="btn-icon-action btn-icon-delete btn-sh-delete" data-id="${escapeHtml(s.id)}" data-name="${roleName}" title="Delete role">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    </div>
  `;
}

/**
 * Handle form submission for Add Stakeholder (Creation)
 */
async function handleStakeholderFormSubmit(e) {
  e.preventDefault();
  const errorEl = $("sh-form-error");
  const submitBtn = $("btn-sh-form-submit");

  const role = $("sh-form-role").value.trim();
  const roleType = $("sh-form-role-type").value;
  const description = $("sh-form-desc").value.trim();
  const otherNotes = $("sh-form-other")?.value.trim().slice(0, 500) || "";

  if (!role) {
    errorEl.textContent = "Please enter a role title.";
    errorEl.style.display = "block";
    return;
  }

  const pendingName = $("sh-new-person-name")?.value.trim();
  const pendingEmail = $("sh-new-person-email")?.value.trim() || "";
  if (pendingName) {
    _formPeopleList.push({ name: pendingName, email: pendingEmail });
  }

  if (_formProjectsList.length === 0) {
    errorEl.textContent = "Please select and add at least one assigned delivery project.";
    errorEl.style.display = "block";
    return;
  }

  const payload = {
    role,
    role_type: roleType,
    name: role,
    description,
    other_notes: otherNotes,
    people: _formPeopleList,
    projects: _formProjectsList,
    priority_areas: _formPriosList,
    is_builtin: false,
    owner: _currentUser
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Creating...";

  try {
    const res = await fetchWithTimeout(`${API_BASE}/stakeholders/item`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Server returned error ${res.status}`);
    }

    const json = await res.json();
    const createdItem = json.stakeholder || payload;

    await renderStakeholdersPage();
    window.location.hash = `stakeholders/${createdItem.id}`;
  } catch (err) {
    console.error("Create stakeholder error:", err);
    errorEl.textContent = err.message || "Failed to create stakeholder role.";
    errorEl.style.display = "block";
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Create Role";
  }
}

/**
 * Delete Stakeholder with confirmation
 */
async function confirmDeleteStakeholder(id, roleName) {
  if (!confirm(`Are you sure you want to delete role "${roleName}"?`)) {
    return;
  }

  try {
    const res = await fetchWithTimeout(`${API_BASE}/stakeholders/${id}`, {
      method: "DELETE",
      credentials: "include"
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      alert(errData.detail || "Failed to delete stakeholder role");
      return;
    }

    await renderStakeholdersPage();
    window.location.hash = "stakeholders";
  } catch (err) {
    console.error("Delete stakeholder error:", err);
    alert("Error deleting stakeholder role: " + err.message);
  }
}

/**
 * Initialize all Stakeholders page event bindings
 */
export function initStakeholdersEvents() {
  // Search input
  const searchInput = $("stakeholder-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      _searchQuery = e.target.value.trim();
      applyStakeholderFilters();
    });
  }

  // Filter pills
  const pills = document.querySelectorAll("#stakeholder-filter-pills .filter-pill");
  pills.forEach(pill => {
    pill.addEventListener("click", () => {
      pills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      _activeFilter = pill.dataset.filter || "all";
      applyStakeholderFilters();
    });
  });

  // "Add Stakeholder" button in header
  const btnAdd = $("btn-add-stakeholder-main");
  if (btnAdd) {
    btnAdd.addEventListener("click", () => {
      window.location.hash = "stakeholders/new";
    });
  }

  // "Reset Defaults" button in header
  const btnReset = $("btn-reset-stakeholders");
  if (btnReset) {
    btnReset.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to reset all stakeholders to default template personas? Custom stakeholder modifications will be reverted.")) {
        return;
      }
      try {
        const res = await fetchWithTimeout(`${API_BASE}/stakeholders/reset`, {
          method: "POST",
          credentials: "include"
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.detail || "Failed to reset stakeholders");
        }
        await renderStakeholdersPage();
        showStakeholdersList();
      } catch (err) {
        console.error("Reset stakeholders error:", err);
        alert("Error resetting stakeholders: " + err.message);
      }
    });
  }

  // Back button in Detail View
  const btnBackDetail = $("btn-back-sh-detail");
  if (btnBackDetail) {
    btnBackDetail.addEventListener("click", () => {
      window.location.hash = "stakeholders";
    });
  }

  // Section Edit Buttons (Section 1..5)
  document.querySelectorAll(".btn-sh-section-edit").forEach(btn => {
    btn.addEventListener("click", () => {
      const secNum = parseInt(btn.dataset.section, 10);
      if (secNum) _toggleShSectionEdit(secNum, true);
    });
  });

  // Section Cancel Buttons (Section 1..5)
  document.querySelectorAll(".btn-sh-sec-cancel").forEach(btn => {
    btn.addEventListener("click", () => {
      const secNum = parseInt(btn.dataset.section, 10);
      if (secNum) _cancelShSection(secNum);
    });
  });

  // Section Save Buttons (Section 1..5)
  document.querySelectorAll(".btn-sh-sec-save").forEach(btn => {
    btn.addEventListener("click", () => {
      const secNum = parseInt(btn.dataset.section, 10);
      if (secNum) _saveShSection(secNum);
    });
  });

  // Section 2: Add Person in edit mode
  const btnSec2AddPerson = $("btn-sh-sec-2-add-person");
  if (btnSec2AddPerson) {
    btnSec2AddPerson.addEventListener("click", () => {
      const nameInput = $("sh-sec-2-new-name");
      const emailInput = $("sh-sec-2-new-email");
      const name = nameInput?.value.trim();
      const email = emailInput?.value.trim() || "";
      if (!name) {
        if (nameInput) nameInput.focus();
        return;
      }
      _sec2PeopleList.push({ name, email });
      _renderSec2PeopleEditChips();
      if (nameInput) nameInput.value = "";
      if (emailInput) emailInput.value = "";
      if (nameInput) nameInput.focus();
    });
  }

  // Section 3: Add Project in edit mode
  const btnSec3AddProject = $("btn-sh-sec-3-add-project");
  if (btnSec3AddProject) {
    btnSec3AddProject.addEventListener("click", () => {
      const select = $("sh-sec-3-add-project-select");
      if (!select) return;
      const pkey = select.value;
      if (pkey && !_sec3ProjectsList.includes(pkey)) {
        _sec3ProjectsList.push(pkey);
        _renderSec3ProjectsEditChips();
      }
    });
  }

  // Section 4: Add Priority in edit mode
  const btnSec4AddPrio = $("btn-sh-sec-4-add-prio");
  if (btnSec4AddPrio) {
    btnSec4AddPrio.addEventListener("click", () => {
      const customInput = $("sh-sec-4-custom-prio-input");
      const select = $("sh-sec-4-add-prio-select");
      let prioVal = customInput?.value.trim();
      if (!prioVal && select && select.value) {
        prioVal = select.value;
      }
      if (!prioVal) {
        if (customInput) customInput.focus();
        return;
      }
      if (!_sec4PriosList.includes(prioVal)) {
        _sec4PriosList.push(prioVal);
        _renderSec4PriosEditChips();
      }
      if (customInput) customInput.value = "";
      if (select) select.value = "";
    });
  }

  // Section 5: Real-time counter for Other Notes
  const editOtherInput = $("sh-edit-other");
  const editOtherCounter = $("sh-edit-other-counter");
  if (editOtherInput && editOtherCounter) {
    editOtherInput.addEventListener("input", () => {
      const len = editOtherInput.value.length;
      editOtherCounter.textContent = `${len} / 500 characters`;
      if (len >= 480) {
        editOtherCounter.style.color = "var(--amber)";
      } else {
        editOtherCounter.style.color = "var(--text-dim)";
      }
    });
  }

  // Creation View: Back button
  const btnBackForm = $("btn-back-sh-form");
  if (btnBackForm) {
    btnBackForm.addEventListener("click", () => {
      window.location.hash = "stakeholders";
    });
  }

  // Creation View: Cancel button
  const btnCancelForm = $("btn-cancel-sh-form");
  if (btnCancelForm) {
    btnCancelForm.addEventListener("click", () => {
      window.location.hash = "stakeholders";
    });
  }

  // Creation View: Form submission
  const form = $("form-stakeholder");
  if (form) {
    form.addEventListener("submit", handleStakeholderFormSubmit);
  }

  // Creation View: Add person button
  const btnAddPerson = $("btn-add-person-item");
  if (btnAddPerson) {
    btnAddPerson.addEventListener("click", handleAddPersonToForm);
  }

  // Creation View: Add project button
  const btnAddProject = $("btn-add-project-item");
  if (btnAddProject) {
    btnAddProject.addEventListener("click", handleAddProjectToForm);
  }

  // Creation View: Add Priority Focus Area button
  const btnAddPrio = $("btn-add-prio-item");
  if (btnAddPrio) {
    btnAddPrio.addEventListener("click", handleAddPrioToForm);
  }

  // Creation View: Counter for Other Notes
  const otherInput = $("sh-form-other");
  const otherCounter = $("sh-form-other-counter");
  if (otherInput && otherCounter) {
    otherInput.addEventListener("input", () => {
      const len = otherInput.value.length;
      otherCounter.textContent = `${len} / 500 characters`;
      if (len >= 480) {
        otherCounter.style.color = "var(--amber)";
      } else {
        otherCounter.style.color = "var(--text-dim)";
      }
    });
  }
}
