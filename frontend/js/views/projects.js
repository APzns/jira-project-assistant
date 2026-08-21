/**
 * projects.js — Complete Project Lifecycle (Add, Edit, Delete, Archive, Restore),
 * Dynamic Grid Rendering, Filter Pills, Search, Project Detail View,
 * and RACI Matrix Customization.
 */

import { $, escapeHtml } from "../utils.js";
import { API_BASE } from "../state.js";
import { fetchWithTimeout } from "../api.js";

let _projectsData = [
  {
    key: "CHK",
    name: "Checkout Flow Replatform",
    description: "Redesigning the global checkout flow with one-click purchase, localized currencies, and multi-gateway failover resilience.",
    lead: "Alex Mercer",
    target_release: "Q4 2026 (v2.4)",
    status: "delayed",
    progress_pct: 75,
    progress_sp: "340 / 500 SP",
    blockers_count: 4,
    tags: ["Payments", "Checkout", "Frontend", "API"],
    archived: false
  },
  {
    key: "CORE",
    name: "Platform Core & Analytics Foundation",
    description: "Microservices migration, database horizontal partitioning, real-time Kafka event streaming, and unified program telemetry.",
    lead: "Marcus Vance",
    target_release: "Q3 2026 (v3.0)",
    status: "on-track",
    progress_pct: 82,
    progress_sp: "490 / 600 SP",
    blockers_count: 0,
    tags: ["Infrastructure", "Analytics", "PostgreSQL", "Kafka"],
    archived: false
  },
  {
    key: "MOB",
    name: "Mobile Parity & Security Guild",
    description: "Achieving full iOS & Android feature parity while hardening SOC2, PCI-DSS compliance, and zero-trust SSO authentication.",
    lead: "Dr. Aris Thorne",
    target_release: "Q4 2026 (v1.8)",
    status: "on-track",
    progress_pct: 54,
    progress_sp: "215 / 400 SP",
    blockers_count: 1,
    tags: ["Mobile", "iOS", "Android", "Security", "Auth0"],
    archived: false
  },
  {
    key: "HRZ",
    name: "Project Horizon",
    description: "The overarching program coordinating all enterprise software delivery initiatives, dependency management, and release trains.",
    lead: "Elena Rostova",
    target_release: "FY27 Program Go-Live (Delayed)",
    status: "at-risk",
    progress_pct: 70,
    progress_sp: "1045 / 1500 SP",
    blockers_count: 3,
    tags: ["Program", "Portfolio", "Delivery", "Horizon"],
    archived: false
  }
];
let _activeFilter = "all";
let _searchQuery = "";
let _currentProjectKey = null;
let _currentProjectObj = null;
let _projectAssignments = [];
let _allStakeholders = [];
let _selectedStakeholderToAssignId = null;
let _editingProjectKey = null; // null for new project, key string for editing
let _deletingProjectKey = null;
let _allProjectStakeholders = {};

const STATUS_CONFIG = {
  "on-track": { label: "On Track", tagClass: "p-status-ok", fillClass: "p-fill-ok" },
  "at-risk": { label: "At Risk", tagClass: "p-status-warn", fillClass: "p-fill-warn" },
  "delayed": { label: "Delayed", tagClass: "p-status-warn", fillClass: "p-fill-warn" },
  "planning": { label: "In Planning", tagClass: "p-status-ok", fillClass: "p-fill-ok" },
  "completed": { label: "Completed", tagClass: "p-status-ok", fillClass: "p-fill-ok" }
};

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
 * Fetch all projects from API and render the grid.
 */
export async function renderProjectsPage() {
  const grid = $("projects-grid");

  // Instant render if data is already cached in memory
  if (_projectsData && _projectsData.length > 0) {
    updateProjectsStats();
    applyProjectFilters();
  } else if (grid) {
    grid.innerHTML = `<div class="pd-loading muted" style="grid-column: 1 / -1; padding: 40px; text-align: center;">Loading portfolio governance...</div>`;
  }

  try {
    const [projRes, shRes] = await Promise.allSettled([
      fetchWithTimeout(`${API_BASE}/projects?include_archived=true`, { credentials: "include" }, 8000),
      fetchWithTimeout(`${API_BASE}/projects/stakeholders`, { credentials: "include" }, 8000)
    ]);

    if (projRes.status === "fulfilled" && projRes.value.ok) {
      const data = await projRes.value.json();
      _projectsData = data.projects || [];
    } else {
      console.warn("Could not load projects from API");
    }

    if (shRes.status === "fulfilled" && shRes.value.ok) {
      const shData = await shRes.value.json();
      _allProjectStakeholders = shData.projects || {};
    }
  } catch (err) {
    console.error("Failed to fetch projects or stakeholders:", err);
  }

  updateProjectsStats();
  applyProjectFilters();
}

/**
 * Update top KPI stat boxes for projects.
 */
function updateProjectsStats() {
  const activeCount = _projectsData.filter(p => !p.archived).length;
  const onTrackCount = _projectsData.filter(p => !p.archived && (p.status === "on-track" || p.status === "planning")).length;
  const atRiskCount = _projectsData.filter(p => !p.archived && (p.status === "at-risk" || p.status === "delayed")).length;
  const archivedCount = _projectsData.filter(p => p.archived).length;

  const elActive = $("p-stat-active");
  const elOnTrack = $("p-stat-ontrack");
  const elAtRisk = $("p-stat-atrisk");
  const elArchived = $("p-stat-archived");

  if (elActive) elActive.textContent = activeCount;
  if (elOnTrack) elOnTrack.textContent = onTrackCount;
  if (elAtRisk) elAtRisk.textContent = atRiskCount;
  if (elArchived) elArchived.textContent = archivedCount;
}

/**
 * Filter and render project cards in the grid.
 */
export function applyProjectFilters() {
  let filtered = [..._projectsData];

  // 1. Status / Archive filter
  if (_activeFilter === "active") {
    filtered = filtered.filter(p => !p.archived);
  } else if (_activeFilter === "archived") {
    filtered = filtered.filter(p => Boolean(p.archived));
  } else if (_activeFilter === "on-track") {
    filtered = filtered.filter(p => !p.archived && p.status === "on-track");
  } else if (_activeFilter === "at-risk") {
    filtered = filtered.filter(p => !p.archived && (p.status === "at-risk" || p.status === "delayed"));
  }

  // 2. Search query filter
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    filtered = filtered.filter(p => {
      const name = (p.name || "").toLowerCase();
      const key = (p.key || "").toLowerCase();
      const desc = (p.description || "").toLowerCase();
      const lead = (p.lead || "").toLowerCase();
      const tags = (p.tags || []).join(" ").toLowerCase();
      return name.includes(q) || key.includes(q) || desc.includes(q) || lead.includes(q) || tags.includes(q);
    });
  }

  renderProjectsGrid(filtered);
}

function renderProjectsGrid(filtered) {
  const grid = $("projects-grid");
  if (!grid) return;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="p-empty-state">
        <div class="p-empty-state-icon">📂</div>
        <h4 class="p-empty-state-title">No projects match your criteria</h4>
        <p class="p-empty-state-sub">Try changing your search terms or filter selection, or create a new project.</p>
        <button type="button" class="btn-primary" onclick="window.dispatchEvent(new CustomEvent('open-add-project-modal'))">
          + Add New Project
        </button>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const key = escapeHtml(p.key || "");
    const name = escapeHtml(p.name || "Untitled Project");
    const desc = escapeHtml(p.description || "No description provided.");
    const lead = escapeHtml(p.lead || "Unassigned");
    const release = escapeHtml(p.target_release || "TBD");
    const statusKey = p.status || "on-track";
    const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG["on-track"];
    const isArchived = Boolean(p.archived);
    const tags = (p.tags || []).map(t => `<span class="p-tag">${escapeHtml(t)}</span>`).join("");

    const blockers = p.blockers_count || 0;
    const blockersHtml = blockers > 0
      ? `<span class="p-meta-value text-warn">${blockers} Active</span>`
      : `<span class="p-meta-value text-green">0 Active</span>`;

    const archiveBadgeHtml = isArchived
      ? `<span class="p-archived-badge">Archived</span>`
      : "";

    // RACI stakeholder coverage
    const shList = _allProjectStakeholders[p.key] || [];
    const rItems = shList.filter(s => s.raci === "R").map(s => s.stakeholder_id);
    const aItems = shList.filter(s => s.raci === "A").map(s => s.stakeholder_id);
    const cCount = shList.filter(s => s.raci === "C").length;
    const iCount = shList.filter(s => s.raci === "I").length;

    let raciHtml = "";
    if (shList.length > 0) {
      raciHtml = `
        <div class="p-raci-roster">
          <div class="p-raci-title">RACI Governance Coverage</div>
          <div class="p-raci-pills-row">
            ${rItems.length > 0 ? `<span class="p-raci-pill role-r" title="Responsible"><strong>R:</strong> ${escapeHtml(rItems.join(', '))}</span>` : '<span class="p-raci-pill role-r"><strong>R:</strong> Unassigned</span>'}
            ${aItems.length > 0 ? `<span class="p-raci-pill role-a" title="Accountable"><strong>A:</strong> ${escapeHtml(aItems.join(', '))}</span>` : ''}
            ${cCount > 0 ? `<span class="p-raci-pill" title="Consulted"><strong>C:</strong> ${cCount}</span>` : ''}
            ${iCount > 0 ? `<span class="p-raci-pill" title="Informed"><strong>I:</strong> ${iCount}</span>` : ''}
          </div>
        </div>
      `;
    } else {
      raciHtml = `
        <div class="p-raci-roster">
          <div class="p-raci-title">RACI Governance Coverage</div>
          <div class="p-raci-pills-row">
            <span class="muted" style="font-size: 11.5px;">No stakeholders assigned yet</span>
          </div>
        </div>
      `;
    }

    return `
      <div class="project-card p-governance-card ${isArchived ? 'p-card-archived' : ''}" data-key="${key}" data-status="${statusKey}">
        <div class="p-card-top">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="p-key-badge">${key}</div>
            ${archiveBadgeHtml}
          </div>
          <div class="p-status-tag ${statusCfg.tagClass}">
            <span class="p-status-dot"></span> ${statusCfg.label}
          </div>
        </div>

        <h3 class="p-title">${name}</h3>
        <p class="p-desc">${desc}</p>

        <!-- Scope & Milestone Targets -->
        <div class="p-meta-grid" style="margin-bottom: 14px;">
          <div class="p-meta-item">
            <span class="p-meta-label">Target Milestone</span>
            <span class="p-meta-value">${release}</span>
          </div>
          <div class="p-meta-item">
            <span class="p-meta-label">Lead / Owner</span>
            <span class="p-meta-value">${lead}</span>
          </div>
          <div class="p-meta-item">
            <span class="p-meta-label">Blockers</span>
            ${blockersHtml}
          </div>
        </div>

        <!-- RACI Stakeholder Roster -->
        ${raciHtml}

        <!-- Tags and Actions -->
        <div class="p-card-footer">
          <div class="p-tags">
            ${tags}
          </div>
          <div class="p-card-quick-actions">
            <button type="button" class="btn-p-view-dashboard" data-key="${key}" title="Open ${key} Live Dashboard">
              📊 Dashboard
            </button>
            <button type="button" class="btn-p-icon-action btn-p-archive-quick" data-key="${key}" data-archived="${isArchived}" title="${isArchived ? 'Restore / Unarchive Project' : 'Archive Project'}">
              ${isArchived ? '📤' : '📦'}
            </button>
            <button type="button" class="btn-p-icon-action btn-p-del btn-p-delete-quick" data-key="${key}" data-name="${name}" title="Delete Project">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
            <button type="button" class="btn-p-action btn-p-view-details" data-key="${key}" title="View Full Charter & RACI Matrix">
              Charter &amp; RACI →
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  // Bind card clicks & quick buttons
  grid.querySelectorAll(".project-card").forEach(card => {
    const key = card.dataset.key;

    // View Dashboard button
    card.querySelector(".btn-p-view-dashboard")?.addEventListener("click", (e) => {
      e.stopPropagation();
      window.location.hash = `dashboards/${key}`;
    });

    // Details button or clicking card body
    card.querySelector(".btn-p-view-details")?.addEventListener("click", (e) => {
      e.stopPropagation();
      window.location.hash = `projects/${key}`;
    });

    card.addEventListener("click", (e) => {
      if (e.target.closest(".p-card-quick-actions")) return;
      window.location.hash = `projects/${key}`;
    });


    // Quick Archive
    card.querySelector(".btn-p-archive-quick")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const isArchived = e.currentTarget.dataset.archived === "true";
      toggleArchiveProject(key, !isArchived);
    });

    // Quick Delete
    card.querySelector(".btn-p-delete-quick")?.addEventListener("click", (e) => {
      e.stopPropagation();
      const projName = e.currentTarget.dataset.name || key;
      openDeleteModal(key, projName);
    });
  });
}

/**
 * Open Project Detail View
 */
export async function openProjectDetailByKey(projectKey) {
  _currentProjectKey = projectKey.toUpperCase().trim();
  const pList = $("projects-list-view");
  const pDetail = $("project-detail-view");

  if (!pDetail) return;
  if (pList) pList.style.display = "none";
  pDetail.style.display = "block";
  window.scrollTo(0, 0);

  // Fetch full project detail from API
  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${_currentProjectKey}`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      _currentProjectObj = data.project;
      _projectAssignments = data.assignments || [];
    } else {
      // Fallback to local memory if available
      _currentProjectObj = _projectsData.find(p => p.key === _currentProjectKey) || {
        key: _currentProjectKey,
        name: _currentProjectKey,
        description: "Project information",
        status: "on-track",
        progress_pct: 0,
        progress_sp: "0 / 0 SP",
        tags: [],
        archived: false
      };
    }
  } catch (err) {
    console.error("Error loading project detail:", err);
  }

  const p = _currentProjectObj;
  const key = escapeHtml(p.key || _currentProjectKey);
  const name = escapeHtml(p.name || key);
  const desc = escapeHtml(p.description || "No description provided.");
  const lead = escapeHtml(p.lead || "Unassigned");
  const release = escapeHtml(p.target_release || "TBD");
  const statusKey = p.status || "on-track";
  const statusCfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG["on-track"];
  const pct = Math.max(0, Math.min(100, p.progress_pct || 0));
  const spText = escapeHtml(p.progress_sp || `${pct}% complete`);
  const blockers = p.blockers_count || 0;
  const isArchived = Boolean(p.archived);

  $("pd-title").textContent = p.name || key;
  $("pd-desc").textContent = p.description || "";
  $("pd-badge").textContent = key;
  $("pd-lead-info").textContent = `Lead: ${lead} • Target: ${release}`;

  $("pd-status").innerHTML = `
    <span class="p-status-tag ${statusCfg.tagClass}">
      <span class="p-status-dot"></span> ${statusCfg.label}
    </span>
  `;

  const archivedTag = $("pd-archived-tag");
  if (archivedTag) {
    if (isArchived) {
      archivedTag.style.display = "inline-flex";
      archivedTag.innerHTML = `<span class="p-archived-badge">Archived</span>`;
    } else {
      archivedTag.style.display = "none";
    }
  }

  const btnArchiveText = $("btn-archive-project-text");
  if (btnArchiveText) {
    btnArchiveText.textContent = isArchived ? "Restore / Unarchive" : "Archive Project";
  }

  $("pd-progress-container").innerHTML = `
    <div class="p-progress-wrap" style="margin: 0; background: transparent; border: none; padding: 0;">
      <div class="p-progress-header">
        <span style="font-weight: 600;">Delivery Progress</span>
        <strong>${pct}% (${spText})</strong>
      </div>
      <div class="p-progress-bar" style="height: 10px;">
        <div class="p-progress-fill ${statusCfg.fillClass}" style="width: ${pct}%;"></div>
      </div>
    </div>
  `;

  $("pd-meta-container").innerHTML = `
    <h4 style="margin: 0 0 12px 0; font-size: 13px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.5px;">Milestone & Team</h4>
    <div class="p-meta-grid" style="border: none; margin: 0; padding: 0;">
      <div class="p-meta-item">
        <span class="p-meta-label">Target Release</span>
        <span class="p-meta-value">${release}</span>
      </div>
      <div class="p-meta-item">
        <span class="p-meta-label">Project Lead</span>
        <span class="p-meta-value">${lead}</span>
      </div>
      <div class="p-meta-item">
        <span class="p-meta-label">Active Blockers</span>
        <span class="p-meta-value ${blockers > 0 ? 'text-warn' : 'text-green'}">${blockers} Active</span>
      </div>
      <div class="p-meta-item">
        <span class="p-meta-label">Status</span>
        <span class="p-meta-value">${statusCfg.label}</span>
      </div>
    </div>
  `;

  const tagsContainer = $("pd-tags");
  if (tagsContainer) {
    const tags = p.tags || [];
    tagsContainer.innerHTML = tags.length > 0
      ? tags.map(t => `<span class="p-tag">${escapeHtml(t)}</span>`).join("")
      : `<span class="muted" style="font-size: 13px;">No tags defined</span>`;
  }

  // Load project stakeholders & RACI matrix
  loadProjectStakeholders(_currentProjectKey);

  // Load project-specific reports & briefings
  loadProjectReports(_currentProjectKey);
}

/**
 * Load and render project-specific reports in project detail view
 */
export async function loadProjectReports(projectKey) {
  const pkey = (projectKey || _currentProjectKey || "").toUpperCase().trim();
  const container = $("pd-reports-view-container");
  const btnAddReport = $("btn-add-proj-report");
  if (!container) return;

  if (btnAddReport) {
    btnAddReport.onclick = () => {
      window.location.hash = "reports/new";
    };
  }

  container.innerHTML = `<div class="pd-loading muted" style="grid-column: 1 / -1; padding: 24px; text-align: center;">Loading ${escapeHtml(pkey)} project reports...</div>`;

  try {
    const res = await fetchWithTimeout(`${API_BASE}/reports?project_key=${encodeURIComponent(pkey)}`, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const templates = data.templates || [];

    if (templates.length === 0) {
      container.innerHTML = `
        <div class="pd-sh-empty" style="grid-column: 1 / -1; padding: 28px; text-align: center;">
          <span style="font-size: 26px; display: block; margin-bottom: 8px;">📋</span>
          <p style="margin: 0 0 4px 0; color: var(--text); font-weight: 600;">No reports configured specifically for ${escapeHtml(pkey)} yet.</p>
          <p class="muted" style="margin: 0 0 14px 0; font-size: 13px;">Create a report template scoped to this project to track delivery KPIs, sprint velocity, and risks.</p>
          <a href="#reports/new" class="btn-primary btn-sm" style="display: inline-flex; align-items: center; gap: 6px;">
            + Create Report for ${escapeHtml(pkey)}
          </a>
        </div>
      `;
      return;
    }

    container.innerHTML = templates.map(t => {
      const id = escapeHtml(t.id || "");
      const name = escapeHtml(t.name || "Untitled Report");
      const desc = escapeHtml(t.description || "Project delivery and status digest.");
      const blocksCount = (t.blocks || []).length;
      const scope = (t.project_scope || "ALL").toUpperCase();
      const isDirectMatch = scope === pkey;

      const scopeBadge = isDirectMatch
        ? `<span class="report-scope-badge scope-proj">📦 Scoped: ${escapeHtml(pkey)}</span>`
        : `<span class="report-scope-badge scope-all">🌐 Portfolio Template</span>`;

      const owner = escapeHtml(t.owner || "Alex Mercer");
      const cadence = escapeHtml(t.cadence || "weekly");
      const lastGen = t.last_generated_at ? new Date(t.last_generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Never run";

      return `
        <div class="pd-proj-report-card" data-id="${id}">
          <div class="pd-proj-report-head">
            <div>
              <strong class="pd-proj-report-title">${name}</strong>
              <div style="margin-top: 4px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                ${scopeBadge}
                <span class="report-badge-blocks">🔄 ${cadence}</span>
              </div>
            </div>
            <span class="report-badge-blocks">${blocksCount} Sections</span>
          </div>
          <p class="pd-proj-report-desc">${desc}</p>
          <div style="font-size: 11.5px; color: var(--text-dim); margin-bottom: 10px; display: flex; gap: 10px; flex-wrap: wrap;">
            <span>👤 ${owner}</span>
            <span>🕒 Last run: ${escapeHtml(lastGen)}</span>
          </div>
          <div class="pd-proj-report-actions">
            <button type="button" class="btn-secondary btn-sm btn-p-rep-view" data-id="${id}">
              ✏️ Configure / Details
            </button>
          </div>
        </div>
      `;
    }).join("");

    container.querySelectorAll(".btn-p-rep-view").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (id) window.location.hash = `reports/${id}`;
      };
    });

    container.querySelectorAll(".btn-p-rep-gen").forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (id) window.location.hash = `reports/${id}`;
      };
    });

    container.querySelectorAll(".pd-proj-report-card").forEach(card => {
      card.onclick = () => {
        const id = card.dataset.id;
        if (id) window.location.hash = `reports/${id}`;
      };
    });
  } catch (err) {
    console.error("Error loading project reports:", err);
    container.innerHTML = `<div class="error-text" style="grid-column: 1 / -1; padding: 20px; text-align: center;">Failed to load reports for ${escapeHtml(pkey)}.</div>`;
  }
}

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
 * Render searchable dropdown items for role assignment
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
 * Open the Project Stakeholders editor
 */
function openProjectStakeholdersEditor() {
  const viewContainer = $("pd-stakeholders-view-container");
  const editContainer = $("pd-stakeholders-edit-container");
  const btnEdit = $("btn-edit-proj-stakeholders");
  const projKeySpan = $("pd-edit-proj-key");
  const searchInput = $("pd-input-search-sh");
  const dropdown = $("pd-sh-search-dropdown");

  if (btnEdit) btnEdit.style.display = "none";
  if (projKeySpan) projKeySpan.textContent = _currentProjectKey;
  if (searchInput) searchInput.value = "";
  if (dropdown) dropdown.style.display = "none";
  _selectedStakeholderToAssignId = null;

  renderProjectStakeholdersEditList();

  if (viewContainer) viewContainer.style.display = "none";
  if (editContainer) editContainer.style.display = "flex";
}

/**
 * Render the editable list of project stakeholders
 */
function renderProjectStakeholdersEditList() {
  const listEl = $("pd-assigned-sh-edit-list");
  if (!listEl) return;

  if (_projectAssignments.length === 0) {
    listEl.innerHTML = `<div class="pd-edit-empty">No stakeholders assigned yet. Use the search input above to add roles to this project.</div>`;
    return;
  }

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
          <div class="form-group" style="flex: 1;">
            <label class="settings-label">RACI Role</label>
            <select class="settings-select pd-edit-raci-select" data-index="${idx}">
              <option value="R" ${raciVal === 'R' ? 'selected' : ''}>R — Responsible (Drives work)</option>
              <option value="A" ${raciVal === 'A' ? 'selected' : ''}>A — Accountable (Decision maker)</option>
              <option value="C" ${raciVal === 'C' ? 'selected' : ''}>C — Consulted (SME input)</option>
              <option value="I" ${raciVal === 'I' ? 'selected' : ''}>I — Informed (Status updates)</option>
            </select>
          </div>

          <div class="form-group" style="flex: 1;">
            <label class="settings-label">Reporting Detail Level</label>
            <select class="settings-select pd-edit-rep-select" data-index="${idx}">
              <option value="executive" ${repVal === 'executive' ? 'selected' : ''}>Executive Summary (Milestones, ROI)</option>
              <option value="standard" ${repVal === 'standard' ? 'selected' : ''}>Standard Dashboard (Weekly digests)</option>
              <option value="technical" ${repVal === 'technical' ? 'selected' : ''}>Technical Deep Dive (Granular debt, PRs)</option>
            </select>
          </div>
        </div>

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

  listEl.querySelectorAll(".btn-remove-proj-sh").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index, 10);
      _projectAssignments.splice(idx, 1);
      openProjectStakeholdersEditor();
    });
  });

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
 * Open Modal to Add or Edit Project
 */
export function openProjectModal(projectToEdit = null) {
  const modal = $("modal-project-form");
  const title = $("modal-proj-title");
  const keyInput = $("proj-form-key");
  const nameInput = $("proj-form-name");
  const descInput = $("proj-form-desc");
  const leadInput = $("proj-form-lead");
  const releaseInput = $("proj-form-release");
  const statusSelect = $("proj-form-status");
  const pctInput = $("proj-form-pct");
  const spInput = $("proj-form-sp");
  const blockersInput = $("proj-form-blockers");
  const tagsInput = $("proj-form-tags");

  if (!modal) return;

  if (projectToEdit) {
    _editingProjectKey = projectToEdit.key;
    if (title) title.textContent = `Edit Project (${projectToEdit.key})`;
    if (keyInput) {
      keyInput.value = projectToEdit.key || "";
      keyInput.disabled = true; // Key cannot be edited
    }
    if (nameInput) nameInput.value = projectToEdit.name || "";
    if (descInput) descInput.value = projectToEdit.description || "";
    if (leadInput) leadInput.value = projectToEdit.lead || "";
    if (releaseInput) releaseInput.value = projectToEdit.target_release || "";
    if (statusSelect) statusSelect.value = projectToEdit.status || "on-track";
    if (pctInput) pctInput.value = projectToEdit.progress_pct ?? 0;
    if (spInput) spInput.value = projectToEdit.progress_sp || "";
    if (blockersInput) blockersInput.value = projectToEdit.blockers_count ?? 0;
    if (tagsInput) tagsInput.value = (projectToEdit.tags || []).join(", ");
  } else {
    _editingProjectKey = null;
    if (title) title.textContent = "Add New Project";
    if (keyInput) {
      keyInput.value = "";
      keyInput.disabled = false;
    }
    if (nameInput) nameInput.value = "";
    if (descInput) descInput.value = "";
    if (leadInput) leadInput.value = "";
    if (releaseInput) releaseInput.value = "";
    if (statusSelect) statusSelect.value = "on-track";
    if (pctInput) pctInput.value = 0;
    if (spInput) spInput.value = "";
    if (blockersInput) blockersInput.value = 0;
    if (tagsInput) tagsInput.value = "";
  }

  modal.style.display = "flex";
  if (keyInput && !keyInput.disabled) keyInput.focus();
  else if (nameInput) nameInput.focus();
}

/**
 * Close Project Modal
 */
export function closeProjectModal() {
  const modal = $("modal-project-form");
  if (modal) modal.style.display = "none";
}

/**
 * Handle Save in Project Modal (Create or Update)
 */
async function handleSaveProjectModal() {
  const saveBtn = $("btn-save-proj-modal");
  const keyInput = $("proj-form-key");
  const nameInput = $("proj-form-name");
  const descInput = $("proj-form-desc");
  const leadInput = $("proj-form-lead");
  const releaseInput = $("proj-form-release");
  const statusSelect = $("proj-form-status");
  const pctInput = $("proj-form-pct");
  const spInput = $("proj-form-sp");
  const blockersInput = $("proj-form-blockers");
  const tagsInput = $("proj-form-tags");

  const name = nameInput ? nameInput.value.trim() : "";
  if (!name) {
    alert("Project Name is required.");
    if (nameInput) nameInput.focus();
    return;
  }

  const tags = tagsInput ? tagsInput.value.split(",").map(t => t.trim()).filter(Boolean) : [];

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
  }

  try {
    if (_editingProjectKey) {
      // UPDATE
      const payload = {
        name,
        description: descInput ? descInput.value.trim() : "",
        lead: leadInput ? leadInput.value.trim() : "",
        target_release: releaseInput ? releaseInput.value.trim() : "",
        status: statusSelect ? statusSelect.value : "on-track",
        progress_pct: pctInput ? parseInt(pctInput.value, 10) || 0 : 0,
        progress_sp: spInput ? spInput.value.trim() : "",
        blockers_count: blockersInput ? parseInt(blockersInput.value, 10) || 0 : 0,
        tags
      };

      const res = await fetchWithTimeout(`${API_BASE}/projects/${_editingProjectKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to update project");
      }

      closeProjectModal();
      await renderProjectsPage();
      if (_currentProjectKey === _editingProjectKey) {
        openProjectDetailByKey(_editingProjectKey);
      }
    } else {
      // CREATE
      const rawKey = keyInput ? keyInput.value.toUpperCase().trim() : "";
      if (!rawKey || rawKey.length < 2) {
        alert("Project Key must be at least 2 characters (e.g. PAY, SEC, BILL).");
        if (keyInput) keyInput.focus();
        return;
      }

      const payload = {
        key: rawKey,
        name,
        description: descInput ? descInput.value.trim() : "",
        lead: leadInput ? leadInput.value.trim() : "",
        target_release: releaseInput ? releaseInput.value.trim() : "",
        status: statusSelect ? statusSelect.value : "on-track",
        progress_pct: pctInput ? parseInt(pctInput.value, 10) || 0 : 0,
        progress_sp: spInput ? spInput.value.trim() : "",
        blockers_count: blockersInput ? parseInt(blockersInput.value, 10) || 0 : 0,
        tags
      };

      const res = await fetchWithTimeout(`${API_BASE}/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to create project");
      }

      closeProjectModal();
      await renderProjectsPage();
    }
  } catch (err) {
    console.error("Error saving project:", err);
    alert(err.message || "Failed to save project");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Project";
    }
  }
}

/**
 * Toggle Project Archive State
 */
export async function toggleArchiveProject(projectKey, archiveTarget = true) {
  const pkey = projectKey.toUpperCase().trim();
  const endpoint = archiveTarget ? `${API_BASE}/projects/${pkey}/archive` : `${API_BASE}/projects/${pkey}/unarchive`;

  try {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      credentials: "include"
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to toggle archive status");
    }

    await renderProjectsPage();
    if (_currentProjectKey === pkey) {
      openProjectDetailByKey(pkey);
    }
  } catch (err) {
    console.error("Error archiving project:", err);
    alert(err.message || "Failed to update project archive state");
  }
}

/**
 * Open Delete Confirmation Modal
 */
export function openDeleteModal(projectKey, projectName = "") {
  _deletingProjectKey = projectKey.toUpperCase().trim();
  const modal = $("modal-project-delete");
  const title = $("proj-delete-title");
  const keyEl = $("proj-delete-key");

  if (!modal) return;
  if (title) title.textContent = projectName || _deletingProjectKey;
  if (keyEl) keyEl.textContent = _deletingProjectKey;

  modal.style.display = "flex";
}

/**
 * Close Delete Modal
 */
export function closeDeleteModal() {
  const modal = $("modal-project-delete");
  if (modal) modal.style.display = "none";
  _deletingProjectKey = null;
}

/**
 * Confirm Delete Project
 */
async function handleConfirmDelete() {
  if (!_deletingProjectKey) return;
  const pkey = _deletingProjectKey;
  const btn = $("btn-confirm-proj-del");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Deleting...";
  }

  try {
    const res = await fetchWithTimeout(`${API_BASE}/projects/${pkey}`, {
      method: "DELETE",
      credentials: "include"
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to delete project");
    }

    closeDeleteModal();
    await renderProjectsPage();

    // If currently in detail view of deleted project, navigate back to list
    if (window.location.hash.includes(pkey)) {
      window.location.hash = "projects";
    }
  } catch (err) {
    console.error("Error deleting project:", err);
    alert(err.message || "Failed to delete project");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Delete Permanently";
    }
  }
}

/**
 * Initialize all projects events (toolbar, filter pills, modals, RACI).
 */
export function initProjectsEvents() {
  // Add Project Button (Main header)
  $("btn-add-project-main")?.addEventListener("click", () => openProjectModal(null));
  window.addEventListener("open-add-project-modal", () => openProjectModal(null));

  // Modal Add/Edit buttons
  $("btn-cancel-proj-modal")?.addEventListener("click", closeProjectModal);
  $("btn-close-proj-modal")?.addEventListener("click", closeProjectModal);
  $("btn-save-proj-modal")?.addEventListener("click", handleSaveProjectModal);

  // Modal Delete buttons
  $("btn-cancel-proj-del")?.addEventListener("click", closeDeleteModal);
  $("btn-close-proj-del")?.addEventListener("click", closeDeleteModal);
  $("btn-confirm-proj-del")?.addEventListener("click", handleConfirmDelete);

  // Detail View Header Buttons
  $("btn-edit-project")?.addEventListener("click", () => {
    if (_currentProjectObj) {
      openProjectModal(_currentProjectObj);
    }
  });

  $("btn-archive-project")?.addEventListener("click", () => {
    if (_currentProjectObj) {
      const isArchived = Boolean(_currentProjectObj.archived);
      toggleArchiveProject(_currentProjectObj.key, !isArchived);
    }
  });

  $("btn-delete-project")?.addEventListener("click", () => {
    if (_currentProjectObj) {
      openDeleteModal(_currentProjectObj.key, _currentProjectObj.name);
    }
  });

  $("btn-view-project-dashboard")?.addEventListener("click", () => {
    if (_currentProjectObj && _currentProjectObj.key) {
      window.location.hash = `dashboards/${_currentProjectObj.key}`;
    } else {
      window.location.hash = "dashboards";
    }
  });

  // Filter pills
  document.querySelectorAll("#project-filter-pills .filter-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll("#project-filter-pills .filter-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      _activeFilter = pill.dataset.filter || "all";
      applyProjectFilters();
    });
  });

  // Search input
  const searchInput = $("project-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      _searchQuery = e.target.value;
      applyProjectFilters();
    });
  }

  // RACI Matrix editor events
  $("btn-edit-proj-stakeholders")?.addEventListener("click", openProjectStakeholdersEditor);
  $("btn-cancel-proj-sh")?.addEventListener("click", () => {
    const editContainer = $("pd-stakeholders-edit-container");
    const viewContainer = $("pd-stakeholders-view-container");
    const btnEditTop = $("btn-edit-proj-stakeholders");
    if (editContainer) editContainer.style.display = "none";
    if (viewContainer) viewContainer.style.display = "grid";
    if (btnEditTop) btnEditTop.style.display = "inline-flex";
    renderProjectStakeholdersView();
  });
  $("btn-save-proj-sh")?.addEventListener("click", handleSaveProjectStakeholders);
  $("btn-pd-add-sh-item")?.addEventListener("click", handleAddStakeholderToProject);

  // RACI Search input
  const shSearchInput = $("pd-input-search-sh");
  const shDropdown = $("pd-sh-search-dropdown");

  if (shSearchInput && shDropdown) {
    shSearchInput.addEventListener("focus", () => {
      renderSearchableRoleDropdown(shSearchInput.value);
      shDropdown.style.display = "block";
    });

    shSearchInput.addEventListener("input", () => {
      _selectedStakeholderToAssignId = null;
      renderSearchableRoleDropdown(shSearchInput.value);
      shDropdown.style.display = "block";
    });

    shSearchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddStakeholderToProject();
      }
    });

    document.addEventListener("click", (e) => {
      if (!shSearchInput.contains(e.target) && !shDropdown.contains(e.target)) {
        shDropdown.style.display = "none";
      }
    });
  }
}
