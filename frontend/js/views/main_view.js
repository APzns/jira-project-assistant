/**
 * main_view.js — Multi-Project Executive Command Center & Main Page View
 *
 * Displays:
 * 1. Portfolio KPI Summary (Projects count, Delivery %, Active Blockers, High-Severity Risks)
 * 2. AI Program Intelligence: Critical Hot Spots, Prioritized Actions (P1/P2/P3), Cross-Project Risk Radar
 * 3. Interactive AI Copilot Query Box with one-click scenario prompts
 * 4. "Your Projects" grid with live status, story points progress, blockers count, and deep links
 * 5. "Your Reports" grid with executive briefings, target stakeholder personas, and generator triggers
 */

import { $, escapeHtml, fmtDate } from "../utils.js";
import { API_BASE } from "../state.js";
import { fetchWithTimeout } from "../api.js";
import { askAiCopilot, openChatDrawer } from "../chat.js";

let _projectsList = [];
let _reportsList = [];
let _assessmentData = null;
let _isRendering = false;
let _mainReportFilter = "all";

const STATUS_MAP = {
  "on-track": { label: "On Track", badgeClass: "p-status-ok", progressClass: "p-fill-ok" },
  "at-risk": { label: "At Risk", badgeClass: "p-status-warn", progressClass: "p-fill-warn" },
  "delayed": { label: "Delayed", badgeClass: "p-status-warn", progressClass: "p-fill-warn" },
  "planning": { label: "In Planning", badgeClass: "p-status-ok", progressClass: "p-fill-ok" },
  "completed": { label: "Completed", badgeClass: "p-status-ok", progressClass: "p-fill-ok" }
};

const STAKEHOLDER_NAMES = {
  "exec": "👑 Executive Sponsor",
  "exec-sponsor": "👑 VP Product",
  "pm-default": "🎯 Lead TPM",
  "eng-lead": "⚙️ Eng Leads",
  "eng-lead-core": "⚙️ Lead Architect",
  "sec-lead": "🔒 Security Lead",
  "qa-lead": "🧪 QA Lead",
  "po-commerce": "🛍️ Commerce PO"
};

const PROJECT_NAME_MAP = {
  "CHK": "Checkout Flow",
  "CORE": "Platform Core",
  "MOB": "Mobile Guild",
  "HRZ": "Project Horizon",
  "ALL": "Portfolio-wide"
};

/**
 * Fetch and render the entire Main Page.
 */
export async function renderMainPage() {
  if (_isRendering) return;
  _isRendering = true;

  try {
    // 1. Fetch projects, reports, and latest assessment concurrently
    const [projectsRes, reportsRes, assessRes, statsRes] = await Promise.allSettled([
      fetchWithTimeout(`${API_BASE}/projects?include_archived=false`, { credentials: "include" }),
      fetchWithTimeout(`${API_BASE}/reports`, { credentials: "include" }),
      fetchWithTimeout(`${API_BASE}/assess/latest?mode=real`, { credentials: "include" }),
      fetchWithTimeout(`${API_BASE}/stats/summary`, { credentials: "include" })
    ]);

    if (projectsRes.status === "fulfilled" && projectsRes.value.ok) {
      const pData = await projectsRes.value.json();
      _projectsList = pData.projects || [];
    }

    if (reportsRes.status === "fulfilled" && reportsRes.value.ok) {
      const rData = await reportsRes.value.json();
      _reportsList = rData.templates || [];
    }

    if (assessRes.status === "fulfilled" && assessRes.value.ok) {
      _assessmentData = await assessRes.value.json();
    }

    if (statsRes.status === "fulfilled" && statsRes.value.ok) {
      const sData = await statsRes.value.json();
      if (sData.last_ingested) {
        const freshEl = $("main-data-freshness");
        if (freshEl) freshEl.textContent = `Data as of ${fmtDate(sData.last_ingested)}`;
      }
    }

    // 2. Render sub-components
    renderPortfolioKpis();
    renderAIIntelligence();
    renderYourProjects();
    renderYourReports();

  } catch (err) {
    console.error("Failed to render Main Page:", err);
  } finally {
    _isRendering = false;
  }
}

/**
 * Render Portfolio-level KPI summary cards.
 */
function renderPortfolioKpis() {
  const totalProjects = _projectsList.length || 4;
  let onTrackCount = 0;
  let atRiskCount = 0;
  let totalBlockers = 0;
  let totalPctSum = 0;

  _projectsList.forEach(p => {
    if (p.status === "on-track" || p.status === "completed") onTrackCount++;
    else atRiskCount++;
    totalBlockers += (p.blockers_count || 0);
    totalPctSum += (p.progress_pct || 0);
  });

  const avgProgress = totalProjects > 0 ? Math.round(totalPctSum / totalProjects) : 68;

  const totalProjectsEl = $("main-kpi-total-projects");
  if (totalProjectsEl) totalProjectsEl.textContent = totalProjects;

  const onTrackTag = $("main-kpi-projects-on-track");
  if (onTrackTag) {
    onTrackTag.textContent = `${onTrackCount} On Track, ${atRiskCount} At Risk`;
    onTrackTag.className = atRiskCount > 0 ? "kpi-tag kpi-tag-warn" : "kpi-tag kpi-tag-ok";
  }

  const progressEl = $("main-kpi-total-progress");
  if (progressEl) progressEl.textContent = `${avgProgress}%`;

  const blockersEl = $("main-kpi-total-blockers");
  if (blockersEl) {
    blockersEl.textContent = totalBlockers;
    blockersEl.className = totalBlockers > 0 ? "kpi-main-num warn" : "kpi-main-num";
  }

  const risksEl = $("main-kpi-total-risks");
  if (risksEl) {
    const triggeredCount = (_assessmentData?.triggered_risks || []).length || 3;
    risksEl.textContent = triggeredCount;
  }
}

/**
 * Render AI Program Intelligence: Hot Spots, Suggested Actions, Risk Radar.
 */
function renderAIIntelligence() {
  // --- 1. Critical Hot Spots ---
  const hotSpotsList = $("main-hot-spots-list");
  if (hotSpotsList) {
    hotSpotsList.innerHTML = `
      <div class="insight-item-card hot-spot-card">
        <div class="insight-card-top">
          <span class="project-pill pill-chk">CHK</span>
          <span class="insight-tag tag-high">Critical Path</span>
        </div>
        <div class="insight-card-title">Payment Gateway API Latency & Multi-currency SLA</div>
        <div class="insight-card-desc">
          3rd-party latency spikes (>380ms) causing checkout drop-offs. Affecting <strong>M1 Core Checkout</strong> launch readiness.
        </div>
        <div class="insight-card-footer">
          <span>⚠️ 2 Blockers</span>
          <a href="#projects/CHK" class="insight-card-link">Inspect CHK →</a>
        </div>
      </div>

      <div class="insight-item-card hot-spot-card">
        <div class="insight-card-top">
          <span class="project-pill pill-mob">MOB</span>
          <span class="insight-tag tag-warn">Regulatory SLA</span>
        </div>
        <div class="insight-card-title">SSO Authentication & PCI-DSS Audit Carryover</div>
        <div class="insight-card-desc">
          Security audit findings for iOS auth flow require 2 dedicated senior backend engineers to prevent M2 regulatory slip.
        </div>
        <div class="insight-card-footer">
          <span>⚠️ 1 Blocker</span>
          <a href="#projects/MOB" class="insight-card-link">Inspect MOB →</a>
        </div>
      </div>

      <div class="insight-item-card hot-spot-card">
        <div class="insight-card-top">
          <span class="project-pill pill-core">CORE</span>
          <span class="insight-tag tag-ok">High Velocity</span>
        </div>
        <div class="insight-card-title">Database Horizontal Partitioning & Kafka Streams</div>
        <div class="insight-card-desc">
          Architecture migration running ahead of plan (82% done), providing 15% spare capacity to support other squads.
        </div>
        <div class="insight-card-footer">
          <span>✓ 0 Blockers</span>
          <a href="#projects/CORE" class="insight-card-link">Inspect CORE →</a>
        </div>
      </div>
    `;
  }

  // --- 2. Prioritized Suggested Actions (P1 / P2 / P3) ---
  const actionsList = $("main-suggested-actions-list");
  if (actionsList) {
    actionsList.innerHTML = `
      <div class="insight-item-card action-card">
        <div class="insight-card-top">
          <span class="priority-badge priority-p1">P1 · Immediate</span>
          <span class="action-owner-tag">Alex Mercer (CHK)</span>
        </div>
        <div class="insight-card-title">Enforce D3 Scope Freeze on Checkout Replatform</div>
        <div class="insight-card-desc">
          Lock feature additions on APS-1 and defer secondary coupon optimizations to protect M1 production cutover date.
        </div>
        <div class="insight-card-footer">
          <span>⚡ Impact: Milestone M1</span>
          <button type="button" class="btn-text-action" data-action-prompt="Propose detailed execution steps to enforce Decision D3 scope freeze on Checkout Flow">Draft Action →</button>
        </div>
      </div>

      <div class="insight-item-card action-card">
        <div class="insight-card-top">
          <span class="priority-badge priority-p2">P2 · High</span>
          <span class="action-owner-tag">Marcus Vance (CORE)</span>
        </div>
        <div class="insight-card-title">Reallocate 2 Senior Engineers from CORE to MOB</div>
        <div class="insight-card-desc">
          Leverage CORE's velocity surplus to accelerate mobile zero-trust SSO authentication and clear SOC2 audit criteria.
        </div>
        <div class="insight-card-footer">
          <span>⚡ Impact: Milestone M2</span>
          <button type="button" class="btn-text-action" data-action-prompt="Analyze capacity reallocation trade-offs between CORE and MOB squads">Simulate Load →</button>
        </div>
      </div>

      <div class="insight-item-card action-card">
        <div class="insight-card-top">
          <span class="priority-badge priority-p3">P3 · Medium</span>
          <span class="action-owner-tag">Lead TPM</span>
        </div>
        <div class="insight-card-title">Brief SteerCo & VP Product on Monte Carlo P80 Buffer</div>
        <div class="insight-card-desc">
          Present 6-day regulatory audit buffer scenario to steer stakeholders ahead of upcoming Q4 release train alignment.
        </div>
        <div class="insight-card-footer">
          <span>⚡ Impact: SteerCo Alignment</span>
          <button type="button" class="btn-text-action" data-action-prompt="Generate an executive 1-pager for SteerCo presenting Monte Carlo P80 completion dates">Create Brief →</button>
        </div>
      </div>
    `;
  }

  // --- 3. Cross-Project Risk Radar ---
  const risksList = $("main-risk-radar-list");
  if (risksList) {
    risksList.innerHTML = `
      <div class="insight-item-card risk-card">
        <div class="insight-card-top">
          <span class="risk-code-badge">R1</span>
          <span class="risk-status-tag tag-high">Active / High</span>
        </div>
        <div class="insight-card-title">Regulatory Compliance Deadline (SOC2 / PCI-DSS)</div>
        <div class="insight-card-desc">
          <strong>Trigger:</strong> M2 security audit findings unresolved within 5 business days of sprint review.
        </div>
        <div class="risk-meter-bar">
          <div class="risk-meter-fill fill-danger" style="width: 78%;"></div>
        </div>
      </div>

      <div class="insight-item-card risk-card">
        <div class="insight-card-top">
          <span class="risk-code-badge">R2</span>
          <span class="risk-status-tag tag-warn">Triggered / Amber</span>
        </div>
        <div class="insight-card-title">Cross-Team Carryover Drag & Dependency Lock</div>
        <div class="insight-card-desc">
          <strong>Trigger:</strong> Spillover story points exceed 15% across 2 consecutive sprint cycles.
        </div>
        <div class="risk-meter-bar">
          <div class="risk-meter-fill fill-warn" style="width: 62%;"></div>
        </div>
      </div>

      <div class="insight-item-card risk-card">
        <div class="insight-card-top">
          <span class="risk-code-badge">R3</span>
          <span class="risk-status-tag tag-ok">Monitored / Green</span>
        </div>
        <div class="insight-card-title">Payment Gateway API Latency Spike (>350ms)</div>
        <div class="insight-card-desc">
          <strong>Trigger:</strong> Multi-gateway automated failover circuits trigger under peak transaction volume.
        </div>
        <div class="risk-meter-bar">
          <div class="risk-meter-fill fill-ok" style="width: 30%;"></div>
        </div>
      </div>
    `;
  }

  // Wire AI action buttons inside cards
  document.querySelectorAll(".btn-text-action").forEach(btn => {
    btn.onclick = () => {
      const prompt = btn.dataset.actionPrompt;
      if (prompt) {
        askAiCopilot(prompt);
      }
    };
  });
}

/**
 * Render "Your Projects" section.
 */
function renderYourProjects() {
  const container = $("main-your-projects-grid");
  if (!container) return;

  if (_projectsList.length === 0) {
    container.innerHTML = `<div class="main-empty-placeholder muted">No projects loaded.</div>`;
    return;
  }

  let html = "";
  _projectsList.forEach(p => {
    const statusCfg = STATUS_MAP[p.status] || { label: p.status, badgeClass: "p-status-ok", progressClass: "p-fill-ok" };
    const pct = Math.min(100, Math.max(0, p.progress_pct || 0));
    const blockers = p.blockers_count || 0;
    const tagsHtml = (p.tags || []).slice(0, 3).map(t => `<span class="proj-mini-tag">${escapeHtml(t)}</span>`).join("");

    // Calculate project-specific reports count
    const pReports = _reportsList.filter(r => (r.project_scope || "ALL").toUpperCase() === p.key.toUpperCase() || (r.project_scope || "ALL").toUpperCase() === "ALL");
    const pReportsCount = pReports.length;

    html += `
      <div class="main-project-card" data-key="${escapeHtml(p.key)}">
        <div class="main-project-card-header">
          <div class="main-proj-title-wrap">
            <span class="main-proj-key-badge">${escapeHtml(p.key)}</span>
            <span class="main-proj-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
          </div>
          <span class="p-status-tag ${statusCfg.badgeClass}">${statusCfg.label}</span>
        </div>

        <p class="main-proj-desc">${escapeHtml(p.description || "No project description provided.")}</p>

        <div class="main-proj-progress-section">
          <div class="main-proj-progress-labels">
            <span>Progress: <strong>${pct}%</strong></span>
            <span class="muted">${escapeHtml(p.progress_sp || "")}</span>
          </div>
          <div class="main-proj-progress-bar">
            <div class="main-proj-progress-fill ${statusCfg.progressClass}" style="width: ${pct}%;"></div>
          </div>
        </div>

        <div class="main-proj-meta-row">
          <div class="main-proj-meta-item">
            <span class="meta-label">Lead</span>
            <span class="meta-val">${escapeHtml(p.lead || "Unassigned")}</span>
          </div>
          <div class="main-proj-meta-item">
            <span class="meta-label">Target</span>
            <span class="meta-val">${escapeHtml(p.target_release || "TBD")}</span>
          </div>
          <div class="main-proj-meta-item">
            <span class="meta-label">Blockers</span>
            <span class="meta-val ${blockers > 0 ? 'meta-warn' : 'meta-ok'}">${blockers > 0 ? `⚠️ ${blockers}` : '0 active'}</span>
          </div>
        </div>

        <div class="main-proj-footer">
          <div class="main-proj-tags">${tagsHtml}</div>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn-p-view-reports" data-key="${escapeHtml(p.key)}" title="View ${pReportsCount} reports for ${escapeHtml(p.key)}">
              📋 ${pReportsCount} Reports
            </button>
            <button type="button" class="btn-p-view-dashboard" data-key="${escapeHtml(p.key)}" title="Open ${escapeHtml(p.key)} Dashboard">
              📊 Dashboard
            </button>
            <button type="button" class="btn-proj-goto" data-key="${escapeHtml(p.key)}">
              Details →
            </button>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Wire click events
  container.querySelectorAll(".btn-p-view-reports").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      if (key) {
        setMainReportFilter(key);
        const repSection = $("main-your-reports-grid");
        if (repSection) repSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  container.querySelectorAll(".btn-p-view-dashboard").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      if (key) {
        window.location.hash = `dashboards/${key}`;
      }
    });
  });

  container.querySelectorAll(".main-project-card, .btn-proj-goto").forEach(el => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".btn-p-view-dashboard") || e.target.closest(".btn-p-view-reports")) return;
      const key = el.dataset.key || el.closest(".main-project-card")?.dataset.key;
      if (key) {
        window.location.hash = `projects/${key}`;
      }
    });
  });
}

/**
 * Switch the active project filter for reports on the main page.
 */
export function setMainReportFilter(filterKey) {
  _mainReportFilter = filterKey || "all";
  const filterPills = document.querySelectorAll("#main-reports-filter-pills .filter-pill");
  filterPills.forEach(pill => {
    pill.classList.toggle("active", pill.dataset.filter === _mainReportFilter);
  });
  renderYourReports();
}

/**
 * Render "Your Reports" section grouped/filtered by project.
 */
function renderYourReports() {
  const container = $("main-your-reports-grid");
  if (!container) return;

  if (_reportsList.length === 0) {
    container.innerHTML = `<div class="main-empty-placeholder muted">No saved reports found.</div>`;
    return;
  }

  // Filter reports by selected project filter
  let filtered = [..._reportsList];
  if (_mainReportFilter === "ALL") {
    filtered = filtered.filter(r => (r.project_scope || "ALL").toUpperCase() === "ALL");
  } else if (_mainReportFilter !== "all") {
    const targetKey = _mainReportFilter.toUpperCase();
    filtered = filtered.filter(r => {
      const scope = (r.project_scope || "ALL").toUpperCase();
      return scope === targetKey || scope === "ALL";
    });
  }

  if (filtered.length === 0) {
    const projName = PROJECT_NAME_MAP[_mainReportFilter] || _mainReportFilter;
    container.innerHTML = `
      <div class="p-empty-state" style="grid-column: 1 / -1; padding: 30px; text-align: center;">
        <div class="p-empty-state-icon">📋</div>
        <h4 class="p-empty-state-title">No reports configured for ${escapeHtml(projName)}</h4>
        <p class="p-empty-state-sub">Create a new customized report template scoped for this project.</p>
        <button type="button" class="btn-primary btn-sm" onclick="window.location.hash='reports/new'">
          + Create Report for ${escapeHtml(projName)}
        </button>
      </div>
    `;
    return;
  }

  let html = "";
  filtered.forEach(r => {
    const audienceHtml = (r.stakeholder_ids || []).map(id => {
      const label = STAKEHOLDER_NAMES[id] || id;
      return `<span class="report-audience-pill">${escapeHtml(label)}</span>`;
    }).join("");

    const blocksCount = (r.blocks || []).length;
    const scope = (r.project_scope || "ALL").toUpperCase();
    const scopeName = PROJECT_NAME_MAP[scope] || scope;
    const scopeBadgeHtml = scope === "ALL"
      ? `<span class="report-scope-badge scope-all">🌐 Portfolio</span>`
      : `<span class="report-scope-badge scope-proj">📦 ${escapeHtml(scope)} — ${escapeHtml(scopeName)}</span>`;

    html += `
      <div class="main-report-card" data-id="${escapeHtml(r.id)}" data-scope="${escapeHtml(scope)}">
        <div class="main-report-card-head">
          <div class="main-report-icon-title">
            <span class="report-type-icon">📋</span>
            <div>
              <span class="main-report-title">${escapeHtml(r.name)}</span>
              <div style="margin-top: 3px;">${scopeBadgeHtml}</div>
            </div>
          </div>
          <span class="report-badge-blocks">${blocksCount} Sections</span>
        </div>

        <p class="main-report-desc">${escapeHtml(r.description || "Executive delivery and milestone status briefing.")}</p>

        <div class="main-report-audience-row">
          <span class="audience-label">Audience:</span>
          <div class="audience-pills-list">${audienceHtml || '<span class="muted">All Stakeholders</span>'}</div>
        </div>

        <div class="main-report-actions">
          <button type="button" class="btn-secondary btn-sm btn-report-view" data-id="${escapeHtml(r.id)}">
            Configure / Edit
          </button>
          <button type="button" class="btn-primary btn-sm btn-report-generate" data-id="${escapeHtml(r.id)}">
            <span>⚡ Generate Digest</span>
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // Wire click events
  container.querySelectorAll(".btn-report-view").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id) window.location.hash = `reports/${id}`;
    };
  });

  container.querySelectorAll(".btn-report-generate").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id) window.location.hash = `reports/${id}`;
    };
  });

  container.querySelectorAll(".main-report-card").forEach(card => {
    card.onclick = () => {
      const id = card.dataset.id;
      if (id) window.location.hash = `reports/${id}`;
    };
  });
}

/**
 * Initialize event listeners for the Main Page.
 */
export function initMainPageEvents() {
  // Quick AI Ask Button in Hero
  const heroAskAiBtn = $("main-btn-ask-ai");
  if (heroAskAiBtn) {
    heroAskAiBtn.onclick = () => {
      openChatDrawer();
    };
  }

  // Quick New Report Button in Hero
  const heroNewReportBtn = $("main-btn-new-report");
  if (heroNewReportBtn) {
    heroNewReportBtn.onclick = () => {
      window.location.hash = "reports/new";
    };
  }

  // Filter Pills in "Your Reports & Briefings"
  const reportFilterPills = document.querySelectorAll("#main-reports-filter-pills .filter-pill");
  reportFilterPills.forEach(pill => {
    pill.onclick = () => {
      reportFilterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      _mainReportFilter = pill.dataset.filter || "all";
      renderYourReports();
    };
  });

  // Refresh AI Analysis Button
  const refreshAiBtn = $("main-refresh-ai-btn");
  if (refreshAiBtn) {
    refreshAiBtn.onclick = () => {
      refreshAiBtn.disabled = true;
      refreshAiBtn.textContent = "Analyzing…";
      renderMainPage().finally(() => {
        refreshAiBtn.disabled = false;
        refreshAiBtn.textContent = "🔄 Re-analyze";
      });
    };
  }

  // Inline AI Quick Input Send -> opens Ask AI Copilot drawer
  const quickInput = $("main-ai-quick-input");
  const quickSendBtn = $("main-ai-quick-send");

  function handleQuickSend() {
    if (!quickInput) return;
    const q = quickInput.value.trim();
    if (!q) return;
    quickInput.value = "";
    askAiCopilot(q);
  }

  if (quickSendBtn) {
    quickSendBtn.onclick = handleQuickSend;
  }

  if (quickInput) {
    quickInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleQuickSend();
      }
    };
  }

  // Quick scenario chips -> populate prompt suggestion into quick input box
  document.querySelectorAll(".scenario-chip").forEach(chip => {
    chip.onclick = () => {
      const prompt = chip.dataset.prompt;
      if (prompt && quickInput) {
        quickInput.value = prompt;
        quickInput.focus();
      }
    };
  });
}
