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
    project_key: state.currentProject || "ALL",
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
      <div class="pa-report-actions" style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
        <button id="pa-copy-report-btn" class="pa-copy-btn" title="Copy report as markdown text">📋 Copy Markdown</button>
        <button id="pa-export-html-btn" class="pa-copy-btn" style="background: var(--surface-2); color: var(--text);" title="Download standalone HTML document">🌐 Export HTML</button>
        <button id="pa-print-deck-btn" class="pa-copy-btn" style="background: var(--surface-2); color: var(--text);" title="Open presentation slide deck view">📊 Slide Deck</button>
        <button id="pa-refresh-report-btn" class="pa-copy-btn" style="background: var(--surface-2); color: var(--text);" title="Refresh this report">🔄 Refresh</button>
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

function _exportReportAsHtml(data) {
  const title = escapeHtml(data.title || "Executive Program Status Report");
  const overallStatus = (data.overall_status || "on_track").toLowerCase();
  const summary = data.executive_summary || data.summary || "";
  const milestones = data.milestones || [];
  const risks = data.key_risks || data.risks || [];
  const recs = data.recommendations || data.actions || [];
  const velocity = data.velocity_and_capacity || {};
  const generatedAt = data.generated_at ? new Date(data.generated_at).toLocaleString() : new Date().toLocaleString();
  const profileName = data.profile_used || data.settings_applied?.profile_name || "Program Report";

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ${profileName}</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --accent: #3b82f6;
      --green: #10b981;
      --yellow: #f59e0b;
      --red: #ef4444;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 40px 20px;
      line-height: 1.5;
    }
    .container { max-width: 960px; margin: 0 auto; }
    .header { border-bottom: 1px solid var(--border); padding-bottom: 24px; margin-bottom: 24px; }
    .title-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 8px; }
    h1 { margin: 0; font-size: 24px; font-weight: 700; color: #fff; }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge.on_track { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge.at_risk { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); }
    .badge.delayed { background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
    .meta { color: var(--muted); font-size: 13px; margin-bottom: 12px; }
    .summary-box { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-top: 12px; font-size: 14px; }
    .kpi-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 24px 0; }
    .kpi-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
    .kpi-label { font-size: 12px; color: var(--muted); text-transform: uppercase; font-weight: 600; margin-bottom: 4px; }
    .kpi-val { font-size: 18px; font-weight: 700; color: #fff; }
    .section { margin-top: 32px; }
    .section-title { font-size: 18px; font-weight: 600; color: #fff; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 16px; }
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    .card-title { font-weight: 600; font-size: 15px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between; }
    .card-meta { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
    .card-body { font-size: 13.5px; color: var(--text); }
    .p-badge { font-size: 11px; font-weight: 700; padding: 2px 6px; border-radius: 4px; margin-right: 6px; }
    .p-P1 { background: rgba(239, 68, 68, 0.2); color: #f87171; }
    .p-P2 { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .p-P3 { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    @media print {
      body { background: #fff; color: #000; padding: 0; }
      .kpi-card, .card, .summary-box { border: 1px solid #ccc; background: #fafafa; color: #000; break-inside: avoid; }
      h1, .section-title, .kpi-val, .card-title { color: #000; }
      .meta, .kpi-label, .card-meta { color: #555; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title-row">
        <h1>${title}</h1>
        <span class="badge ${overallStatus}">${overallStatus.replace("_", " ")}</span>
      </div>
      <div class="meta">Profile: <strong>${escapeHtml(profileName)}</strong> &bull; Generated: ${escapeHtml(generatedAt)}</div>
      ${summary ? `<div class="summary-box"><strong>Executive Summary:</strong><p style="margin: 6px 0 0 0;">${escapeHtml(summary)}</p></div>` : ""}
    </div>

    <div class="kpi-strip">
      <div class="kpi-card">
        <div class="kpi-label">Program Health</div>
        <div class="kpi-val">${escapeHtml(data.program_health_score || (overallStatus === "on_track" ? "Good (8.5/10)" : "Attention (7.0/10)"))}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Predictability</div>
        <div class="kpi-val">${escapeHtml(velocity.predictability || "Stable")}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Capacity Drag</div>
        <div class="kpi-val">${escapeHtml(velocity.capacity_drag || "Nominal")}</div>
      </div>
    </div>

    ${milestones.length ? `
    <div class="section">
      <h2 class="section-title">Milestone Progress & Delivery (${milestones.length})</h2>
      ${milestones.map(m => `
        <div class="card">
          <div class="card-title">
            <span>${escapeHtml(m.name || "")}</span>
            <span class="badge ${escapeHtml(m.status || "on_track")}">${escapeHtml((m.status || "").replace("_", " "))}</span>
          </div>
          <div class="card-meta">${escapeHtml(m.progress || "")} ${m.forecast ? `&bull; Target: ${escapeHtml(m.forecast)}` : ""}</div>
          ${m.details ? `<div class="card-body">${escapeHtml(m.details)}</div>` : ""}
        </div>
      `).join("")}
    </div>` : ""}

    ${risks.length ? `
    <div class="section">
      <h2 class="section-title">Critical Program Risks (${risks.length})</h2>
      ${risks.map(r => `
        <div class="card">
          <div class="card-title">${escapeHtml(r.title || "")}</div>
          <div class="card-meta">Severity: ${(r.severity || "medium").toUpperCase()} &bull; ${escapeHtml(r.area || "")} ${r.impact ? `&bull; Impact: ${escapeHtml(r.impact)}` : ""}</div>
          <div class="card-body"><strong>Mitigation:</strong> ${escapeHtml(r.mitigation || "")}</div>
        </div>
      `).join("")}
    </div>` : ""}

    ${recs.length ? `
    <div class="section">
      <h2 class="section-title">Strategic Action Items (${recs.length})</h2>
      ${recs.map(rec => `
        <div class="card">
          <div class="card-title">
            <span><span class="p-badge p-${escapeHtml(rec.priority || "P1")}">${escapeHtml(rec.priority || "P1")}</span> ${escapeHtml(rec.title || "")}</span>
            ${rec.owner ? `<span class="card-meta">Owner: ${escapeHtml(rec.owner)}</span>` : ""}
          </div>
          <div class="card-body">${escapeHtml(rec.action || rec.rationale || "")}</div>
        </div>
      `).join("")}
    </div>` : ""}
  </div>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = (data.title || "Program_Report").replace(/[^a-zA-Z0-9_-]/g, "_");
  a.download = `${safeName}_${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _openSlideDeckView(data) {
  const printWin = window.open("", "_blank");
  if (!printWin) {
    alert("Please allow popups to open the Slide Deck / Print view.");
    return;
  }
  const title = escapeHtml(data.title || "Executive Program Status Report");
  const overallStatus = (data.overall_status || "on_track").toLowerCase();
  const summary = data.executive_summary || data.summary || "";
  const milestones = data.milestones || [];
  const risks = data.key_risks || data.risks || [];
  const recs = data.recommendations || data.actions || [];
  const generatedAt = data.generated_at ? new Date(data.generated_at).toLocaleString() : new Date().toLocaleString();

  printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>${title} - Slide Deck</title>
  <style>
    @page { size: landscape; margin: 15mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
    .slide { page-break-after: always; min-height: 85vh; display: flex; flex-direction: column; justify-content: center; padding: 40px; border: 1px solid #334155; border-radius: 12px; background: #1e293b; margin-bottom: 24px; }
    .slide-header { font-size: 28px; font-weight: 700; color: #38bdf8; margin-bottom: 20px; border-bottom: 2px solid #334155; padding-bottom: 12px; }
    .slide-body { font-size: 18px; line-height: 1.6; color: #e2e8f0; }
    .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 20px; }
    .kpi-item { background: #0f172a; padding: 20px; border-radius: 8px; border: 1px solid #475569; }
    .kpi-lbl { font-size: 14px; color: #94a3b8; text-transform: uppercase; }
    .kpi-val { font-size: 24px; font-weight: bold; color: #fff; margin-top: 8px; }
    .card-row { background: #0f172a; border: 1px solid #334155; padding: 14px 20px; border-radius: 8px; margin-bottom: 12px; }
    @media print {
      body { background: #fff; color: #000; }
      .slide { background: #fff; border: 1px solid #ccc; color: #000; box-shadow: none; }
      .slide-header { color: #0284c7; border-color: #ccc; }
      .slide-body { color: #000; }
      .kpi-item, .card-row { background: #f8fafc; border-color: #cbd5e1; color: #000; }
      .kpi-val { color: #000; }
    }
  </style>
</head>
<body>
  <div class="slide">
    <div class="slide-header">${title}</div>
    <div class="slide-body">
      <p style="font-size: 20px; color: #94a3b8;">Status: <strong style="color: #38bdf8;">${overallStatus.toUpperCase()}</strong> | Generated: ${generatedAt}</p>
      <div style="background: #0f172a; padding: 20px; border-radius: 8px; border: 1px solid #334155; margin-top: 20px;">
        <h3 style="margin-top: 0; color: #38bdf8;">Executive Summary</h3>
        <p>${escapeHtml(summary)}</p>
      </div>
      <div class="kpi-grid">
        <div class="kpi-item"><div class="kpi-lbl">Health Score</div><div class="kpi-val">${escapeHtml(data.program_health_score || "8.5/10")}</div></div>
        <div class="kpi-item"><div class="kpi-lbl">Predictability</div><div class="kpi-val">${escapeHtml(data.velocity_and_capacity?.predictability || "Stable")}</div></div>
        <div class="kpi-item"><div class="kpi-lbl">Capacity Drag</div><div class="kpi-val">${escapeHtml(data.velocity_and_capacity?.capacity_drag || "Nominal")}</div></div>
      </div>
    </div>
  </div>

  ${milestones.length ? `
  <div class="slide">
    <div class="slide-header">Milestones & Delivery Trajectory</div>
    <div class="slide-body">
      ${milestones.map(m => `
        <div class="card-row">
          <strong style="font-size: 19px;">${escapeHtml(m.name || "")}</strong> — <span>${escapeHtml(m.status || "on_track").toUpperCase()}</span> (${escapeHtml(m.progress || "")})
          <p style="margin: 6px 0 0 0; font-size: 15px; color: #94a3b8;">${escapeHtml(m.details || "")}</p>
        </div>
      `).join("")}
    </div>
  </div>` : ""}

  ${risks.length ? `
  <div class="slide">
    <div class="slide-header">Critical Risks & Mitigations</div>
    <div class="slide-body">
      ${risks.map(r => `
        <div class="card-row">
          <strong style="color: #f87171;">[${(r.severity || "med").toUpperCase()}] ${escapeHtml(r.title || "")}</strong>
          <p style="margin: 6px 0 0 0; font-size: 15px; color: #cbd5e1;">💡 <em>Mitigation:</em> ${escapeHtml(r.mitigation || "")}</p>
        </div>
      `).join("")}
    </div>
  </div>` : ""}

  ${recs.length ? `
  <div class="slide">
    <div class="slide-header">Action Items & Strategic Recommendations</div>
    <div class="slide-body">
      ${recs.map(rec => `
        <div class="card-row">
          <strong style="color: #38bdf8;">[${escapeHtml(rec.priority || "P1")}] ${escapeHtml(rec.title || "")}</strong> (Owner: ${escapeHtml(rec.owner || "TPM")})
          <p style="margin: 6px 0 0 0; font-size: 15px; color: #cbd5e1;">${escapeHtml(rec.action || rec.rationale || "")}</p>
        </div>
      `).join("")}
    </div>
  </div>` : ""}

  <script>
    window.onload = function() { window.print(); };
  <\/script>
</body>
</html>`);
  printWin.document.close();
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

  const exportHtmlBtn = document.getElementById("pa-export-html-btn");
  if (exportHtmlBtn) {
    exportHtmlBtn.addEventListener("click", () => {
      _exportReportAsHtml(data);
    });
  }

  const printDeckBtn = document.getElementById("pa-print-deck-btn");
  if (printDeckBtn) {
    printDeckBtn.addEventListener("click", () => {
      _openSlideDeckView(data);
    });
  }

  const refreshBtn = document.getElementById("pa-refresh-report-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      const generateBtn = document.getElementById("pa-btn-generate-report");
      if (generateBtn) generateBtn.click();
    });
  }
}

function _showTabResult(html) {
  const placeholder = document.getElementById("pa-tab-placeholder") || document.getElementById("pa-placeholder");
  const content = document.getElementById("pa-tab-results-content") || document.getElementById("pa-results-content");
  const results = document.getElementById("pa-tab-results") || document.getElementById("pa-results");
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
// Report Configuration Studio & Management (List View + Detail View)
// ---------------------------------------------------------------------------

export const AVAILABLE_REPORT_BLOCKS = [
  { id: "exec_summary", type: "executive_summary", icon: "📑", title: "Executive AI Summary", desc: "Synthesizes delivery health, critical milestones, and strategic narrative" },
  { id: "health_kpis", type: "health_kpis", icon: "📊", title: "KPI Health Metrics", desc: "Program health score, sprint predictability index, and capacity drag" },
  { id: "burndown", type: "burndown", icon: "🔥", title: "Burndown & Velocity Chart", desc: "Sprint burndown trajectory, planned vs completed story points" },
  { id: "monte_carlo", type: "monte_carlo", icon: "🎲", title: "Monte Carlo Throughput Forecast", desc: "Probabilistic completion dates (P50/P80) and delivery confidence" },
  { id: "dependency_matrix", type: "dependency_matrix", icon: "🔗", title: "Team Dependencies Matrix", desc: "Cross-team blocker analysis, critical path coupling, and upstream risks" },
  { id: "quality_defects", type: "quality_defects", icon: "🧪", title: "Defect Ratio & Quality Breakdown", desc: "Team defect density, bug escape rates, and technical debt" },
  { id: "milestone_timeline", type: "milestone_timeline", icon: "🏁", title: "Milestone Timeline & Targets", desc: "Detailed breakdown of M0–M3 milestones with completion %" },
  { id: "action_plan", type: "action_plan", icon: "🎯", title: "P1-P3 Tactical Action Plan", desc: "Prioritized recommendations with assigned squad and TPM ownership" }
];

const FALLBACK_TEMPLATES = [
  {
    id: "report-pm-weekly",
    name: "Weekly TPM Sprint & Delivery Health",
    description: "Core sprint tracking, velocity, burndown, and cross-team dependencies for weekly scrum of scrums.",
    stakeholder_ids: ["pm-default"],
    stakeholder_notes: "Focus on sprint commitment health and delivery risks.",
    blocks: [
      { id: "health_kpis", block_type: "health_kpis", title: "KPI Health", enabled: true, order: 1 },
      { id: "burndown", block_type: "burndown", title: "Burndown & Velocity", enabled: true, order: 2 },
      { id: "dependency_matrix", block_type: "dependency_matrix", title: "Team Dependencies Matrix", enabled: true, order: 3 },
      { id: "action_plan", block_type: "action_plan", title: "P1-P3 Action Plan", enabled: true, order: 4 }
    ],
    is_default: true
  },
  {
    id: "report-exec-brief",
    name: "Executive Program Status Briefing",
    description: "High-level summary of program health, milestone delivery forecasts, and top cross-team risks for leadership.",
    stakeholder_ids: ["exec-sponsor"],
    stakeholder_notes: "Executive summary focusing on high-level milestones.",
    blocks: [
      { id: "exec_summary", block_type: "executive_summary", title: "Executive AI Summary", enabled: true, order: 1 },
      { id: "health_kpis", block_type: "health_kpis", title: "KPI Health", enabled: true, order: 2 },
      { id: "monte_carlo", block_type: "monte_carlo", title: "Monte Carlo Throughput Forecast", enabled: true, order: 3 },
      { id: "action_plan", block_type: "action_plan", title: "P1-P3 Action Plan", enabled: true, order: 4 }
    ],
    is_default: false
  },
  {
    id: "report-dependency-blocker",
    name: "Cross-Team Dependency & Blocker Matrix",
    description: "Deep dive into squad dependencies, critical path bottlenecks, and inter-team blockers.",
    stakeholder_ids: ["eng-lead-core"],
    stakeholder_notes: "Focus on upstream blockers and squad handoff risks.",
    blocks: [
      { id: "dependency_matrix", block_type: "dependency_matrix", title: "Team Dependencies Matrix", enabled: true, order: 1 },
      { id: "health_kpis", block_type: "health_kpis", title: "KPI Health", enabled: true, order: 2 },
      { id: "action_plan", block_type: "action_plan", title: "P1-P3 Action Plan", enabled: true, order: 3 }
    ],
    is_default: false
  },
  {
    id: "report-squad-quality",
    name: "Squad Quality & Defect Deep-Dive",
    description: "Defect rates, escape ratios, and tech debt across all delivery squads.",
    stakeholder_ids: ["qa-lead"],
    stakeholder_notes: "Focus on defect density and escaped bug resolution.",
    blocks: [
      { id: "quality_defects", block_type: "quality_defects", title: "Defect Ratio by Team", enabled: true, order: 1 },
      { id: "health_kpis", block_type: "health_kpis", title: "KPI Health", enabled: true, order: 2 },
      { id: "action_plan", block_type: "action_plan", title: "P1-P3 Action Plan", enabled: true, order: 3 }
    ],
    is_default: false
  },
  {
    id: "report-milestone-forecast",
    name: "Milestone Delivery & Monte Carlo Forecast",
    description: "Probabilistic forecasts (P50/P80) and target dates for major release milestones.",
    stakeholder_ids: ["exec-sponsor", "po-checkout"],
    stakeholder_notes: "Focus on milestone release dates and confidence intervals.",
    blocks: [
      { id: "monte_carlo", block_type: "monte_carlo", title: "Monte Carlo Throughput Forecast", enabled: true, order: 1 },
      { id: "milestone_timeline", block_type: "milestone_timeline", title: "Milestone Timeline", enabled: true, order: 2 },
      { id: "health_kpis", block_type: "health_kpis", title: "KPI Health", enabled: true, order: 3 },
      { id: "action_plan", block_type: "action_plan", title: "P1-P3 Action Plan", enabled: true, order: 4 }
    ],
    is_default: false
  }
];

const FALLBACK_STAKEHOLDERS = [
  { id: "pm-default", name: "Alex Mercer", role: "Lead Technical Program Manager", role_type: "Technical Program Manager", projects: ["HRZ", "CHK", "CORE", "MOB"] },
  { id: "exec-sponsor", name: "David Kim", role: "VP of Engineering & Executive Sponsor", role_type: "Executive", projects: ["HRZ", "CHK", "CORE", "MOB"] },
  { id: "eng-lead-core", name: "Rachel Green", role: "Core Platform Tech Lead", role_type: "Engineering", projects: ["CORE"] },
  { id: "qa-lead", name: "Marcus Vance", role: "Principal QA & Release Architect", role_type: "Quality Assurance", projects: ["HRZ", "CHK"] },
  { id: "po-checkout", name: "Elena Rostova", role: "Checkout & Payments Group Product Manager", role_type: "Product", projects: ["CHK"] }
];

let _cachedReports = { templates: FALLBACK_TEMPLATES };
let _cachedStakeholders = { stakeholders: FALLBACK_STAKEHOLDERS };
let _cachedProjects = [];
let _currentEditingTemplateId = null;
let _selectedStakeholders = ["pm-default"];
let _selectedBlockTypes = ["health_kpis", "burndown", "dependency_matrix", "action_plan"];
let _selectedProjectScope = "ALL";
let _selectedExportFormat = "html";
let _reportSearchQuery = "";
let _paEventsBound = false;

/**
 * Render the main Reports page (List View).
 */
export async function renderReportsPage() {
  const listView = document.getElementById("reports-list-view");
  const detailView = document.getElementById("report-detail-view");
  if (listView) listView.style.display = "block";
  if (detailView) detailView.style.display = "none";

  _initFormatPills();
  _bindPaSettingsEvents();

  try {
    const [reportsRes, stakeholdersRes, projectsRes] = await Promise.all([
      fetchWithTimeout(`${API_BASE}/reports`, { credentials: "include" }),
      fetchWithTimeout(`${API_BASE}/stakeholders`, { credentials: "include" }),
      fetchWithTimeout(`${API_BASE}/projects?include_archived=false`, { credentials: "include" })
    ]);
    
    if (reportsRes.ok) {
      const data = await reportsRes.json();
      if (data.templates && data.templates.length > 0) _cachedReports = data;
    }
    if (stakeholdersRes.ok) {
      const data = await stakeholdersRes.json();
      if (data.stakeholders && data.stakeholders.length > 0) _cachedStakeholders = data;
    }
    if (projectsRes && projectsRes.ok) {
      const projData = await projectsRes.json();
      _cachedProjects = projData.projects || [];
      _renderProjectSelect(_cachedProjects);
    }
  } catch (e) {
    console.warn("Failed to refresh live reports data:", e);
  }

  _renderReportsGrid();
  _updateReportsStats();
}

/**
 * Update top KPI statistics strip on reports page.
 */
function _updateReportsStats() {
  const templates = _cachedReports?.templates || FALLBACK_TEMPLATES;
  const defaultTpl = templates.find(t => t.is_default) || templates[0];

  const statTpl = document.getElementById("rep-stat-templates");
  if (statTpl) statTpl.textContent = String(templates.length);

  const statActive = document.getElementById("rep-stat-active-tpl");
  if (statActive) statActive.textContent = defaultTpl ? defaultTpl.name.split(" ")[0] : "Weekly TPM";

  const statBlocks = document.getElementById("rep-stat-blocks-count");
  if (statBlocks) statBlocks.textContent = `${AVAILABLE_REPORT_BLOCKS.length} Visuals`;

  // Step Status Badges (Option 2: Process Flow)
  const step1 = document.getElementById("step1-status-badge");
  if (step1) {
    const projSelect = document.getElementById("pa-project-select");
    const scopeVal = projSelect ? projSelect.value : "ALL";
    step1.textContent = scopeVal === "ALL" ? "Portfolio Scope" : `Project: ${scopeVal}`;
  }

  const step2 = document.getElementById("step2-status-badge");
  if (step2) {
    step2.textContent = `${_selectedStakeholders.length} Selected`;
  }

  const step3 = document.getElementById("step3-status-badge");
  if (step3) {
    step3.textContent = `${_selectedBlockTypes.length} Sections`;
  }

  const step4 = document.getElementById("step4-status-badge");
  if (step4) {
    const formatLabels = { html: "Interactive HTML", deck: "Slide Deck", markdown: "Markdown", print: "PDF / Print" };
    step4.textContent = formatLabels[_selectedExportFormat] || "HTML View";
  }
}

let _tempSelectedBlockTypes = [];

/**
 * Render the list of report templates in #reports-list-body (3-Column List/Table Format).
 */
function _renderReportsGrid() {
  const grid = document.getElementById("reports-list-body") || document.getElementById("reports-grid");
  if (!grid) return;

  const templates = _cachedReports?.templates || FALLBACK_TEMPLATES;
  const q = _reportSearchQuery.toLowerCase().trim();

  const filtered = templates.filter(t => {
    if (!q) return true;
    const name = (t.name || "").toLowerCase();
    const desc = (t.description || "").toLowerCase();
    const notes = (t.stakeholder_notes || "").toLowerCase();
    return name.includes(q) || desc.includes(q) || notes.includes(q);
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="p-empty-state" style="margin: 20px;">
        <div class="p-empty-state-icon">📋</div>
        <h4 class="p-empty-state-title">No report templates match "${escapeHtml(_reportSearchQuery)}"</h4>
        <p class="p-empty-state-sub">Try changing your search terms or create a new custom report template.</p>
        <button type="button" class="btn-primary" id="btn-empty-new-report">
          + Create New Report
        </button>
      </div>
    `;
    grid.querySelector("#btn-empty-new-report")?.addEventListener("click", () => openReportDetail(null));
    return;
  }

  const shList = (_cachedStakeholders?.stakeholders && _cachedStakeholders.stakeholders.length > 0)
    ? _cachedStakeholders.stakeholders
    : FALLBACK_STAKEHOLDERS;

  grid.innerHTML = filtered.map(t => {
    const id = escapeHtml(t.id || "");
    const name = escapeHtml(t.name || "Untitled Report");
    const desc = escapeHtml(t.description || "No description provided.");
    const isDefault = Boolean(t.is_default);
    const shIds = t.stakeholder_ids || [];

    const badgeHtml = isDefault
      ? `<span class="report-badge-default">⭐ Default</span>`
      : `<span class="report-badge-custom">📋 Template</span>`;

    const shNames = shIds.map(sid => {
      const found = shList.find(s => s.id === sid);
      return found ? found.name : sid;
    }).join(", ") || "All Stakeholders";

    return `
      <div class="report-list-row" data-id="${id}">
        <!-- Column 1: Info -->
        <div class="rep-col-info">
          <div class="rep-title-line">
            <strong class="report-row-title">${name}</strong>
            ${badgeHtml}
          </div>
          <p class="report-row-desc">${desc}</p>
        </div>

        <!-- Column 2: Scope & Stakeholders -->
        <div class="rep-col-scope">
          <div class="rep-meta-tag" title="Target Portfolio Scope">
            <span class="rep-meta-icon">🌐</span>
            <span>All Projects</span>
          </div>
          <div class="rep-meta-tag" title="Audience: ${escapeHtml(shNames)}" style="margin-top: 3px;">
            <span class="rep-meta-icon">👤</span>
            <span>${escapeHtml(shNames)}</span>
          </div>
        </div>

        <!-- Column 3: Actions -->
        <div class="rep-col-actions">
          <button type="button" class="btn-primary btn-generate-card" data-id="${id}" title="Generate report immediately">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            Generate
          </button>
          <button type="button" class="btn-secondary btn-details-card" data-id="${id}" title="Configure sections and parameters">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            Details
          </button>
          ${!isDefault ? `
            <button type="button" class="btn-p-icon-action btn-p-del btn-delete-card" data-id="${id}" title="Delete template">
              🗑️
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");

  // Bind Row Action buttons
  grid.querySelectorAll(".report-list-row").forEach(row => {
    const id = row.dataset.id;
    const template = templates.find(t => t.id === id);

    // Generate Button
    row.querySelector(".btn-generate-card")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (template) executeReportGeneration(template);
    });

    // Details Button
    row.querySelector(".btn-details-card")?.addEventListener("click", (e) => {
      e.stopPropagation();
      window.location.hash = `reports/${id}`;
    });

    // Delete Button
    row.querySelector(".btn-delete-card")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Delete report template "${template?.name}"?`)) {
        _deleteReportTemplate(id);
      }
    });

    // Clicking anywhere on row opens details
    row.addEventListener("click", (e) => {
      if (e.target.closest(".rep-col-actions")) return;
      window.location.hash = `reports/${id}`;
    });
  });
}

/**
 * Open Report Detail & Edit View for a given report template ID (or null for new).
 */
export function openReportDetail(templateId) {
  const listView = document.getElementById("reports-list-view");
  const detailView = document.getElementById("report-detail-view");
  if (!detailView) return;

  if (listView) listView.style.display = "none";
  detailView.style.display = "block";
  window.scrollTo(0, 0);

  _currentEditingTemplateId = templateId;
  const templates = _cachedReports?.templates || FALLBACK_TEMPLATES;
  const template = templates.find(t => t.id === templateId);

  const titleEl = document.getElementById("pa-detail-view-title");
  const nameInput = document.getElementById("pa-detail-name");
  const descInput = document.getElementById("pa-detail-desc");
  const defaultCheck = document.getElementById("pa-detail-is-default");
  const notesText = document.getElementById("pa-stakeholder-notes");
  const btnDelete = document.getElementById("pa-btn-detail-delete");

  if (template) {
    if (titleEl) titleEl.textContent = `Configure: ${template.name}`;
    if (nameInput) nameInput.value = template.name || "";
    if (descInput) descInput.value = template.description || "";
    if (defaultCheck) defaultCheck.checked = Boolean(template.is_default);
    if (notesText) notesText.value = template.stakeholder_notes || "";
    if (btnDelete) btnDelete.style.display = template.is_default ? "none" : "inline-flex";

    _selectedStakeholders = [...(template.stakeholder_ids || ["pm-default"])];
    _selectedBlockTypes = (template.blocks || [])
      .filter(b => b.enabled !== false)
      .map(b => b.block_type || b.id);
    if (_selectedBlockTypes.length === 0) {
      _selectedBlockTypes = ["health_kpis", "burndown", "dependency_matrix", "action_plan"];
    }
  } else {
    _currentEditingTemplateId = null;
    if (titleEl) titleEl.textContent = "Create New Report Template";
    if (nameInput) nameInput.value = "Custom Program Report";
    if (descInput) descInput.value = "Custom program delivery digest";
    if (defaultCheck) defaultCheck.checked = false;
    if (notesText) notesText.value = "";
    if (btnDelete) btnDelete.style.display = "none";

    _selectedStakeholders = ["pm-default"];
    _selectedBlockTypes = ["exec_summary", "health_kpis", "burndown", "action_plan"];
  }

  _renderProjectSelect(_cachedProjects);
  _renderStakeholderMultiSelect();
  _renderSelectedVisualsChips();
  _initFormatPills();
  _bindPaSettingsEvents();
  _updateReportsStats();
}

/**
 * Render selected visual block badges in Step 3 summary area.
 */
function _renderSelectedVisualsChips() {
  const container = document.getElementById("pa-selected-visuals-chips");
  if (!container) return;

  if (_selectedBlockTypes.length === 0) {
    container.innerHTML = `<span style="font-size: 12.5px; color: var(--text-dim); font-style: italic;">No visual sections selected yet. Click "Configure Visuals in Modal Window" to choose sections.</span>`;
    return;
  }

  container.innerHTML = _selectedBlockTypes.map(type => {
    const def = AVAILABLE_REPORT_BLOCKS.find(b => b.type === type) || { title: type, icon: "📌" };
    return `
      <div class="ms-chip" style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; background: rgba(76, 141, 255, 0.12); border: 1px solid rgba(76, 141, 255, 0.3); border-radius: 6px; color: var(--text); font-size: 12.5px;">
        <span>${def.icon}</span>
        <strong>${escapeHtml(def.title)}</strong>
        <span class="ms-chip-remove remove-visual-chip" data-type="${escapeHtml(type)}" title="Remove section" style="cursor: pointer; opacity: 0.7; margin-left: 4px;">✕</span>
      </div>
    `;
  }).join("");

  container.querySelectorAll(".remove-visual-chip").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const removeType = btn.dataset.type;
      _selectedBlockTypes = _selectedBlockTypes.filter(t => t !== removeType);
      _renderSelectedVisualsChips();
      _updateReportsStats();
    });
  });
}

/**
 * Open modal window to configure visual block checkboxes.
 */
function _openVisualsModal() {
  const modal = document.getElementById("modal-visuals-picker");
  if (!modal) return;

  _tempSelectedBlockTypes = [..._selectedBlockTypes];
  _renderVisualBlocksModalList();
  modal.style.display = "flex";
}

/**
 * Close modal window for visual block checkboxes.
 */
function _closeVisualsModal() {
  const modal = document.getElementById("modal-visuals-picker");
  if (modal) modal.style.display = "none";
}

/**
 * Render interactive checkboxes in modal window.
 */
function _renderVisualBlocksModalList() {
  const container = document.getElementById("pa-visual-blocks-grid");
  if (!container) return;

  container.innerHTML = AVAILABLE_REPORT_BLOCKS.map(block => {
    const isChecked = _tempSelectedBlockTypes.includes(block.type);
    return `
      <div class="visual-block-row ${isChecked ? 'selected' : ''}" data-type="${escapeHtml(block.type)}">
        <input type="checkbox" class="visual-block-checkbox" id="vbc-${escapeHtml(block.type)}" ${isChecked ? 'checked' : ''} />
        <div class="visual-block-row-info">
          <div class="visual-block-row-title">
            <span class="visual-block-icon">${block.icon || '📌'}</span>
            <strong>${escapeHtml(block.title)}</strong>
          </div>
          <p class="visual-block-row-desc">${escapeHtml(block.desc)}</p>
        </div>
      </div>
    `;
  }).join("");

  // Attach interactive click toggles to both checkbox and entire row
  container.querySelectorAll(".visual-block-row").forEach(row => {
    const blockType = row.dataset.type;
    const checkbox = row.querySelector(".visual-block-checkbox");

    const toggle = (forceState) => {
      const nextChecked = forceState !== undefined ? forceState : !checkbox.checked;
      checkbox.checked = nextChecked;

      if (nextChecked) {
        if (!_tempSelectedBlockTypes.includes(blockType)) {
          _tempSelectedBlockTypes.push(blockType);
        }
        row.classList.add("selected");
      } else {
        _tempSelectedBlockTypes = _tempSelectedBlockTypes.filter(t => t !== blockType);
        row.classList.remove("selected");
      }
    };

    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle(checkbox.checked);
    });

    row.addEventListener("click", (e) => {
      if (e.target === checkbox) return;
      toggle();
    });
  });
}

function _renderProjectSelect(projects) {
  const select = document.getElementById("pa-project-select");
  if (!select) return;
  const currentVal = select.value || "ALL";
  select.innerHTML = '<option value="ALL">🌐 All Projects (Entire Portfolio)</option>';
  (projects || []).forEach(p => {
    if (p.archived) return;
    const opt = document.createElement("option");
    opt.value = p.key;
    opt.textContent = `${p.key} — ${p.name}`;
    select.appendChild(opt);
  });
  if (Array.from(select.options).some(o => o.value === currentVal)) {
    select.value = currentVal;
  }
}

function _renderStakeholderMultiSelect() {
  const stakeholdersList = (_cachedStakeholders?.stakeholders && _cachedStakeholders.stakeholders.length > 0)
    ? _cachedStakeholders.stakeholders
    : FALLBACK_STAKEHOLDERS;

  const allStakeholders = stakeholdersList.map(s => ({
    id: s.id,
    title: s.name || s.role || s.id,
    desc: s.description || `${s.role || s.role_type || "Stakeholder"} • ${s.projects?.join(", ") || "All projects"}`
  }));

  _setupSearchableMultiSelect({
    containerId: "pa-stakeholders-multiselect",
    inputContainerId: "pa-sh-input-container",
    chipsContainerId: "pa-sh-chips",
    searchInputId: "pa-sh-search",
    dropdownId: "pa-sh-dropdown",
    items: allStakeholders,
    selectedIds: _selectedStakeholders,
    onSelectionChange: (newSelected) => {
      _selectedStakeholders = newSelected;
      _updateReportsStats();
    }
  });
}

function _setupSearchableMultiSelect(cfg) {
  const { containerId, inputContainerId, chipsContainerId, searchInputId, dropdownId, items, selectedIds, onSelectionChange } = cfg;
  
  const inputContainer = document.getElementById(inputContainerId);
  const chipsContainer = document.getElementById(chipsContainerId);
  const searchInput = document.getElementById(searchInputId);
  const dropdown = document.getElementById(dropdownId);
  if (!inputContainer || !chipsContainer || !searchInput || !dropdown) return;

  function renderChips() {
    chipsContainer.innerHTML = "";
    selectedIds.forEach(id => {
      const item = items.find(x => x.id === id);
      if (!item) return;
      const chip = document.createElement("div");
      chip.className = "ms-chip";
      chip.innerHTML = `<span>${escapeHtml(item.title)}</span><span class="ms-chip-remove" data-id="${id}" title="Remove">✕</span>`;
      chip.querySelector(".ms-chip-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        const next = selectedIds.filter(x => x !== id);
        onSelectionChange(next);
        renderChips();
        renderDropdownList();
      });
      chipsContainer.appendChild(chip);
    });
  }

  function renderDropdownList(filterQuery = "") {
    dropdown.innerHTML = "";
    const q = (filterQuery || "").toLowerCase().trim();
    const filtered = items.filter(item => 
      !q || item.title.toLowerCase().includes(q) || (item.desc && item.desc.toLowerCase().includes(q))
    );

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ms-option";
      empty.style.color = "var(--text-dim)";
      empty.style.cursor = "default";
      empty.textContent = "No matching items found.";
      dropdown.appendChild(empty);
      return;
    }

    filtered.forEach(item => {
      const isSelected = selectedIds.includes(item.id);
      const opt = document.createElement("div");
      opt.className = `ms-option ${isSelected ? "selected" : ""}`;
      opt.innerHTML = `
        <div class="ms-option-check">${isSelected ? "✓" : ""}</div>
        <div class="ms-option-content">
          <div class="ms-option-title">${escapeHtml(item.title)}</div>
          ${item.desc ? `<div class="ms-option-desc">${escapeHtml(item.desc)}</div>` : ""}
        </div>
      `;
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        let next;
        if (isSelected) {
          next = selectedIds.filter(x => x !== item.id);
        } else {
          next = [...selectedIds, item.id];
        }
        onSelectionChange(next);
        renderChips();
        renderDropdownList(searchInput.value);
      });
      dropdown.appendChild(opt);
    });
  }

  renderChips();
  renderDropdownList();

  searchInput.oninput = () => {
    dropdown.style.display = "block";
    renderDropdownList(searchInput.value);
  };

  inputContainer.onclick = () => {
    dropdown.style.display = "block";
    searchInput.focus();
    renderDropdownList(searchInput.value);
  };

  document.addEventListener("click", (e) => {
    const parent = document.getElementById(containerId);
    if (parent && !parent.contains(e.target)) {
      dropdown.style.display = "none";
    }
  });
}

function _initFormatPills() {
  const container = document.getElementById("pa-format-pills");
  if (!container) return;
  const pills = container.querySelectorAll(".format-pill");
  pills.forEach(pill => {
    pill.onclick = () => {
      pills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      _selectedExportFormat = pill.dataset.format || "html";
      _updateReportsStats();
    };
  });
}

export function readPaSettingsForm() {
  const name = document.getElementById("pa-detail-name")?.value || "Weekly TPM Sprint & Delivery Health";
  const desc = document.getElementById("pa-detail-desc")?.value || "";
  const projectSelect = document.getElementById("pa-project-select");
  const projectScope = projectSelect ? projectSelect.value : "ALL";
  const isDefault = document.getElementById("pa-detail-is-default")?.checked || false;
  const stakeholderNotes = document.getElementById("pa-stakeholder-notes")?.value || "";
  
  const blocks = _selectedBlockTypes.map((type, index) => {
    const def = AVAILABLE_REPORT_BLOCKS.find(b => b.type === type) || { title: type };
    return {
      id: `${type}_${index + 1}`,
      block_type: type,
      title: def.title,
      enabled: true,
      order: index + 1,
      pm_commentary: "",
      chart_prompt: "",
      config: {}
    };
  });

  return {
    template_id: _currentEditingTemplateId || "custom",
    name: name.trim() || "Custom Program Report",
    description: desc.trim(),
    project_scope: projectScope,
    is_default: isDefault,
    stakeholder_ids: _selectedStakeholders,
    stakeholder_notes: stakeholderNotes,
    blocks: blocks,
    export_format: _selectedExportFormat
  };
}

let _reportChatHistory = [];
let _aiProposedTemplate = null;

/**
 * Helper to render lightweight markdown in AI chat bubbles.
 */
function _formatAiMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);
  
  // Headers (### Header)
  html = html.replace(/^### (.*$)/gim, '<h4 style="margin: 8px 0 4px 0; color: #818cf8; font-size: 14px;">$1</h4>');
  html = html.replace(/^## (.*$)/gim, '<h3 style="margin: 10px 0 6px 0; color: var(--text); font-size: 15px;">$1</h3>');
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // Bullet lists
  html = html.replace(/^\* (.*$)/gim, '<li style="margin-left: 16px; margin-bottom: 3px;">$1</li>');
  html = html.replace(/^- (.*$)/gim, '<li style="margin-left: 16px; margin-bottom: 3px;">$1</li>');
  
  // Numbered lists
  html = html.replace(/^(\d+)\. (.*$)/gim, '<li style="margin-left: 16px; margin-bottom: 3px;"><strong>$1.</strong> $2</li>');
  
  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr style="border: 0; border-top: 1px solid rgba(99, 102, 241, 0.2); margin: 8px 0;" />');
  
  // Inline code / badges
  html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #818cf8;">$1</code>');
  
  // Paragraph line breaks
  html = html.replace(/\n\n/g, '<div style="margin-bottom: 8px;"></div>');
  html = html.replace(/\n/g, '<br />');
  
  return html;
}

/**
 * Render structured proposed template preview card for chat bubble.
 */
function _renderProposedTemplateHtml(tpl) {
  if (!tpl) return "";
  const blocksCount = (tpl.blocks || []).length;
  const stakeholdersCount = (tpl.stakeholder_ids || []).length;
  const scope = tpl.project_scope || tpl.project_key || "ALL";
  const format = (tpl.export_format || "html").toUpperCase();

  return `
    <div class="ai-proposed-card">
      <div class="ai-proposed-header">
        <div class="ai-proposed-title">📋 ${escapeHtml(tpl.name || "Proposed Report Structure")}</div>
        <span style="font-size: 11px; background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 2px 8px; border-radius: 999px; font-weight: 600;">Optimal Fit</span>
      </div>
      <div class="ai-proposed-grid">
        <div class="ai-proposed-item"><strong>Scope:</strong> <span>${escapeHtml(scope)}</span></div>
        <div class="ai-proposed-item"><strong>Stakeholders:</strong> <span>${stakeholdersCount} Personas</span></div>
        <div class="ai-proposed-item"><strong>Visual Blocks:</strong> <span>${blocksCount} Sections</span></div>
        <div class="ai-proposed-item"><strong>Format:</strong> <span>${escapeHtml(format)}</span></div>
      </div>
      <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 10px; line-height: 1.4;">
        ${escapeHtml(tpl.description || "")}
      </div>
      <div style="display: flex; justify-content: flex-end;">
        <button type="button" class="ai-proposed-btn pa-chat-apply-inline">
          ✓ Prefill in Edit Mode
        </button>
      </div>
    </div>
  `;
}

function _suggestReportTemplate(forceNew = false) {
  if (forceNew) {
    openReportDetail(null);
  }
  const panel = document.getElementById("pa-ai-chat-panel");
  if (panel) {
    panel.style.display = "block";
    const historyDiv = document.getElementById("pa-ai-chat-history");
    if (historyDiv) {
      historyDiv.innerHTML = `<div style="background: rgba(99, 102, 241, 0.1); padding: 12px; border-radius: 8px; border: 1px solid rgba(99, 102, 241, 0.2);">
        <strong>AI Assistant:</strong> Tell me what project, milestone, or stakeholder group you are building this report for. I will synthesize our project charter, decisions (D1–D3), risk triggers, and stakeholder priorities into an optimal report template.
      </div>`;
    }
    _reportChatHistory = [];
    _aiProposedTemplate = null;
    const applyBtn = document.getElementById("pa-ai-chat-apply");
    if (applyBtn) applyBtn.style.display = "none";

    // Bind prompt chip clicks
    const chipContainer = document.getElementById("pa-ai-prompt-chips");
    if (chipContainer) {
      chipContainer.querySelectorAll(".ai-chat-chip-btn").forEach(chip => {
        chip.onclick = () => {
          const prompt = chip.dataset.prompt;
          if (prompt) _sendAiChatMsg(prompt);
        };
      });
    }
  }
}

async function _sendAiChatMsg(customMsg = null) {
  const input = document.getElementById("pa-ai-chat-input");
  const historyDiv = document.getElementById("pa-ai-chat-history");
  const btn = document.getElementById("pa-ai-chat-send");
  const msg = (customMsg !== null && customMsg !== undefined) ? String(customMsg).trim() : (input ? input.value.trim() : "");
  if (!msg) return;

  if (historyDiv) {
    historyDiv.innerHTML += `<div style="padding: 10px 12px; border-radius: 8px; background: var(--bg-hover); border: 1px solid var(--border);"><strong>You:</strong> ${escapeHtml(msg)}</div>`;
  }
  if (input) input.value = "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Thinking...";
  }
  if (historyDiv) historyDiv.scrollTop = historyDiv.scrollHeight;

  try {
    const stakeholderIds = _selectedStakeholders || [];
    const payload = {
      stakeholder_ids: stakeholderIds,
      user_prompt: msg,
      chat_history: _reportChatHistory
    };

    const res = await fetchWithTimeout(`${API_BASE}/reports/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });

    if (!res.ok) throw new Error("Failed to get suggestion.");
    const data = await res.json();
    
    if (data.reply) {
      _reportChatHistory.push({ role: "user", content: msg });
      _reportChatHistory.push({ role: "assistant", content: data.reply });
      
      let proposedCardHtml = "";
      if (data.proposed_template) {
        _aiProposedTemplate = data.proposed_template;
        proposedCardHtml = _renderProposedTemplateHtml(data.proposed_template);
        const applyBtn = document.getElementById("pa-ai-chat-apply");
        if (applyBtn) applyBtn.style.display = "inline-block";
      }

      if (historyDiv) {
        historyDiv.innerHTML += `
          <div style="background: rgba(99, 102, 241, 0.1); padding: 12px; border-radius: 8px; border: 1px solid rgba(99, 102, 241, 0.2);">
            <div style="font-weight: 600; color: #818cf8; margin-bottom: 6px;">🤖 AI Assistant:</div>
            <div style="line-height: 1.5;">${_formatAiMarkdown(data.reply)}</div>
            ${proposedCardHtml}
          </div>
        `;

        // Bind inline apply button if rendered
        const inlineApply = historyDiv.querySelector(".pa-chat-apply-inline:last-of-type");
        if (inlineApply) {
          inlineApply.addEventListener("click", () => _applyAiTemplate());
        }
      }
    }
  } catch (err) {
    if (historyDiv) {
      historyDiv.innerHTML += `<div style="color: #ef4444; padding: 10px; border-radius: 8px; background: rgba(239, 68, 68, 0.1);">Error: ${escapeHtml(err.message)}</div>`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>Send</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>`;
    }
    if (historyDiv) historyDiv.scrollTop = historyDiv.scrollHeight;
  }
}

function _applyAiTemplate() {
  if (!_aiProposedTemplate) return;
  const suggestion = _aiProposedTemplate;

  // Make sure we are in detail / edit mode
  const detailView = document.getElementById("report-detail-view");
  const listView = document.getElementById("reports-list-view");
  if (listView) listView.style.display = "none";
  if (detailView) detailView.style.display = "block";

  _currentEditingTemplateId = null; // Fresh new template in edit mode

  const titleEl = document.getElementById("pa-detail-view-title");
  if (titleEl) titleEl.textContent = `Configure: ${suggestion.name || "Custom Program Report"}`;

  // 1. Template & Scope
  if (suggestion.name) {
    const nameEl = document.getElementById("pa-detail-name");
    if (nameEl) nameEl.value = suggestion.name;
  }
  if (suggestion.description) {
    const descEl = document.getElementById("pa-detail-desc");
    if (descEl) descEl.value = suggestion.description;
  }
  if (suggestion.is_default !== undefined) {
    const defEl = document.getElementById("pa-detail-is-default");
    if (defEl) defEl.checked = Boolean(suggestion.is_default);
  }
  if (suggestion.project_scope || suggestion.project_key) {
    const projSelect = document.getElementById("pa-project-select");
    const targetScope = suggestion.project_scope || suggestion.project_key;
    if (projSelect) {
      if (Array.from(projSelect.options).some(o => o.value === targetScope)) {
        projSelect.value = targetScope;
      } else {
        projSelect.value = "ALL";
      }
      _selectedProjectScope = projSelect.value;
    }
  }

  // 2. Stakeholders
  if (suggestion.stakeholder_ids && Array.isArray(suggestion.stakeholder_ids)) {
    _selectedStakeholders = [...suggestion.stakeholder_ids];
    _renderStakeholderMultiSelect();
  }

  // 3. Visual Blocks
  if (suggestion.blocks && Array.isArray(suggestion.blocks)) {
    const blockIds = suggestion.blocks.map(b => b.block_type || b.id || b);
    _selectedBlockTypes = blockIds.map(id => id === "executive_summary" ? "exec_summary" : id);
    _renderSelectedVisualsChips();
  }

  // 4. Format & Directives
  if (suggestion.export_format) {
    _selectedExportFormat = suggestion.export_format.toLowerCase();
    const container = document.getElementById("pa-format-pills");
    if (container) {
      container.querySelectorAll(".format-pill").forEach(p => {
        p.classList.toggle("active", p.dataset.format === _selectedExportFormat);
      });
    }
  }
  if (suggestion.stakeholder_notes) {
    const notesEl = document.getElementById("pa-stakeholder-notes");
    if (notesEl) notesEl.value = suggestion.stakeholder_notes;
  }

  // Update step badges
  const s1Badge = document.getElementById("step1-status-badge");
  if (s1Badge) s1Badge.textContent = "Configured";
  const s2Badge = document.getElementById("step2-status-badge");
  if (s2Badge) s2Badge.textContent = `${_selectedStakeholders.length} Selected`;
  const s3Badge = document.getElementById("step3-status-badge");
  if (s3Badge) s3Badge.textContent = `${_selectedBlockTypes.length} Sections`;
  const s4Badge = document.getElementById("step4-status-badge");
  if (s4Badge) s4Badge.textContent = `${_selectedExportFormat.toUpperCase()} View`;

  _updateReportsStats();

  // Hide the chat panel and scroll smoothly to top
  const panel = document.getElementById("pa-ai-chat-panel");
  if (panel) panel.style.display = "none";
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Render a visual confirmation badge banner in detail header
  const subTitle = document.getElementById("pa-detail-view-subtitle");
  if (subTitle) {
    const origSub = subTitle.textContent;
    subTitle.innerHTML = `<span style="color: #10b981; font-weight: 600;">✨ Prefilled with AI Assistant!</span> Customize any sections below, then click Save or Generate.`;
    setTimeout(() => {
      if (subTitle) subTitle.textContent = origSub;
    }, 6000);
  }
}


/**
 * Save report template from detail editor.
 */
async function _saveCurrentTemplate() {
  const btn = document.getElementById("pa-btn-detail-save");
  const form = readPaSettingsForm();

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";
  }

  try {
    const payload = {
      name: form.name,
      description: form.description,
      is_default: form.is_default,
      stakeholder_ids: form.stakeholder_ids,
      stakeholder_notes: form.stakeholder_notes,
      blocks: form.blocks
    };

    let res;
    if (_currentEditingTemplateId && !_currentEditingTemplateId.startsWith("new")) {
      res = await fetchWithTimeout(`${API_BASE}/reports/${_currentEditingTemplateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });
    } else {
      res = await fetchWithTimeout(`${API_BASE}/reports/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include"
      });
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to save report template");
    }

    const json = await res.json();
    _currentEditingTemplateId = json.template?.id || _currentEditingTemplateId;
    alert(`✓ Report template "${form.name}" saved successfully.`);
    window.location.hash = "reports";
  } catch (err) {
    console.error("Save template error:", err);
    alert(err.message || "Failed to save template");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "💾 Save Template";
    }
  }
}

/**
 * Delete a report template.
 */
async function _deleteReportTemplate(templateId) {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/reports/${templateId}`, {
      method: "DELETE",
      credentials: "include"
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to delete report template");
    }

    await renderReportsPage();
    window.location.hash = "reports";
  } catch (err) {
    console.error("Delete template error:", err);
    alert(err.message || "Failed to delete template");
  }
}

/**
 * Execute report generation and render in results area.
 */
export async function executeReportGeneration(templateOrPayload) {
  const resultsContainer = document.getElementById("pa-results");
  const placeholder = document.getElementById("pa-placeholder");
  const contentEl = document.getElementById("pa-results-content");

  if (resultsContainer) {
    resultsContainer.className = "pa-results";
    resultsContainer.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (placeholder) {
    placeholder.style.display = "block";
    placeholder.innerHTML = `
      <div class="pd-loading" style="font-size: 15px; padding: 30px; text-align: center;">
        <span style="font-size: 24px; display: block; margin-bottom: 8px;">⏳</span>
        Synthesizing AI program analytics and stakeholder briefing...
      </div>
    `;
  }
  if (contentEl) contentEl.style.display = "none";

  let apiPayload;
  if (templateOrPayload.template_id || templateOrPayload.blocks) {
    apiPayload = {
      profile_id: templateOrPayload.template_id && !templateOrPayload.template_id.startsWith("new") && templateOrPayload.template_id !== "custom" ? templateOrPayload.template_id : undefined,
      project_key: templateOrPayload.project_scope === "ALL" ? undefined : templateOrPayload.project_scope,
      settings_override: {
        stakeholder_ids: templateOrPayload.stakeholder_ids,
        stakeholder_notes: templateOrPayload.stakeholder_notes,
        blocks: templateOrPayload.blocks,
        focus_epics: templateOrPayload.project_scope === "ALL" ? [] : [templateOrPayload.project_scope]
      }
    };
  } else {
    apiPayload = {
      profile_id: templateOrPayload.id,
      project_key: undefined,
      settings_override: {
        stakeholder_ids: templateOrPayload.stakeholder_ids,
        stakeholder_notes: templateOrPayload.stakeholder_notes,
        blocks: templateOrPayload.blocks
      }
    };
  }

  try {
    const data = await generateReport(apiPayload);
    renderGenerateReportInTab(data);
  } catch (err) {
    console.error("Report generation error:", err);
    if (placeholder) {
      placeholder.innerHTML = `
        <div class="error-text" style="padding: 24px; text-align: center;">
          <span style="font-size: 22px; display: block; margin-bottom: 6px;">❌</span>
          Failed to generate report: ${escapeHtml(err.message)}
        </div>
      `;
    }
  }
}

function _bindPaSettingsEvents() {
  if (_paEventsBound) return;
  _paEventsBound = true;

  // New report button
  document.getElementById("pa-btn-new-report")?.addEventListener("click", () => {
    window.location.hash = "reports/new";
  });

  // AI Assistant new report button from list view -> Navigate to Reports AI Assistant
  document.getElementById("pa-btn-ai-new-report")?.addEventListener("click", () => {
    window.location.hash = "assistant";
  });

  // Back button
  document.getElementById("btn-back-reports")?.addEventListener("click", (e) => {
    e.preventDefault();
    const listView = document.getElementById("reports-list-view");
    const detailView = document.getElementById("report-detail-view");
    if (listView) listView.style.display = "block";
    if (detailView) detailView.style.display = "none";
    window.location.hash = "reports";
    renderReportsPage();
  });

  // Save template in details view
  document.getElementById("pa-btn-detail-save")?.addEventListener("click", _saveCurrentTemplate);

  // AI Report Assistant button in details view -> Navigate to Reports AI Assistant
  document.getElementById("pa-btn-detail-suggest")?.addEventListener("click", () => {
    window.location.hash = "assistant";
  });

  // AI Chat Panel bindings
  document.getElementById("pa-ai-chat-close")?.addEventListener("click", () => {
    document.getElementById("pa-ai-chat-panel").style.display = "none";
  });
  document.getElementById("pa-ai-chat-send")?.addEventListener("click", _sendAiChatMsg);
  document.getElementById("pa-ai-chat-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") _sendAiChatMsg();
  });
  document.getElementById("pa-ai-chat-apply")?.addEventListener("click", _applyAiTemplate);

  // Delete template in details view
  document.getElementById("pa-btn-detail-delete")?.addEventListener("click", () => {
    if (_currentEditingTemplateId && confirm("Are you sure you want to delete this report template?")) {
      _deleteReportTemplate(_currentEditingTemplateId);
    }
  });

  // Generate buttons
  const triggerGenerate = () => {
    const payload = readPaSettingsForm();
    executeReportGeneration(payload);
  };

  document.getElementById("pa-btn-detail-generate")?.addEventListener("click", triggerGenerate);
  document.getElementById("pa-btn-generate-bottom")?.addEventListener("click", triggerGenerate);

  // Search input on reports list
  const searchInput = document.getElementById("pa-report-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      _reportSearchQuery = e.target.value;
      _renderReportsGrid();
    });
  }

  // Project select change
  const projSelect = document.getElementById("pa-project-select");
  if (projSelect) {
    projSelect.addEventListener("change", (e) => {
      _selectedProjectScope = e.target.value;
      _updateReportsStats();
    });
  }

  // Visuals Modal Picker
  document.getElementById("btn-open-visuals-modal")?.addEventListener("click", _openVisualsModal);
  document.getElementById("btn-close-visuals-modal")?.addEventListener("click", _closeVisualsModal);
  document.getElementById("btn-cancel-visuals-modal")?.addEventListener("click", _closeVisualsModal);
  document.getElementById("btn-apply-visuals-modal")?.addEventListener("click", () => {
    _selectedBlockTypes = [..._tempSelectedBlockTypes];
    _closeVisualsModal();
    _renderSelectedVisualsChips();
    _updateReportsStats();
  });

  const visualsModal = document.getElementById("modal-visuals-picker");
  if (visualsModal) {
    visualsModal.addEventListener("click", (e) => {
      if (e.target === visualsModal) _closeVisualsModal();
    });
  }

  // Reset profiles
  const resetBtn = document.getElementById("pa-btn-reset-profiles");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      if (confirm("Restore all 5 default report templates? Any custom modifications will be reset.")) {
        try {
          const res = await fetchWithTimeout(`${API_BASE}/reports/reset`, {
            method: "POST",
            credentials: "include",
          });
          if (res.ok) {
            const resData = await res.json();
            _cachedReports = resData.data || resData;
            await renderReportsPage();
          }
        } catch (e) {
          console.error("Failed to restore default reports:", e);
        }
      }
    });
  }
}

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

export function readPaAiSettingsForm() {
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

export async function saveComposerTemplate() {
  await _saveCurrentTemplate();
}
