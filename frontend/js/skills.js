/**
 * skills.js — Client-side skill runner and settings manager.
 * Provides callSkill(), loadSettings(), saveSettings(), report profiles, and rendering helpers.
 */

import { API_BASE } from "./state.js";
import { fetchWithTimeout } from "./api.js";
import { escapeHtml } from "./utils.js";

// ---------------------------------------------------------------------------
// Settings & Profile helpers (GET/POST /settings, /settings/reset)
// ---------------------------------------------------------------------------

let _cachedSettings = null;
let _paEventsBound = false;

export async function loadSettings() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/settings`, { credentials: "include" }, 10000);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _cachedSettings = await res.json();
    return _cachedSettings;
  } catch (e) {
    console.warn("Could not load AI settings:", e);
    return {
      active_profile_id: "default-exec",
      profiles: [
        {
          id: "default-exec",
          name: "Executive Briefing (Default)",
          is_default: true,
          stakeholder: "executive",
          focus_teams: [],
          focus_epics: [],
          risk_categories: ["dependency", "velocity", "overcommitment"],
          min_risk_severity: "medium",
          summary_verbosity: "brief",
          custom_instructions: "Provide a high-level executive briefing focusing on milestone delivery dates, major schedule risks, and key strategic decisions required.",
        }
      ],
      stakeholder: "executive",
      focus_teams: [],
      focus_epics: [],
      risk_categories: ["dependency", "velocity", "overcommitment"],
      min_risk_severity: "medium",
      summary_verbosity: "brief",
      custom_instructions: "",
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
  _cachedSettings = await res.json();
  return _cachedSettings;
}

export async function resetSettings() {
  const res = await fetchWithTimeout(`${API_BASE}/settings/reset`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  }, 10000);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  _cachedSettings = await res.json();
  return _cachedSettings;
}

// ---------------------------------------------------------------------------
// Core skill caller
// ---------------------------------------------------------------------------

export async function callSkill(skillName, extraPayload = {}) {
  const currentForm = readPaSettingsForm();
  const payload = {
    profile_id: currentForm.template_id || "default-exec", // Fallback for skills expecting profile_id
    template_id: currentForm.template_id,
    custom_instructions: currentForm.stakeholder_notes,
    settings_override: currentForm,
    ...extraPayload,
  };

  const res = await fetchWithTimeout(`${API_BASE}/skills/${skillName}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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

export async function analyzeStatus(extraPayload = {}) {
  return callSkill("analyze-status", extraPayload);
}

export async function proposeNextSteps(extraPayload = {}) {
  return callSkill("propose-next-steps", extraPayload);
}

export async function generateReport(extraPayload = {}) {
  return callSkill("generate-report", extraPayload);
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function _generateReportMarkdown(data) {
  let md = `# ${data.title || "Executive Program Status Report"}\n\n`;
  md += `**Overall Status:** ${(data.overall_status || "").toUpperCase()}\n`;
  if (data.profile_used) md += `**Profile:** ${data.profile_used}\n`;
  if (data.generated_at) md += `**Generated:** ${data.generated_at}\n\n`;
  if (data.settings_applied?.custom_instructions) {
    md += `> **Custom Instructions Applied:** ${data.settings_applied.custom_instructions}\n\n`;
  }
  if (data.executive_summary) md += `## Executive Summary\n${data.executive_summary}\n\n`;
  if (data.milestones && data.milestones.length) {
    md += `## Milestones\n`;
    data.milestones.forEach(m => {
      md += `- **${m.name}** [${(m.status || '').toUpperCase()}]: ${m.progress || ''} (${m.forecast || ''}) — ${m.details || ''}\n`;
    });
    md += `\n`;
  }
  if (data.key_risks && data.key_risks.length) {
    md += `## Key Risks & Mitigations\n`;
    data.key_risks.forEach(r => {
      md += `- **[${(r.severity || '').toUpperCase()}] ${r.title}**: ${r.impact || ''} (Mitigation: ${r.mitigation || ''})\n`;
    });
    md += `\n`;
  }
  if (data.recommendations && data.recommendations.length) {
    md += `## Recommended Actions\n`;
    data.recommendations.forEach(rec => {
      md += `- **[${rec.priority || 'P1'}] ${rec.title}** (${rec.owner || 'TPM'}): ${rec.action || rec.rationale || ''}\n`;
    });
    md += `\n`;
  }
  return md;
}

function _buildGenerateReportHtml(data) {
  const title = data.title || "Executive Program Status Report";
  const summary = data.executive_summary || data.summary || "";
  const overallStatus = (data.overall_status || "on_track").toLowerCase();
  const healthScore = data.program_health_score || "";
  const milestones = data.milestones || [];
  const risks = data.key_risks || data.risks || [];
  const velocity = data.velocity_and_capacity || {};
  const recs = data.recommendations || data.actions || [];
  const generatedAt = data.generated_at ? new Date(data.generated_at).toLocaleString() : "";
  const profileName = data.profile_used || data.settings_applied?.profile_name || "";
  const customInst = data.settings_applied?.custom_instructions || "";

  const sevIcon = s => s === "high" || s === "critical" ? "🔴" : s === "medium" ? "🟡" : "🟢";
  const pClass = p => p === "P1" ? "priority-p1" : p === "P2" ? "priority-p2" : "priority-p3";
  const statusClass = overallStatus.replace(" ", "_");

  const milestoneRows = milestones.map(m => `
    <div class="skill-item">
      <div class="skill-item-title">
        <strong>${escapeHtml(m.name || "")}</strong>
        <span class="badge ${escapeHtml(m.status || "on_track")}" style="margin-left:8px; font-size:11px; padding:2px 8px;">${escapeHtml((m.status || "").replace("_", " "))}</span>
      </div>
      <div class="skill-item-meta">${escapeHtml(m.progress || "")} ${m.forecast ? `· 📅 ${escapeHtml(m.forecast)}` : ""}</div>
      ${m.details ? `<div class="skill-item-body">${escapeHtml(m.details)}</div>` : ""}
    </div>`).join("");

  const riskRows = risks.map(r => `
    <div class="skill-item skill-item--${escapeHtml(r.severity || "low")}">
      <div class="skill-item-title">${sevIcon(r.severity)} <strong>${escapeHtml(r.title || "")}</strong></div>
      <div class="skill-item-meta">${escapeHtml(r.area || "")} ${r.impact ? `— ${escapeHtml(r.impact)}` : ""}</div>
      <div class="skill-item-body">💡 ${escapeHtml(r.mitigation || "")}</div>
    </div>`).join("");

  const recRows = recs.map(rec => `
    <div class="skill-item">
      <div class="skill-item-title">
        <span class="skill-priority ${pClass(rec.priority)}">${escapeHtml(rec.priority || "P1")}</span>
        <strong>${escapeHtml(rec.title || "")}</strong>
      </div>
      ${rec.owner ? `<div class="skill-item-meta">👤 ${escapeHtml(rec.owner)}</div>` : ""}
      <div class="skill-item-body">${escapeHtml(rec.action || rec.rationale || "")}</div>
    </div>`).join("");

  return `
    <div class="pa-result-header">
      <span class="pa-result-icon">📑</span>
      <div style="flex:1">
        <div class="pa-result-title">
          ${escapeHtml(title)}
          <span class="pa-report-status-badge ${statusClass}">${escapeHtml(overallStatus.replace("_", " "))}</span>
        </div>
        <div class="skill-item-meta" style="margin-bottom:6px">
          ${profileName ? `📋 Profile: <strong>${escapeHtml(profileName)}</strong> · ` : ""}
          ${generatedAt ? `Generated: ${escapeHtml(generatedAt)}` : ""}
        </div>
        ${customInst ? `<div class="skill-item-meta" style="color:var(--accent); margin-bottom:8px">✏️ <em>Applied Custom Focus: "${escapeHtml(customInst)}"</em></div>` : ""}
        ${summary ? `<p class="skill-summary" style="margin-top:6px">${escapeHtml(summary)}</p>` : ""}
      </div>
      <div class="pa-report-actions">
        <button id="pa-copy-report-btn" class="pa-copy-btn" title="Copy report as markdown text">📋 Copy Markdown</button>
      </div>
    </div>

    <div class="report-kpi-strip">
      <div class="report-kpi-box">
        <div class="report-kpi-label">Program Health</div>
        <div class="report-kpi-val">${escapeHtml(healthScore || (overallStatus === "on_track" ? "Good (8.5/10)" : "Attention (7.0/10)"))}</div>
      </div>
      <div class="report-kpi-box">
        <div class="report-kpi-label">Predictability</div>
        <div class="report-kpi-val">${escapeHtml(velocity.predictability || "Stable")}</div>
      </div>
      <div class="report-kpi-box">
        <div class="report-kpi-label">Capacity Drag</div>
        <div class="report-kpi-val">${escapeHtml(velocity.capacity_drag || "Nominal")}</div>
      </div>
    </div>

    ${milestones.length ? `<div class="report-section"><h4 class="skill-section-title">Milestone Progress &amp; Delivery (${milestones.length})</h4>${milestoneRows}</div>` : ""}
    ${risks.length ? `<div class="report-section"><h4 class="skill-section-title">Critical Program Risks (${risks.length})</h4>${riskRows}</div>` : ""}
    ${recs.length ? `<div class="report-section"><h4 class="skill-section-title">Strategic Action Items (${recs.length})</h4>${recRows}</div>` : ""}
  `;
}

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

/** Render Generate Report into the floating panel (non-tab context). */
export function renderGenerateReport(data) {
  const panel = document.getElementById("skill-output-panel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="skill-output-header">
      <span class="skill-output-label">📑 Generate Report</span>
      <button class="skill-output-close" id="skill-output-close">✕</button>
    </div>
    <div class="skill-output-body">${_buildGenerateReportHtml(data)}</div>`;
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

export function renderGenerateReportInTab(data) {
  _showTabResult(_buildGenerateReportHtml(data));
  const copyBtn = document.getElementById("pa-copy-report-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const text = _generateReportMarkdown(data);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = "✓ Copied Markdown!";
          setTimeout(() => { copyBtn.textContent = "📋 Copy Markdown"; }, 2000);
        }).catch(() => {
          copyBtn.textContent = "Error copying";
        });
      }
    });
  }
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
// Settings Drawer (global)
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
// Project Assistant tab — Report Profiles & Settings Management
// ---------------------------------------------------------------------------

let _cachedReports = null;
let _cachedStakeholders = null;
let _selectedStakeholders = [];

export async function populatePaSettings() {
  try {
    const [reportsRes, stakeholdersRes] = await Promise.all([
      fetchWithTimeout(`${API_BASE}/reports`, { credentials: "include" }),
      fetchWithTimeout(`${API_BASE}/stakeholders`, { credentials: "include" })
    ]);
    
    _cachedReports = reportsRes.ok ? await reportsRes.json() : { templates: [] };
    _cachedStakeholders = stakeholdersRes.ok ? await stakeholdersRes.json() : { stakeholders: [] };
    
    _renderReportDropdown(_cachedReports);
    _renderStakeholderDropdown(_cachedStakeholders);
    _applyActiveReportToForm();
    _bindPaSettingsEvents();
  } catch (e) {
    console.error("Failed to load reports or stakeholders:", e);
  }
}

function _renderReportDropdown(data) {
  const select = document.getElementById("pa-report-select");
  if (!select) return;
  select.innerHTML = "";
  
  const templates = data.templates || [];
  templates.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name + (t.is_default ? " ⭐" : "");
    select.appendChild(opt);
  });
  
  // Add Composer Option
  const sep = document.createElement("option");
  sep.disabled = true;
  sep.textContent = "────────────────────";
  select.appendChild(sep);
  
  const composerOpt = document.createElement("option");
  composerOpt.value = "__composer__";
  composerOpt.textContent = "🛠️ Report Composer (Create / Edit Report)";
  select.appendChild(composerOpt);
}

function _renderStakeholderDropdown(data) {
  const select = document.getElementById("pa-add-stakeholder-select");
  if (!select) return;
  select.innerHTML = "";
  
  const stakeholders = data.stakeholders || [];
  stakeholders.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name;
    select.appendChild(opt);
  });
}

function _renderStakeholderChips() {
  const container = document.getElementById("pa-stakeholder-chips");
  if (!container) return;
  container.innerHTML = "";
  
  _selectedStakeholders.forEach(sId => {
    const sh = (_cachedStakeholders?.stakeholders || []).find(s => s.id === sId);
    if (!sh) return;
    const chip = document.createElement("div");
    chip.className = "pa-stakeholder-chip";
    chip.innerHTML = `<span>${escapeHtml(sh.name)}</span><button data-id="${sId}">✕</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      _selectedStakeholders = _selectedStakeholders.filter(id => id !== sId);
      _renderStakeholderChips();
    });
    container.appendChild(chip);
  });
}

const AVAILABLE_BLOCKS = [
  { id: "exec_summary", type: "executive_summary", title: "Executive AI Summary", hasChart: false },
  { id: "health_kpis", type: "health_kpis", title: "KPI Health", hasChart: false },
  { id: "burndown", type: "burndown", title: "Burndown & Velocity", hasChart: true },
  { id: "monte_carlo", type: "monte_carlo", title: "Monte Carlo Throughput Forecast", hasChart: true },
  { id: "dependency_matrix", type: "dependency_matrix", title: "Team Dependencies Matrix", hasChart: true },
  { id: "quality_defects", type: "quality_defects", title: "Defect Ratio by Team", hasChart: true },
  { id: "action_plan", type: "action_plan", title: "P1-P3 Action Plan", hasChart: false }
];

function _renderComposerBlocks(existingBlocks = []) {
  const container = document.getElementById("pa-composer-blocks-grid");
  if (!container) return;
  container.innerHTML = "";

  AVAILABLE_BLOCKS.forEach(blockDef => {
    let existing = existingBlocks.find(b => b.block_type === blockDef.type);
    if (!existing) {
      existing = {
        id: `${blockDef.id}_${Date.now()}`,
        block_type: blockDef.type,
        title: blockDef.title,
        enabled: true,
        pm_commentary: "",
        chart_prompt: ""
      };
      existingBlocks.push(existing);
    }
    
    const isEnabled = existing.enabled !== false;
    
    const card = document.createElement("div");
    card.className = "pa-composer-block-card";
    card.dataset.blockType = blockDef.type;
    card.dataset.blockId = existing.id;
    
    let chartPreviewHtml = "";
    if (blockDef.hasChart) {
      chartPreviewHtml = `
        <div class="pa-composer-chart-preview" style="background:var(--surface-2); padding:12px; border-radius:6px; font-size:12px; color:var(--text-dim); text-align:center; border:1px dashed var(--border);">
          <span>[${blockDef.title} Visualization Placeholder]</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="pa-composer-block-header">
        <span>${blockDef.title}</span>
        <label class="toggle-switch">
          <input type="checkbox" class="block-enable-toggle" ${isEnabled ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      </div>
      ${chartPreviewHtml}
      <div class="pa-composer-block-fields" style="display:flex; flex-direction:column; gap:8px;">
        <textarea class="settings-textarea block-pm-note" rows="2" placeholder="PM Commentary (Human note to display under chart)">${escapeHtml(existing.pm_commentary || "")}</textarea>
        <textarea class="settings-textarea block-chart-prompt" rows="2" placeholder="Chart AI Prompt (Custom instructions for AI on this chart)">${escapeHtml(existing.chart_prompt || "")}</textarea>
      </div>
    `;
    
    // Bind input events to update the underlying state so it survives re-renders
    const toggle = card.querySelector(".block-enable-toggle");
    toggle.addEventListener("change", () => {
      existing.enabled = toggle.checked;
      _renderComposerBlocks(existingBlocks); // Re-render to show/hide sections if needed
    });

    const pmNote = card.querySelector(".block-pm-note");
    const chartPrompt = card.querySelector(".block-chart-prompt");
    pmNote.addEventListener("input", e => existing.pm_commentary = e.target.value);
    chartPrompt.addEventListener("input", e => existing.chart_prompt = e.target.value);

    container.appendChild(card);
  });
}

function _applyActiveReportToForm() {
  const select = document.getElementById("pa-report-select");
  if (!select) return;
  const activeId = select.value;
  
  const composerBtn = document.getElementById("pa-btn-edit-composer");
  const composerView = document.getElementById("pa-composer-view");
  const generateFooter = document.getElementById("pa-generate-footer");
  
  if (activeId === "__composer__") {
    if (composerBtn) composerBtn.style.display = "none";
    if (generateFooter) generateFooter.style.display = "none";
    if (composerView) composerView.style.display = "block";
    
    // Clear composer fields for new report
    _setVal("pa-composer-name", "");
    _setVal("pa-composer-desc", "");
    _renderComposerBlocks([]);
  } else {
    if (composerBtn) composerBtn.style.display = "block";
    if (generateFooter) generateFooter.style.display = "block";
    if (composerView) composerView.style.display = "none";
    
    const template = (_cachedReports?.templates || []).find(t => t.id === activeId);
    if (template) {
      _selectedStakeholders = [...(template.stakeholder_ids || [])];
      _setVal("pa-stakeholder-notes", template.stakeholder_notes || "");
      _renderStakeholderChips();
    }
  }
}

export function readPaSettingsForm() {
  const select = document.getElementById("pa-report-select");
  const templateId = select ? select.value : null;
  const stakeholderNotes = document.getElementById("pa-stakeholder-notes")?.value || "";
  
  const blocks = [];
  document.querySelectorAll(".pa-composer-block-card").forEach((card, index) => {
    const isEnabled = card.querySelector(".block-enable-toggle").checked;
    if (isEnabled) {
      blocks.push({
        id: card.dataset.blockId,
        block_type: card.dataset.blockType,
        title: card.querySelector(".pa-composer-block-header span").textContent,
        enabled: true,
        order: index + 1,
        pm_commentary: card.querySelector(".block-pm-note").value.trim(),
        chart_prompt: card.querySelector(".block-chart-prompt").value.trim(),
        config: {}
      });
    }
  });

  return {
    template_id: templateId === "__composer__" ? "custom" : templateId,
    name: document.getElementById("pa-composer-name")?.value || "Custom Report",
    description: document.getElementById("pa-composer-desc")?.value || "",
    stakeholder_ids: _selectedStakeholders,
    stakeholder_notes: stakeholderNotes,
    blocks: blocks
  };
}



function _bindPaSettingsEvents() {
  if (_paEventsBound) return;
  _paEventsBound = true;

  const select = document.getElementById("pa-report-select");
  if (select) {
    select.addEventListener("change", _applyActiveReportToForm);
  }
  
  const editBtn = document.getElementById("pa-btn-edit-composer");
  if (editBtn && select) {
    editBtn.addEventListener("click", () => {
      select.value = "__composer__";
      _applyActiveReportToForm();
      const currentId = (_cachedReports?.templates || []).find(t => t.id === select.options[select.selectedIndex - 2]?.value)?.id; // approximate previous
      if (currentId) {
         const t = _cachedReports.templates.find(x => x.id === currentId);
         if (t) {
             _setVal("pa-composer-name", t.name + " (Copy)");
             _setVal("pa-composer-desc", t.description || "");
         }
      }
    });
  }
  
  const addShBtn = document.getElementById("pa-btn-add-stakeholder");
  const shSelect = document.getElementById("pa-add-stakeholder-select");
  if (addShBtn && shSelect) {
    addShBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const sId = shSelect.value;
      if (!sId) return;
      if (_selectedStakeholders.includes(sId)) {
        // Provide visual feedback that it's already added
        const originalText = addShBtn.textContent;
        addShBtn.textContent = "Already Added!";
        addShBtn.style.color = "var(--red)";
        setTimeout(() => { 
          addShBtn.textContent = originalText; 
          addShBtn.style.color = "";
        }, 1500);
      } else {
        _selectedStakeholders.push(sId);
        _renderStakeholderChips();
      }
    });
  }
  
  const cancelComposer = document.getElementById("pa-btn-composer-cancel");
  if (cancelComposer && select) {
    cancelComposer.addEventListener("click", () => {
      select.selectedIndex = 0;
      _applyActiveReportToForm();
    });
  }
}

export async function saveComposerTemplate() {
  const form = readPaSettingsForm();
  
  if (!_cachedReports) {
      _cachedReports = { templates: [] };
  }
  if (!_cachedReports.templates) {
      _cachedReports.templates = [];
  }
  
  const newTemplate = {
      name: form.name,
      description: form.description,
      stakeholder_ids: form.stakeholder_ids,
      stakeholder_notes: form.stakeholder_notes,
      blocks: form.blocks || [],
      is_default: false
  };
  
  _cachedReports.templates.push(newTemplate);
  
  const res = await fetchWithTimeout(`${API_BASE}/reports`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(_cachedReports),
  }, 10000);
  
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  
  const savedData = await res.json();
  _cachedReports = savedData.data || savedData;
  _renderReportDropdown(_cachedReports);
  
  // Select the newly saved template (it should be the last one before the separator)
  const select = document.getElementById("pa-report-select");
  if (select && _cachedReports.templates.length > 0) {
      const lastSavedId = _cachedReports.templates[_cachedReports.templates.length - 1].id;
      select.value = lastSavedId;
      _applyActiveReportToForm();
  }
}

function _showSaveMsg(msg, isErr = false) {
  const el = document.getElementById("pa-composer-msg");
  if (!el) return;
  el.textContent = msg;
  el.className = isErr ? "settings-save-msg settings-save-msg--err" : "settings-save-msg settings-save-msg--ok";
  if (!isErr) setTimeout(() => { el.textContent = ""; }, 2500);
}
