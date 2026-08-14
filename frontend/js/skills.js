/**
 * skills.js — Client-side skill runner and settings manager.
 * Provides callSkill(), loadSettings(), saveSettings(), and rendering helpers.
 */

import { API_BASE } from "./state.js";
import { fetchWithTimeout } from "./api.js";
import { escapeHtml } from "./utils.js";

// ---------------------------------------------------------------------------
// Settings helpers (GET/POST /settings)
// ---------------------------------------------------------------------------

export async function loadSettings() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/settings`, { credentials: "include" }, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn("Could not load AI settings:", e);
    return {
      stakeholder: "program_manager",
      focus_teams: [],
      focus_epics: [],
      risk_categories: ["dependency", "velocity", "overcommitment"],
      min_risk_severity: "medium",
      summary_verbosity: "brief",
    };
  }
}

export async function saveSettings(settings) {
  const res = await fetchWithTimeout(`${API_BASE}/settings`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return await res.json();
}

// ---------------------------------------------------------------------------
// Core skill caller
// ---------------------------------------------------------------------------

export async function callSkill(skillName, extraPayload = {}) {
  const res = await fetchWithTimeout(`${API_BASE}/skills/${skillName}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(extraPayload),
  }, 90000); // skills may take a while
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return await res.json();
}

// ---------------------------------------------------------------------------
// Skill-specific callers
// ---------------------------------------------------------------------------

export async function analyzeStatus() {
  return callSkill("analyze-status");
}

export async function proposeNextSteps() {
  return callSkill("propose-next-steps");
}

// ---------------------------------------------------------------------------
// Rendering helpers (floating panel — kept for chat context)
// ---------------------------------------------------------------------------

function _buildAnalyzeStatusHtml(data) {
  const summary = data.summary || "";
  const delays = data.delays || [];
  const risks = data.risks || [];
  const forecast = data.forecast_summary || data.program_health || "";
  const sevIcon = s => s === "high" ? "🔴" : s === "medium" ? "🟡" : "🟢";

  const delayRows = delays.map(d => `
    <div class="skill-item">
      <div class="skill-item-title">📌 <strong>${escapeHtml(d.area || "")}</strong></div>
      <div class="skill-item-body">${escapeHtml(d.description || "")}</div>
      ${d.predictive_completion
        ? `<div class="skill-item-meta">📅 Forecast: ${escapeHtml(d.predictive_completion)} <span class="skill-confidence">(${escapeHtml(d.confidence || "")})</span></div>`
        : ""}
    </div>`).join("");

  const riskRows = risks.map(r => `
    <div class="skill-item skill-item--${escapeHtml(r.severity || "low")}">
      <div class="skill-item-title">${sevIcon(r.severity)} <strong>${escapeHtml(r.title || "")}</strong></div>
      <div class="skill-item-meta">${escapeHtml(r.area || "")} — ${escapeHtml(r.evidence || "")}</div>
      <div class="skill-item-body">💡 ${escapeHtml(r.mitigation || "")}</div>
    </div>`).join("");

  return `
    <div class="pa-result-header">
      <span class="pa-result-icon">🔍</span>
      <div>
        <div class="pa-result-title">Analyze Status</div>
        ${summary ? `<p class="skill-summary">${escapeHtml(summary)}</p>` : ""}
        ${forecast ? `<p class="skill-forecast">📊 ${escapeHtml(forecast)}</p>` : ""}
      </div>
    </div>
    ${delays.length ? `<h4 class="skill-section-title">Delays (${delays.length})</h4>${delayRows}` : ""}
    ${risks.length ? `<h4 class="skill-section-title">Risks &amp; Mitigations (${risks.length})</h4>${riskRows}` : ""}
    ${!delays.length && !risks.length
      ? `<p class="skill-empty">✅ No delays or risks found with your current settings.</p>` : ""}`;
}

function _buildNextStepsHtml(data) {
  const actions = data.actions || [];
  const summary = data.summary || "";
  const pClass = p => p === "P1" ? "priority-p1" : p === "P2" ? "priority-p2" : "priority-p3";

  const actionRows = actions.map(a => `
    <div class="skill-item">
      <div class="skill-item-title">
        <span class="skill-priority ${pClass(a.priority)}">${escapeHtml(a.priority || "")}</span>
        <strong>${escapeHtml(a.title || "")}</strong>
      </div>
      ${a.owner ? `<div class="skill-item-meta">👤 ${escapeHtml(a.owner)}</div>` : ""}
      <div class="skill-item-body">${escapeHtml(a.rationale || "")}</div>
    </div>`).join("");

  return `
    <div class="pa-result-header">
      <span class="pa-result-icon">▶</span>
      <div>
        <div class="pa-result-title">Proposed Next Steps</div>
        ${summary ? `<p class="skill-summary">${escapeHtml(summary)}</p>` : ""}
      </div>
    </div>
    ${actionRows || `<p class="skill-empty">No actions generated with your current settings.</p>`}`;
}

/** Render Analyze Status into the floating panel (non-tab context). */
export function renderAnalyzeStatus(data) {
  const panel = document.getElementById("skill-output-panel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="skill-output-header">
      <span class="skill-output-label">🔍 Analyze Status</span>
      <button class="skill-output-close" id="skill-output-close">✕</button>
    </div>
    <div class="skill-output-body">${_buildAnalyzeStatusHtml(data)}</div>`;
  panel.classList.add("visible");
  _wireClose();
}

/** Render Next Steps into the floating panel (non-tab context). */
export function renderProposeNextSteps(data) {
  const panel = document.getElementById("skill-output-panel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="skill-output-header">
      <span class="skill-output-label">▶ Next Steps</span>
      <button class="skill-output-close" id="skill-output-close">✕</button>
    </div>
    <div class="skill-output-body">${_buildNextStepsHtml(data)}</div>`;
  panel.classList.add("visible");
  _wireClose();
}

function _wireClose() {
  const btn = document.getElementById("skill-output-close");
  if (btn) btn.addEventListener("click", () => {
    const panel = document.getElementById("skill-output-panel");
    if (panel) panel.classList.remove("visible");
  });
}

// ---------------------------------------------------------------------------
// Project Assistant tab — inline result renderer
// ---------------------------------------------------------------------------

export function renderAnalyzeStatusInTab(data) {
  _showTabResult(_buildAnalyzeStatusHtml(data));
}

export function renderNextStepsInTab(data) {
  _showTabResult(_buildNextStepsHtml(data));
}

function _showTabResult(html) {
  const placeholder = document.getElementById("pa-placeholder");
  const content = document.getElementById("pa-results-content");
  const results = document.getElementById("pa-results");
  if (!content || !results) return;
  if (placeholder) placeholder.style.display = "none";
  content.innerHTML = html;
  content.style.display = "block";
  results.classList.remove("pa-results--empty");
  content.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------------------------------------------------------------------------
// Settings Drawer (global — kept for other tabs)
// ---------------------------------------------------------------------------

export async function openSettingsDrawer() {
  const drawer = document.getElementById("settings-drawer");
  const overlay = document.getElementById("settings-drawer-overlay");
  if (!drawer) return;
  const settings = await loadSettings();
  _populateSettingsForm(settings);
  drawer.classList.add("open");
  if (overlay) overlay.classList.add("visible");
}

export function closeSettingsDrawer() {
  const drawer = document.getElementById("settings-drawer");
  const overlay = document.getElementById("settings-drawer-overlay");
  if (drawer) drawer.classList.remove("open");
  if (overlay) overlay.classList.remove("visible");
}

function _populateSettingsForm(settings) {
  _setVal("settings-stakeholder", settings.stakeholder || "program_manager");
  _setVal("settings-min-severity", settings.min_risk_severity || "medium");
  _setVal("settings-verbosity", settings.summary_verbosity || "brief");
  const t = document.getElementById("settings-focus-teams");
  if (t) t.value = (settings.focus_teams || []).join(", ");
  const e = document.getElementById("settings-focus-epics");
  if (e) e.value = (settings.focus_epics || []).join(", ");
  const cats = settings.risk_categories || ["dependency", "velocity", "overcommitment"];
  ["dependency", "velocity", "overcommitment"].forEach(cat => {
    const cb = document.getElementById(`settings-risk-${cat}`);
    if (cb) cb.checked = cats.includes(cat);
  });
}

function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

export function readSettingsForm() {
  const teamsRaw = (document.getElementById("settings-focus-teams")?.value || "").trim();
  const epicsRaw = (document.getElementById("settings-focus-epics")?.value || "").trim();
  const cats = ["dependency", "velocity", "overcommitment"].filter(cat => {
    const cb = document.getElementById(`settings-risk-${cat}`);
    return cb && cb.checked;
  });
  return {
    stakeholder: document.getElementById("settings-stakeholder")?.value || "program_manager",
    focus_teams: teamsRaw ? teamsRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
    focus_epics: epicsRaw ? epicsRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
    risk_categories: cats.length ? cats : ["dependency", "velocity", "overcommitment"],
    min_risk_severity: document.getElementById("settings-min-severity")?.value || "medium",
    summary_verbosity: document.getElementById("settings-verbosity")?.value || "brief",
  };
}

// ---------------------------------------------------------------------------
// Project Assistant tab — embedded settings panel helpers
// ---------------------------------------------------------------------------

export async function populatePaSettings() {
  const settings = await loadSettings();
  _setVal("pa-stakeholder", settings.stakeholder || "program_manager");
  _setVal("pa-min-severity", settings.min_risk_severity || "medium");
  _setVal("pa-verbosity", settings.summary_verbosity || "brief");
  const t = document.getElementById("pa-focus-teams");
  if (t) t.value = (settings.focus_teams || []).join(", ");
  const e = document.getElementById("pa-focus-epics");
  if (e) e.value = (settings.focus_epics || []).join(", ");
  const cats = settings.risk_categories || ["dependency", "velocity", "overcommitment"];
  ["dependency", "velocity", "overcommitment"].forEach(cat => {
    const cb = document.getElementById(`pa-risk-${cat}`);
    if (cb) cb.checked = cats.includes(cat);
  });
}

export function readPaSettingsForm() {
  const teamsRaw = (document.getElementById("pa-focus-teams")?.value || "").trim();
  const epicsRaw = (document.getElementById("pa-focus-epics")?.value || "").trim();
  const cats = ["dependency", "velocity", "overcommitment"].filter(cat => {
    const cb = document.getElementById(`pa-risk-${cat}`);
    return cb && cb.checked;
  });
  return {
    stakeholder: document.getElementById("pa-stakeholder")?.value || "program_manager",
    focus_teams: teamsRaw ? teamsRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
    focus_epics: epicsRaw ? epicsRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
    risk_categories: cats.length ? cats : ["dependency", "velocity", "overcommitment"],
    min_risk_severity: document.getElementById("pa-min-severity")?.value || "medium",
    summary_verbosity: document.getElementById("pa-verbosity")?.value || "brief",
  };
}
