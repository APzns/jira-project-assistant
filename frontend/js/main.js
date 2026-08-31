import { $, setText, show, hide, escapeHtml, fmtDate } from "./utils.js";
import { API_BASE, ENV, state } from "./state.js";
import { assessRisks, forecastDelivery, sprintPlanning } from "./skills.js";
import { fetchWithTimeout, fetchAssessment, fetchStatsSummary, fetchProjects } from "./api.js";
import { renderAssessmentTab } from "./views/assessment.js";
import { renderStatusTab } from "./views/status.js";
import { renderDeliveryTab } from "./views/delivery.js";
import { renderQualityTab } from "./views/quality.js";
import { renderStakeholdersPage, initStakeholdersEvents, showStakeholdersList, showStakeholderDetail, showStakeholderForm } from "./views/stakeholders.js";
import { renderProjectsPage, openProjectDetailByKey, initProjectsEvents } from "./views/projects.js";
import { initAssistantPage, sendAssistantMessage } from "./views/assistant.js";
import { renderMainPage, initMainPageEvents } from "./views/main_view.js";
import { initChatEvents, openChatDrawer, closeChatDrawer, collapseChatDrawer, toggleChatSidebar, askAiCopilot, askQuestion } from "./chat.js";
export { openChatDrawer, closeChatDrawer, collapseChatDrawer, toggleChatSidebar, askAiCopilot, askQuestion };
import {
  analyzeStatus, proposeNextSteps, generateReport,
  renderAnalyzeStatus, renderProposeNextSteps, renderGenerateReport,
  renderAnalyzeStatusInTab, renderNextStepsInTab, renderGenerateReportInTab,
  openSettingsDrawer, closeSettingsDrawer,
  loadSettings, saveSettings, resetSettings, readSettingsForm,
  populatePaSettings, readPaAiSettingsForm, readPaSettingsForm, saveComposerTemplate,
  renderReportsPage, openReportDetail
} from "./skills.js";

/* ---------- Main Navigation Router ---------- */
function navigate(hash) {
  if (!hash || hash === "#" || hash === "#main" || hash === "#home" || hash === "#main-view") hash = "#main";
  const cleanHash = hash.replace(/^#\/?/, "");
  const parts = cleanHash.split("/");
  let navKey = parts[0] || "main";
  const subRoute = parts[1];

  const brandBtn = $("sidebar-brand-btn");
  let btn = document.querySelector(`.sidebar-nav .nav-btn[data-nav="${navKey}"]`);

  if (navKey === "main") {
    if (brandBtn) brandBtn.classList.add("active");
  } else {
    if (brandBtn) brandBtn.classList.remove("active");
  }

  if (!btn && navKey !== "main") {
    navKey = "main";
    btn = document.querySelector(`.sidebar-nav .nav-btn[data-nav="main"]`);
    if (brandBtn) brandBtn.classList.add("active");
  }

  document.querySelectorAll(".sidebar-nav .nav-btn").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".nav-page").forEach(p => p.classList.remove("active"));

  if (btn) btn.classList.add("active");
  const targetPage = $("page-" + navKey);
  if (targetPage) targetPage.classList.add("active");

  const headerWrap = $("dashboards-header-wrap");
  const dirView = $("dashboards-directory-view");
  const detailView = $("dashboards-detail-view");

  // Dashboards multi-project sub-routing
  if (navKey === "dashboards") {
    const DASHBOARD_TABS = new Set(["assessment", "status", "delivery", "quality", "assistant"]);

    if (!subRoute) {
      // Entry mode: Show Project Dashboards Directory Hub
      if (headerWrap) headerWrap.style.display = "none";
      if (detailView) detailView.style.display = "none";
      if (dirView) dirView.style.display = "block";
      renderDashboardsDirectory();
    } else {
      // Specific Project Dashboard View: Show Toolbar + Tabs + Detail
      if (dirView) dirView.style.display = "none";
      if (headerWrap) headerWrap.style.display = "block";
      if (detailView) detailView.style.display = "block";

      let targetProject = state.currentProject || "CORE";
      let targetTab = null;

      if (DASHBOARD_TABS.has(subRoute.toLowerCase())) {
        targetTab = subRoute.toLowerCase();
      } else {
        targetProject = subRoute.toUpperCase().trim();
        if (parts[2] && DASHBOARD_TABS.has(parts[2].toLowerCase())) {
          targetTab = parts[2].toLowerCase();
        }
      }

      state.currentProject = targetProject;

      if (targetTab) {
        const tabBtn = document.querySelector(`.tabs .tab[data-tab="${targetTab}"]`);
        if (tabBtn) {
          document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
          document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
          tabBtn.classList.add("active");
          const panel = $("tab-" + targetTab);
          if (panel) panel.classList.add("active");
        }
      }

      const activeTab = document.querySelector(".tab.active");
      if (activeTab) {
        if (activeTab.dataset.tab === "delivery" && state.teamPointsChart) state.teamPointsChart.resize();
        if (activeTab.dataset.tab === "assessment" && state.monteCarloChart) state.monteCarloChart.resize();
        if (activeTab.dataset.tab === "quality" && state.qualityByTeamChart) state.qualityByTeamChart.resize();
      }

      populateDashboardProjectSelector().then(() => {
        loadDashboardForProject(state.currentProject);
      });
    }
  } else {
    if (headerWrap) headerWrap.style.display = "none";
  }

  // Multi-Project Main Page
  if (navKey === "main") {
    renderMainPage();
  }

  // Conversational Assistant
  if (navKey === "assistant") {
    initAssistantPage();
  }

  // Settings Page
  if (navKey === "settings") {
    renderSettingsPage();
  }

  // Reports sub-routing (dedicated list view and detail view)
  if (navKey === "reports") {
    if (subRoute === "new") {
      renderReportsPage().then(() => openReportDetail(null));
    } else if (subRoute) {
      renderReportsPage().then(() => openReportDetail(subRoute));
    } else {
      renderReportsPage();
    }
  }

  // Stakeholders sub-routing (dedicated pages)
  if (navKey === "stakeholders") {
    if (subRoute === "new") {
      renderStakeholdersPage().then(() => showStakeholderForm());
    } else if (subRoute === "edit" && parts[2]) {
      renderStakeholdersPage().then(() => showStakeholderDetail(parts[2]));
    } else if (subRoute) {
      renderStakeholdersPage().then(() => showStakeholderDetail(subRoute));
    } else {
      renderStakeholdersPage().then(() => showStakeholdersList());
    }
  }

  // Projects sub-routing
  if (navKey === "projects") {
    if (subRoute) {
      openProjectDetailByKey(subRoute);
    } else {
      const pList = $("projects-list-view");
      const pDetail = $("project-detail-view");
      if (pDetail) pDetail.style.display = "none";
      if (pList) pList.style.display = "block";
      renderProjectsPage();
    }
  }
}


/* ---------- Sidebar Navigation Events ---------- */
function initSidebarNav() {
  const sidebarNav = document.querySelector(".sidebar-nav");
  if (sidebarNav) {
    sidebarNav.addEventListener("click", (e) => {
      const btn = e.target.closest(".nav-btn");
      if (!btn) return;
      e.preventDefault();
      const navKey = btn.dataset.nav;
      if (!navKey) return;

      const targetHash = `#${navKey}`;
      if (window.location.hash === targetHash) {
        navigate(targetHash);
      } else {
        window.location.hash = targetHash;
      }
    });
  }

  const brandBtn = $("sidebar-brand-btn");
  if (brandBtn) {
    brandBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (window.location.hash === "#main" || window.location.hash === "" || window.location.hash === "#") {
        navigate("#main");
      } else {
        window.location.hash = "#main";
      }
    });
  }

  const topbarBrandBtn = $("topbar-brand-btn");
  if (topbarBrandBtn) {
    topbarBrandBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (window.location.hash === "#main" || window.location.hash === "" || window.location.hash === "#") {
        navigate("#main");
      } else {
        window.location.hash = "#main";
      }
    });
    topbarBrandBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        window.location.hash = "#main";
      }
    });
  }
}

/* ---------- Tab switching (inside Dashboards) ---------- */
function initTabSwitching() {
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      const panel = $("tab-" + tab.dataset.tab);
      if (panel) panel.classList.add("active");

      if (tab.dataset.tab === "delivery" && state.teamPointsChart) state.teamPointsChart.resize();
      if (tab.dataset.tab === "assessment" && state.monteCarloChart) state.monteCarloChart.resize();
      if (tab.dataset.tab === "quality" && state.qualityByTeamChart) state.qualityByTeamChart.resize();
      // Load PA settings into embedded form when the tab is first activated
      if (tab.dataset.tab === "assistant") populatePaSettings();
    });
  });
}

window.addEventListener("hashchange", () => navigate(window.location.hash));

function onReady() {
  initSidebarNav();
  initTabSwitching();
  initMainPageEvents();
  initStakeholdersEvents();
  initProjectsEvents();
  initDashboardsDirectoryEvents();

  $("dashboard-project-select")?.addEventListener("change", (e) => {
    const newKey = e.target.value;
    if (newKey) {
      state.currentProject = newKey;
      window.location.hash = `dashboards/${newKey}`;
    }
  });

  $("dashboard-btn-project-overview")?.addEventListener("click", () => {
    const pkey = state.currentProject;
    if (!pkey || pkey === "ALL") {
      window.location.hash = "#projects";
    } else {
      window.location.hash = `#projects/${pkey}`;
    }
  });

  $("assess-button")?.addEventListener("click", () => {
    loadDashboardForProject(state.currentProject || "CORE", true);
  });

  navigate(window.location.hash || "#main");
}


if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", onReady);
} else {
  onReady();
}

/* ---------- Dashboards Directory (Operational Telemetry Hub) ---------- */
let _telemetryProjectsList = [];
let _telemetryFilterQuery = "";
let _telemetrySortMode = "default";

function initDashboardsDirectoryEvents() {
  const searchInput = $("dashboards-dir-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      _telemetryFilterQuery = e.target.value;
      applyDashboardsDirectoryFilter();
    });
  }

  // Sort pills
  document.querySelectorAll("#telemetry-sort-pills .telemetry-pill").forEach(pill => {
    pill.addEventListener("click", () => {
      document.querySelectorAll("#telemetry-sort-pills .telemetry-pill").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      _telemetrySortMode = pill.dataset.sort || "default";
      applyDashboardsDirectoryFilter();
    });
  });

  $("dashboard-btn-back-dir")?.addEventListener("click", () => {
    window.location.hash = "dashboards";
  });
}

async function renderDashboardsDirectory() {
  const container = $("dashboards-telemetry-container");
  if (!container) return;

  try {
    const res = await fetchWithTimeout(`${API_BASE}/stats/telemetry`, { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      _telemetryProjectsList = data.telemetry || [];
    } else {
      // Fallback to cached projects
      if (!state.projectsCache || state.projectsCache.length === 0) {
        const pRes = await fetchProjects(false);
        state.projectsCache = pRes.projects || [];
      }
      _telemetryProjectsList = state.projectsCache || [];
    }
  } catch (err) {
    console.error("Failed to load telemetry for dashboards hub:", err);
    if (state.projectsCache) _telemetryProjectsList = state.projectsCache;
  }

  applyDashboardsDirectoryFilter();
}

function applyDashboardsDirectoryFilter() {
  const container = $("dashboards-telemetry-container");
  if (!container) return;

  const query = (_telemetryFilterQuery || "").toLowerCase().trim();
  let list = [..._telemetryProjectsList];

  // Apply search query
  if (query) {
    list = list.filter(p => {
      const name = (p.name || "").toLowerCase();
      const key = (p.key || "").toLowerCase();
      const lead = (p.lead || "").toLowerCase();
      const tags = (p.tags || []).join(" ").toLowerCase();
      return name.includes(query) || key.includes(query) || lead.includes(query) || tags.includes(query);
    });
  }

  // Apply sorting
  if (_telemetrySortMode === "delay") {
    list.sort((a, b) => (b.mc_delay_days || 0) - (a.mc_delay_days || 0));
  } else if (_telemetrySortMode === "predictability") {
    list.sort((a, b) => (a.predictability_pct || 0) - (b.predictability_pct || 0));
  } else if (_telemetrySortMode === "defects") {
    list.sort((a, b) => (b.unresolved_bugs || 0) - (a.unresolved_bugs || 0));
  } else if (_telemetrySortMode === "ontrack") {
    list = list.filter(p => (p.status || "").toLowerCase() === "on-track");
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="main-empty-placeholder muted" style="padding: 40px; text-align: center;">
        No project telemetry found matching your criteria.
      </div>
    `;
    return;
  }

  const STATUS_MAP = {
    "on-track": { label: "ON TRACK", badgeClass: "p-status-ok", progressClass: "p-fill-ok" },
    "at-risk": { label: "AT RISK", badgeClass: "p-status-warn", progressClass: "p-fill-warn" },
    "delayed": { label: "DELAYED", badgeClass: "p-status-warn", progressClass: "p-fill-warn" },
    "planning": { label: "IN PLANNING", badgeClass: "p-status-ok", progressClass: "p-fill-ok" },
    "completed": { label: "COMPLETED", badgeClass: "p-status-ok", progressClass: "p-fill-ok" }
  };

  let html = `<div class="dashboards-telemetry-grid">`;
  list.forEach(p => {
    const statusCfg = STATUS_MAP[p.status] || { label: (p.status || "on-track").toUpperCase(), badgeClass: "p-status-ok", progressClass: "p-fill-ok" };
    const pct = Math.min(100, Math.max(0, p.progress_pct || 0));
    const delayDays = p.mc_delay_days || 0;
    const predPct = (p.predictability_pct !== undefined && p.predictability_pct !== null) ? p.predictability_pct : null;
    const bugs = p.unresolved_bugs || 0;
    const blockers = p.blockers_count || 0;

    // Forecast label
    let forecastLabel = "On-Time";
    let forecastClass = "ontrack";
    if (delayDays > 0) {
      forecastLabel = `+${delayDays}d Delay`;
      forecastClass = "delayed";
    } else if (delayDays < 0) {
      forecastLabel = `${Math.abs(delayDays)}d Buffer`;
      forecastClass = "ontrack";
    }

    // Predictability badge
    let predClass = "high";
    let predLabel = "Predictable";
    let predDisplay = `${predPct}% (${predLabel})`;
    if (predPct === null) {
      predClass = "neutral";
      predLabel = "Pending Sprints";
      predDisplay = "N/A (No Closed Sprints)";
    } else if (predPct < 50) {
      predClass = "low";
      predLabel = "Volatile";
      predDisplay = `${predPct}% (${predLabel})`;
    } else if (predPct < 75) {
      predClass = "mid";
      predLabel = "Moderate";
      predDisplay = `${predPct}% (${predLabel})`;
    }

    html += `
      <div class="telemetry-card" data-key="${escapeHtml(p.key)}">
        <div class="telemetry-card-top">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="p-key-badge">${escapeHtml(p.key)}</span>
          </div>
          <span class="p-status-tag ${statusCfg.badgeClass}">
            <span class="p-status-dot"></span>
            ${statusCfg.label}
          </span>
        </div>

        <h3 class="telemetry-card-title">${escapeHtml(p.name)}</h3>
        <p class="telemetry-card-desc">${escapeHtml(p.description || "Operational telemetry stream.")}</p>

        <!-- 4-Box Telemetry Matrix -->
        <div class="telemetry-metrics-matrix">
          <div class="telemetry-metric-box">
            <span class="telemetry-box-label">Monte Carlo Forecast</span>
            <span class="mc-delay-tag ${forecastClass}">
              ${forecastClass === "delayed" ? "▲" : "🎯"} ${forecastLabel}
            </span>
            <span class="muted" style="font-size: 11px;">P50: ${p.mc_p50_date ? escapeHtml(p.mc_p50_date) : "Target"}</span>
          </div>

          <div class="telemetry-metric-box">
            <span class="telemetry-box-label">Predictability</span>
            <span class="pred-score-tag ${predClass}">
              📊 ${predDisplay}
            </span>
            <span class="muted" style="font-size: 11px;">Commit vs Done</span>
          </div>

          <div class="telemetry-metric-box">
            <span class="telemetry-box-label">Quality Defects</span>
            <span class="telemetry-box-val" style="color: ${bugs > 0 ? 'var(--amber, #f59e0b)' : 'var(--text)'};">
              🐛 ${bugs} ${bugs === 1 ? 'Open Bug' : 'Open Bugs'}
            </span>
            <span class="muted" style="font-size: 11px;">Active issues</span>
          </div>

          <div class="telemetry-metric-box">
            <span class="telemetry-box-label">Cross-Team Blockers</span>
            <span class="telemetry-box-val" style="color: ${blockers > 0 ? '#ef4444' : 'var(--text)'};">
              🔒 ${blockers} ${blockers === 1 ? 'Blocker' : 'Blockers'}
            </span>
            <span class="muted" style="font-size: 11px;">Dependency link</span>
          </div>
        </div>

        <!-- Progress Bar -->
        <div style="margin-bottom: 14px;">
          <div style="display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 5px;">
            <span>Scope Delivery: <strong>${pct}%</strong></span>
            <span class="muted">${escapeHtml(p.progress_sp || "")}</span>
          </div>
          <div class="main-proj-progress-bar" style="height: 6px;">
            <div class="main-proj-progress-fill ${statusCfg.progressClass}" style="width: ${pct}%;"></div>
          </div>
        </div>

        <div class="p-tags" style="margin-bottom: 14px; display: flex; flex-wrap: wrap; gap: 6px;">
          ${(p.tags || []).slice(0, 4).map(t => `<span class="p-tag">${escapeHtml(t)}</span>`).join("")}
        </div>

        <div class="p-card-quick-actions">
          <button type="button" class="btn-proj-goto btn-p-goto-details" data-key="${escapeHtml(p.key)}" title="View AI Assessment & Telemetry Details">
            Details →
          </button>
        </div>
      </div>
    `;
  });
  html += `</div>`;

  container.innerHTML = html;

  // Wire click events (only on buttons, not whole card)
  container.querySelectorAll(".btn-p-goto-details").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.key;
      if (key) {
        window.location.hash = `dashboards/${key}/assessment`;
      }
    });
  });
}

/* ---------- Projects Filter & Search ---------- */
function initProjectsFilter() {
  const searchInput = $("project-search-input");
  const filterPills = document.querySelectorAll("#project-filter-pills .filter-pill");
  const cards = document.querySelectorAll(".project-card");

  let activeFilter = "all";
  let searchQuery = "";

  function applyFilters() {
    cards.forEach(card => {
      const status = card.dataset.status;
      const key = (card.dataset.key || "").toLowerCase();
      const name = (card.querySelector(".p-title")?.textContent || "").toLowerCase();
      const desc = (card.querySelector(".p-desc")?.textContent || "").toLowerCase();

      const matchesFilter = activeFilter === "all" ||
        (activeFilter === "on-track" && status === "on-track") ||
        (activeFilter === "at-risk" && (status === "at-risk" || status === "delayed")) ||
        (activeFilter === "planning" && status === "planning");

      const matchesSearch = !searchQuery ||
        key.includes(searchQuery) ||
        name.includes(searchQuery) ||
        desc.includes(searchQuery);

      card.style.display = (matchesFilter && matchesSearch) ? "flex" : "none";
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      applyFilters();
    });
  }

  filterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      filterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeFilter = pill.dataset.filter || "all";
      applyFilters();
    });
  });
}
initProjectsFilter();

/* ---------- Master Render ---------- */
function renderAll(d, projectKey = "ALL", projectObj = null) {
  if (!d) return;
  renderAssessmentTab(d, projectKey, projectObj);
  renderStatusTab(d, projectKey, projectObj);
  renderDeliveryTab(d, projectKey, projectObj);
  renderQualityTab(d, projectKey, projectObj);
}

/* ---------- Project Dashboard Selector & Loaders ---------- */
async function populateDashboardProjectSelector() {
  const select = $("dashboard-project-select");
  if (!select) return;

  try {
    if (!state.projectsCache || state.projectsCache.length === 0) {
      const res = await fetchProjects(true);
      state.projectsCache = (res.projects || []).filter(p => p.key && p.key.toUpperCase() !== "HRZ");
    }
  } catch (e) {
    console.error("Failed to load projects list for dropdown:", e);
  }

  const projects = (state.projectsCache || []).filter(p => p.key && p.key.toUpperCase() !== "HRZ");
  let currentVal = (state.currentProject || "ALL").toUpperCase();
  if (currentVal !== "ALL" && !projects.some(p => p.key.toUpperCase() === currentVal)) {
    currentVal = projects.length > 0 ? projects[0].key : "CORE";
    state.currentProject = currentVal;
  }

  let optionsHtml = `<option value="ALL" ${currentVal === "ALL" ? "selected" : ""}>🌐 Portfolio Overview (All Projects)</option>`;
  projects.forEach(p => {
    const isArchived = Boolean(p.archived);
    optionsHtml += `<option value="${escapeHtml(p.key)}" ${p.key.toUpperCase() === currentVal ? "selected" : ""}>
      ${escapeHtml(p.name)} (${escapeHtml(p.key)})${isArchived ? " [Archived]" : ""}
    </option>`;
  });

  select.innerHTML = optionsHtml;
  select.value = currentVal;
  updateDashboardProjectMeta(currentVal);
}

function updateDashboardProjectMeta(projectKey) {
  const keyPill = $("dashboard-meta-key");
  const statusPill = $("dashboard-meta-status");
  const leadEl = $("dashboard-meta-lead");
  const releaseEl = $("dashboard-meta-release");

  const projectObj = (state.projectsCache || []).find(p => p.key.toUpperCase() === (projectKey || "").toUpperCase());

  if (keyPill) keyPill.textContent = projectKey || "ALL";
  
  if (statusPill) {
    if (!projectObj || projectKey === "ALL") {
      statusPill.className = "dashboards-meta-pill status-pill on-track";
      statusPill.textContent = "PORTFOLIO OVERVIEW";
    } else {
      const st = (projectObj.status || "on-track").toLowerCase();
      statusPill.className = `dashboards-meta-pill status-pill ${st}`;
      statusPill.textContent = st.replace("-", " ").toUpperCase();
    }
  }

  if (leadEl) {
    leadEl.textContent = (projectObj && projectObj.lead) ? projectObj.lead : (projectKey === "ALL" ? "Portfolio PMO" : "Project Lead");
  }

  if (releaseEl) {
    releaseEl.textContent = (projectObj && projectObj.target_release) ? projectObj.target_release : (projectKey === "ALL" ? "Multi-Release Program" : "Target Release");
  }
}

async function loadDashboardForProject(projectKey = "ALL", forceRefresh = false) {
  state.currentProject = projectKey;
  updateDashboardProjectMeta(projectKey);

  const btn = $("assess-button");
  if (forceRefresh && btn) {
    btn.disabled = true;
    btn.textContent = "Analyzing…";
  }

  const mode = ($("mode-toggle") && $("mode-toggle").checked) ? "synthetic" : "real";
  const cacheKey = `${mode}_${projectKey}`;

  // Check client-side in-memory cache first for instant project switching
  if (!forceRefresh && state.dashboardDataCache && state.dashboardDataCache[cacheKey]) {
    const d = state.dashboardDataCache[cacheKey];
    const projectObj = (state.projectsCache || []).find(p => p.key.toUpperCase() === (projectKey || "").toUpperCase());
    renderAll(d, projectKey, projectObj);
    return;
  }

  try {
    const d = await fetchAssessment(mode, forceRefresh, projectKey);
    const projectObj = (state.projectsCache || []).find(p => p.key.toUpperCase() === (projectKey || "").toUpperCase());

    if (d && !d.error) {
      if (!state.dashboardDataCache) state.dashboardDataCache = {};
      state.dashboardDataCache[cacheKey] = d;
      renderAll(d, projectKey, projectObj);
    } else if (d && d.error) {
      setText("assess-error", "Error: " + d.error);
      show("assess-error");
    } else {
      show("assess-empty");
    }
  } catch (e) {
    console.error(`Dashboard load failed for project ${projectKey}:`, e);
    setText("assess-error", `Could not load assessment for project ${projectKey}: ` + e.message);
    show("assess-error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Refresh report";
    }
  }
}

async function loadCachedAssessment(mode = "real") {
  return loadDashboardForProject(state.currentProject || "CORE", false);
}

async function refreshAssessment() {
  return loadDashboardForProject(state.currentProject || "CORE", true);
}


async function loadFreshness() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/stats/summary`, { credentials: "include" }, 45000);
    if (!res.ok) return;
    const data = await res.json();
    setText("data-freshness", "Data as of " + fmtDate(data.last_ingested));
  } catch (e) { /* leave default */ }
}

/* ---------- App Initialization & Documentation ---------- */
async function loadDocs() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/docs-data`);
    const d = await res.json();
    const container = $("docs-content");
    hide("docs-status");
    if (!container) return;
    container.innerHTML = "";
    (d.files || []).forEach(f => {
      const html = window.marked ? marked.parse(f.content) : `<pre>${escapeHtml(f.content)}</pre>`;
      container.insertAdjacentHTML("beforeend", html + "<hr/>");
    });
  } catch (e) {
    setText("docs-status", "Could not load documentation.");
  }
}

/* ---------- App Initialization ---------- */
const assessBtn = $("assess-button");
if (assessBtn) {
  if (ENV === "production") {
    assessBtn.style.display = "none";
    const assessEmpty = $("assess-empty");
    if (assessEmpty) assessEmpty.textContent = "No report available.";
  } else {
    assessBtn.addEventListener("click", refreshAssessment);
  }
}

initChatEvents("ask-input", "ask-button");
loadFreshness();
loadCachedAssessment("real");
loadDocs();

/* ---------- Skills Toolbar ---------- */
function _setSkillBtnLoading(btnId, loading, originalText) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.originalText = btn.querySelector(".skill-btn-text")?.textContent || "";
    const span = btn.querySelector(".skill-btn-text");
    if (span) span.textContent = "Running…";
  } else {
    const span = btn.querySelector(".skill-btn-text");
    if (span && btn.dataset.originalText) span.textContent = btn.dataset.originalText;
  }
}

const skillBtnAnalyze = $("skill-btn-analyze");
if (skillBtnAnalyze) {
  skillBtnAnalyze.addEventListener("click", async () => {
    _setSkillBtnLoading("skill-btn-analyze", true);
    try {
      const data = await analyzeStatus();
      renderAnalyzeStatus(data);
    } catch (e) {
      const panel = $("skill-output-panel");
      if (panel) {
        panel.innerHTML = `<div class="skill-output-header"><span class="skill-output-label">🔍 Analyze Status</span><button class="skill-output-close" onclick="this.closest('.skill-output-panel').classList.remove('visible')">✕</button></div><div class="skill-output-body"><p class="skill-empty">⚠️ ${escapeHtml(e.message)}</p></div>`;
        panel.classList.add("visible");
      }
    } finally {
      _setSkillBtnLoading("skill-btn-analyze", false);
    }
  });
}

const skillBtnNextSteps = $("skill-btn-nextsteps");
if (skillBtnNextSteps) {
  skillBtnNextSteps.addEventListener("click", async () => {
    _setSkillBtnLoading("skill-btn-nextsteps", true);
    try {
      const data = await proposeNextSteps();
      renderProposeNextSteps(data);
    } catch (e) {
      const panel = $("skill-output-panel");
      if (panel) {
        panel.innerHTML = `<div class="skill-output-header"><span class="skill-output-label">▶ Next Steps</span><button class="skill-output-close" onclick="this.closest('.skill-output-panel').classList.remove('visible')">✕</button></div><div class="skill-output-body"><p class="skill-empty">⚠️ ${escapeHtml(e.message)}</p></div>`;
        panel.classList.add("visible");
      }
    } finally {
      _setSkillBtnLoading("skill-btn-nextsteps", false);
    }
  });
}

const skillBtnSettings = $("skill-btn-settings");
if (skillBtnSettings) skillBtnSettings.addEventListener("click", openSettingsDrawer);

/* ---------- Settings Drawer ---------- */
const settingsCloseBtn = $("settings-close-btn");
const settingsCancelBtn = $("settings-cancel-btn");
const settingsSaveBtn = $("settings-save-btn");
const settingsOverlay = $("settings-drawer-overlay");

if (settingsCloseBtn) settingsCloseBtn.addEventListener("click", closeSettingsDrawer);
if (settingsCancelBtn) settingsCancelBtn.addEventListener("click", closeSettingsDrawer);
if (settingsOverlay) settingsOverlay.addEventListener("click", closeSettingsDrawer);

if (settingsSaveBtn) {
  settingsSaveBtn.addEventListener("click", async () => {
    const msgEl = $("settings-save-msg");
    settingsSaveBtn.disabled = true;
    settingsSaveBtn.textContent = "Saving…";
    if (msgEl) msgEl.textContent = "";
    try {
      const newSettings = readSettingsForm();
      await saveSettings(newSettings);
      if (msgEl) { msgEl.textContent = "✓ Settings saved."; msgEl.className = "settings-save-msg settings-save-msg--ok"; }
      setTimeout(closeSettingsDrawer, 800);
    } catch (e) {
      if (msgEl) { msgEl.textContent = "⚠️ " + e.message; msgEl.className = "settings-save-msg settings-save-msg--err"; }
    } finally {
      settingsSaveBtn.disabled = false;
      settingsSaveBtn.textContent = "Save settings";
    }
  });
}

/* ============================================================
   PROJECT ASSISTANT TAB wiring
   ============================================================ */

function _setPaBtnLoading(btnId, running, label) {
  const btn = $(btnId);
  if (!btn) return;
  const lbl = btn.querySelector(".pa-btn-label");
  btn.disabled = running;
  if (lbl) lbl.textContent = running ? "Running…" : label;
  if (running) btn.classList.add("pa-card-btn--loading");
  else btn.classList.remove("pa-card-btn--loading");
}

function _paSetActiveCard(cardId) {
  document.querySelectorAll(".pa-skill-card").forEach(c => c.classList.remove("pa-skill-card--active"));
  const card = $(cardId);
  if (card) card.classList.add("pa-skill-card--active");
}

// — Analyze Status button
const paBtnAnalyze = $("pa-btn-analyze");
if (paBtnAnalyze) {
  paBtnAnalyze.addEventListener("click", async () => {
    _setPaBtnLoading("pa-btn-analyze", true, "Run");
    _paSetActiveCard("pa-card-analyze");
    try {
      const data = await analyzeStatus();
      renderAnalyzeStatusInTab(data);
    } catch (e) {
      const content = $("pa-tab-results-content") || $("pa-results-content");
      const placeholder = $("pa-tab-placeholder") || $("pa-placeholder");
      if (content) {
        if (placeholder) placeholder.style.display = "none";
        content.innerHTML = `<p class="skill-empty">⚠️ ${escapeHtml(e.message)}</p>`;
        content.style.display = "block";
        ($("pa-tab-results") || $("pa-results"))?.classList.remove("pa-results--empty");
      }
    } finally {
      _setPaBtnLoading("pa-btn-analyze", false, "Run");
    }
  });
}

// — Next Steps button
const paBtnNext = $("pa-btn-nextsteps");
if (paBtnNext) {
  paBtnNext.addEventListener("click", async () => {
    _setPaBtnLoading("pa-btn-nextsteps", true, "Run");
    _paSetActiveCard("pa-card-nextsteps");
    try {
      const data = await proposeNextSteps();
      renderNextStepsInTab(data);
    } catch (e) {
      const content = $("pa-tab-results-content") || $("pa-results-content");
      const placeholder = $("pa-tab-placeholder") || $("pa-placeholder");
      if (content) {
        if (placeholder) placeholder.style.display = "none";
        content.innerHTML = `<p class="skill-empty">⚠️ ${escapeHtml(e.message)}</p>`;
        content.style.display = "block";
        ($("pa-tab-results") || $("pa-results"))?.classList.remove("pa-results--empty");
      }
    } finally {
      _setPaBtnLoading("pa-btn-nextsteps", false, "Run");
    }
  });
}

// — AI Settings toggle (mobile: show/hide the sidebar)
const paSettingsToggle = $("pa-settings-toggle");
if (paSettingsToggle) {
  paSettingsToggle.addEventListener("click", () => {
    const panel = $("pa-settings-panel");
    if (panel) panel.classList.toggle("pa-settings-panel--open");
  });
}

// — PA embedded Save Settings
const paSaveBtn = $("pa-save-btn");
if (paSaveBtn) {
  paSaveBtn.addEventListener("click", async () => {
    const msgEl = $("pa-save-msg");
    paSaveBtn.disabled = true;
    paSaveBtn.textContent = "Saving…";
    if (msgEl) msgEl.textContent = "";
    try {
      const newSettings = readPaAiSettingsForm();
      await saveSettings(newSettings);
      if (msgEl) { msgEl.textContent = "✓ Saved."; msgEl.className = "settings-save-msg settings-save-msg--ok"; }
      setTimeout(() => { if (msgEl) msgEl.textContent = ""; }, 2000);
    } catch (e) {
      if (msgEl) { msgEl.textContent = "⚠️ " + e.message; msgEl.className = "settings-save-msg settings-save-msg--err"; }
    } finally {
      paSaveBtn.disabled = false;
      paSaveBtn.textContent = "Save settings";
    }
  });
}

// — Generate Report from settings panel / process flow
async function handleGenerateReportClick() {
  const btns = [ $("pa-btn-generate-report"), $("pa-btn-generate-bottom") ].filter(Boolean);
  btns.forEach(b => { b.disabled = true; b.textContent = "Generating..."; });

  try {
    const payload = readPaSettingsForm();
    const apiPayload = {
      profile_id: payload.template_id === "custom" ? undefined : payload.template_id,
      project_key: payload.project_scope === "ALL" ? undefined : payload.project_scope,
      settings_override: {
        stakeholder_ids: payload.stakeholder_ids,
        stakeholder_notes: payload.stakeholder_notes,
        blocks: payload.blocks,
        focus_epics: payload.project_scope === "ALL" ? [] : [payload.project_scope]
      }
    };
    const data = await generateReport(apiPayload);
    renderGenerateReportInTab(data);
  } catch (e) {
    console.error(e);
    alert("Error generating report: " + e.message);
  } finally {
    btns.forEach(b => {
      b.disabled = false;
      if (b.id === "pa-btn-generate-bottom") {
        b.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Generate Report Digest`;
      } else {
        b.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Generate Report`;
      }
    });
  }
}

const paBtnGenerateReport = $("pa-btn-generate-report");
if (paBtnGenerateReport) {
  paBtnGenerateReport.addEventListener("click", handleGenerateReportClick);
}

const paBtnGenerateBottom = $("pa-btn-generate-bottom");
if (paBtnGenerateBottom) {
  paBtnGenerateBottom.addEventListener("click", handleGenerateReportClick);
}

// — PA Composer Save
const paBtnComposerSave = $("pa-btn-composer-save");
if (paBtnComposerSave) {
  paBtnComposerSave.addEventListener("click", async () => {
    const msgEl = $("pa-composer-msg");
    paBtnComposerSave.disabled = true;
    paBtnComposerSave.textContent = "Saving...";
    if (msgEl) msgEl.textContent = "";
    try {
      await saveComposerTemplate();
      if (msgEl) { msgEl.textContent = "✓ Saved."; msgEl.className = "settings-save-msg settings-save-msg--ok"; }
      setTimeout(() => { if (msgEl) msgEl.textContent = ""; }, 2000);
    } catch (e) {
      if (msgEl) { msgEl.textContent = "Error saving"; msgEl.className = "settings-save-msg settings-save-msg--err"; }
    } finally {
      paBtnComposerSave.disabled = false;
      paBtnComposerSave.innerHTML = `<svg width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Save`;
    }
  });
}

// — Project Back Button Logic
const btnBackProjects = $("btn-back-projects");
if (btnBackProjects) {
  btnBackProjects.addEventListener("click", () => {
    window.location.hash = "projects";
  });
}

/* ============================================================
   SETTINGS PAGE MANAGEMENT
   ============================================================ */

export async function renderSettingsPage() {
  try {
    const settings = await loadSettings();
    
    const shSelect = $("page-settings-stakeholder");
    if (shSelect) shSelect.value = settings.stakeholder || "program_manager";
    
    const minSevSelect = $("page-settings-min-severity");
    if (minSevSelect) minSevSelect.value = settings.min_risk_severity || "medium";
    
    const verbSelect = $("page-settings-verbosity");
    if (verbSelect) verbSelect.value = settings.summary_verbosity || "brief";
    
    const teamsInput = $("page-settings-focus-teams");
    if (teamsInput) teamsInput.value = (settings.focus_teams || []).join(", ");
    
    const epicsInput = $("page-settings-focus-epics");
    if (epicsInput) epicsInput.value = (settings.focus_epics || []).join(", ");
    
    const instructionsInput = $("page-settings-instructions");
    if (instructionsInput) instructionsInput.value = settings.custom_instructions || "";

    const cats = settings.risk_categories || ["dependency", "velocity", "overcommitment"];
    ["dependency", "velocity", "overcommitment"].forEach(cat => {
      const cb = $(`page-settings-risk-${cat}`);
      if (cb) cb.checked = cats.includes(cat);
    });
  } catch (err) {
    console.error("Error rendering settings page:", err);
  }
}

function readPageSettingsForm() {
  const teamsRaw = ($("page-settings-focus-teams")?.value || "").trim();
  const epicsRaw = ($("page-settings-focus-epics")?.value || "").trim();
  const cats = ["dependency", "velocity", "overcommitment"].filter(cat => {
    const cb = $(`page-settings-risk-${cat}`);
    return cb && cb.checked;
  });
  return {
    stakeholder: $("page-settings-stakeholder")?.value || "program_manager",
    focus_teams: teamsRaw ? teamsRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
    focus_epics: epicsRaw ? epicsRaw.split(",").map(s => s.trim()).filter(Boolean) : [],
    risk_categories: cats.length ? cats : ["dependency", "velocity", "overcommitment"],
    min_risk_severity: $("page-settings-min-severity")?.value || "medium",
    summary_verbosity: $("page-settings-verbosity")?.value || "brief",
    custom_instructions: $("page-settings-instructions")?.value?.trim() || "",
  };
}

async function handleSavePageSettings() {
  const msgEl = $("page-settings-save-msg");
  const btns = [ $("btn-page-save-settings"), $("btn-page-save-bottom") ].filter(Boolean);
  btns.forEach(b => { b.disabled = true; b.textContent = "Saving…"; });
  if (msgEl) msgEl.textContent = "";

  try {
    const newSettings = readPageSettingsForm();
    await saveSettings(newSettings);
    if (msgEl) {
      msgEl.textContent = "✓ Settings saved successfully.";
      msgEl.className = "settings-save-msg settings-save-msg--ok";
      setTimeout(() => { if (msgEl) msgEl.textContent = ""; }, 3000);
    }
  } catch (e) {
    if (msgEl) {
      msgEl.textContent = "⚠️ " + e.message;
      msgEl.className = "settings-save-msg settings-save-msg--err";
    }
  } finally {
    btns.forEach(b => {
      b.disabled = false;
      b.innerHTML = b.id === "btn-page-save-settings" 
        ? `<svg width="13.5" height="13.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Save Settings` 
        : `Save Settings`;
    });
  }
}

async function handleResetPageSettings() {
  if (!confirm("Reset all AI settings to factory defaults?")) return;
  const msgEl = $("page-settings-save-msg");
  const resetBtn = $("btn-page-reset-settings");
  if (resetBtn) { resetBtn.disabled = true; resetBtn.textContent = "Resetting…"; }

  try {
    await resetSettings();
    await renderSettingsPage();
    if (msgEl) {
      msgEl.textContent = "✓ Settings reset to defaults.";
      msgEl.className = "settings-save-msg settings-save-msg--ok";
      setTimeout(() => { if (msgEl) msgEl.textContent = ""; }, 3000);
    }
  } catch (e) {
    if (msgEl) {
      msgEl.textContent = "⚠️ " + e.message;
      msgEl.className = "settings-save-msg settings-save-msg--err";
    }
  } finally {
    if (resetBtn) {
      resetBtn.disabled = false;
      resetBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg> Restore Defaults`;
    }
  }
}

// Wire Settings Page Buttons
$("btn-page-save-settings")?.addEventListener("click", handleSavePageSettings);
$("btn-page-save-bottom")?.addEventListener("click", handleSavePageSettings);
$("btn-page-reset-settings")?.addEventListener("click", handleResetPageSettings);
