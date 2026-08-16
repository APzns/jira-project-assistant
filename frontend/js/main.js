import { $, setText, show, hide, escapeHtml, fmtDate } from "./utils.js";
import { API_BASE, ENV, state } from "./state.js";
import { fetchWithTimeout, fetchAssessment } from "./api.js";
import { renderAssessmentTab } from "./views/assessment.js";
import { renderStatusTab } from "./views/status.js";
import { renderDeliveryTab } from "./views/delivery.js";
import { renderQualityTab } from "./views/quality.js";
import {
  analyzeStatus, proposeNextSteps,
  renderAnalyzeStatus, renderProposeNextSteps,
  renderAnalyzeStatusInTab, renderNextStepsInTab,
  openSettingsDrawer, closeSettingsDrawer,
  saveSettings, readSettingsForm,
  populatePaSettings, readPaSettingsForm,
} from "./skills.js";

/* ---------- Main Sidebar Navigation ---------- */
document.querySelectorAll(".sidebar-nav .nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const navKey = btn.dataset.nav;
    document.querySelectorAll(".sidebar-nav .nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".nav-page").forEach(p => p.classList.remove("active"));

    btn.classList.add("active");
    const targetPage = $("page-" + navKey);
    if (targetPage) targetPage.classList.add("active");

    const subTabs = $("sub-tabs");
    if (subTabs) {
      if (navKey === "dashboards") {
        subTabs.style.display = "flex";
        const activeTab = document.querySelector(".tab.active");
        if (activeTab) {
          if (activeTab.dataset.tab === "delivery" && state.teamPointsChart) state.teamPointsChart.resize();
          if (activeTab.dataset.tab === "assessment" && state.monteCarloChart) state.monteCarloChart.resize();
          if (activeTab.dataset.tab === "quality" && state.qualityByTeamChart) state.qualityByTeamChart.resize();
          if (activeTab.dataset.tab === "assistant") populatePaSettings();
        }
      } else {
        subTabs.style.display = "none";
      }
    }
  });
});

/* ---------- Tab switching (inside Dashboards) ---------- */
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
      const tags = (card.dataset.tags || "").toLowerCase();
      const name = (card.dataset.name || "").toLowerCase();
      const text = (card.textContent || "").toLowerCase();

      const matchesStatus = activeFilter === "all" || status === activeFilter;
      const matchesSearch = !searchQuery || name.includes(searchQuery) || tags.includes(searchQuery) || text.includes(searchQuery);

      card.style.display = (matchesStatus && matchesSearch) ? "flex" : "none";
    });
  }

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      applyFilters();
    });
  }

  filterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      filterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeFilter = pill.dataset.filter;
      applyFilters();
    });
  });
}
initProjectsFilter();

/* ---------- Master Render ---------- */
function renderAll(d) {
  if (!d) return;
  renderAssessmentTab(d);
  renderStatusTab(d);
  renderDeliveryTab(d);
  renderQualityTab(d);
}

/* ---------- Loaders ---------- */
async function loadCachedAssessment(mode = "real") {
  try {
    const d = await fetchAssessment(mode, false);
    if (d.cached === false) show("assess-empty");
    else renderAll(d);
  } catch (e) {
    console.error("Assessment load/render failed:", e);
    setText("assess-error", "Could not load the assessment: " + e.message);
    show("assess-error");
  }
}

async function refreshAssessment() {
  const btn = $("assess-button");
  if (btn) { btn.disabled = true; btn.textContent = "Analyzing…"; }
  const mode = ($("mode-toggle") && $("mode-toggle").checked) ? "synthetic" : "real";
  try {
    const d = await fetchAssessment(mode, true);
    if (d.error) { setText("assess-error", "Error: " + d.error); show("assess-error"); }
    else renderAll(d);
  } catch (e) {
    console.error("Assessment refresh failed:", e);
    setText("assess-error", "Could not reach the API: " + e.message);
    show("assess-error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Refresh report"; }
  }
}

async function loadFreshness() {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/stats/summary`, { credentials: "include" }, 45000);
    if (!res.ok) return;
    const data = await res.json();
    setText("data-freshness", "Data as of " + fmtDate(data.last_ingested));
  } catch (e) { /* leave default */ }
}

/* ---------- Chat Sidebar ---------- */
export function openChatDrawer() {
  const drawer = $("chat-drawer");
  const fab = $("chat-fab-btn");
  if (drawer) {
    drawer.classList.add("open");
    drawer.classList.remove("collapsed", "closed");
  }
  if (fab) fab.classList.add("hidden");
  setTimeout(() => {
    const input = $("ask-input");
    if (input) input.focus();
    window.dispatchEvent(new Event("resize"));
  }, 150);
}

export function collapseChatDrawer() {
  const drawer = $("chat-drawer");
  const fab = $("chat-fab-btn");
  if (drawer) {
    drawer.classList.add("collapsed");
    drawer.classList.remove("open", "closed");
  }
  if (fab) fab.classList.add("hidden");
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
  }, 150);
}

export function closeChatDrawer() {
  const drawer = $("chat-drawer");
  const fab = $("chat-fab-btn");
  if (drawer) {
    drawer.classList.add("closed");
    drawer.classList.remove("open", "collapsed");
  }
  if (fab) fab.classList.remove("hidden");
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
  }, 150);
}

export function toggleChatSidebar() {
  const drawer = $("chat-drawer");
  if (drawer && drawer.classList.contains("open") && !drawer.classList.contains("collapsed") && !drawer.classList.contains("closed")) {
    closeChatDrawer();
  } else {
    openChatDrawer();
  }
}

function _getActiveTab() {
  const active = document.querySelector(".tab.active");
  return active ? (active.dataset.tab || null) : null;
}

async function askQuestion(inputId, buttonId) {
  const errorDiv = $("ask-error");
  if (errorDiv) hide("ask-error");

  const input = $(inputId);
  const btn = $(buttonId);
  if (!input || !btn) return;
  const q = input.value.trim();
  if (!q) return;

  if (q.length > 500) {
    if (errorDiv) {
      errorDiv.textContent = "Error: Input exceeds maximum length of 500 characters.";
      show("ask-error");
    }
    return;
  }

  const blockedKeywords = /ignore\s*(all)?\s*previous\s*instructions|forget\s*your\s*instructions|system\s*prompt|you\s*are\s*now\s*a/i;
  if (blockedKeywords.test(q)) {
    if (errorDiv) {
      errorDiv.textContent = "Error: Your message contains blocked keywords and cannot be processed.";
      show("ask-error");
    }
    return;
  }

  const now = Date.now();
  if (state.lastAskTime && now - state.lastAskTime < 3000) {
    if (errorDiv) {
      errorDiv.textContent = "Error: Please wait a few seconds before asking again.";
      show("ask-error");
    }
    return;
  }
  state.lastAskTime = now;

  openChatDrawer();

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Thinking…";

  const entryId = "qa-" + Date.now();
  addHistoryEntry(entryId, q, "Thinking…");
  input.value = "";

  const historyPayload = state.askHistory.slice(-5);
  const contextTab = _getActiveTab();

  try {
    const res = await fetchWithTimeout(`${API_BASE}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: q,
        history: historyPayload.length ? historyPayload : undefined,
        context: contextTab || undefined,
      }),
    });
    const d = await res.json();
    const answer = d.error ? ("⚠️ " + d.error) : (d.answer || "No answer returned.");
    updateHistoryEntry(entryId, answer, d.rows || [], d.skill_used || null);
    state.askHistory.push({ question: q, answer });
    if (state.askHistory.length > 10) state.askHistory.shift();
  } catch (e) {
    updateHistoryEntry(entryId, "⚠️ Could not reach the API. Is the server running?", []);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function addHistoryEntry(entryId, question, answerText) {
  const container = $("ask-history");
  if (!container) return;
  const time = new Date().toLocaleTimeString();
  const html =
    `<details class="qa" open data-entry="${entryId}">
       <summary><span class="qa-q">${escapeHtml(question)}</span>
                <span class="qa-time">${time}</span></summary>
       <div class="qa-a">${escapeHtml(answerText)}</div>
     </details>`;
  container.insertAdjacentHTML("beforeend", html);
  container.scrollTop = container.scrollHeight;
}

function updateHistoryEntry(entryId, answerText, rows, skillUsed) {
  document.querySelectorAll(`[data-entry="${entryId}"] .qa-a`)
    .forEach(el => {
      const aiHtml = window.marked
        ? marked.parse(answerText)
        : escapeHtml(answerText);

      const tableHtml = (rows && rows.length > 10)
        ? _renderRowsTable(rows)
        : "";

      const skillBadge = skillUsed
        ? `<div class="skill-used-badge">✨ Answered using: <strong>${escapeHtml(skillUsed)}</strong> skill</div>`
        : "";

      el.innerHTML = skillBadge + aiHtml + tableHtml;
    });

  const container = $("ask-history");
  if (container) container.scrollTop = container.scrollHeight;
}

function _renderRowsTable(rows) {
  if (!rows || !rows.length) return "";
  const cols = Object.keys(rows[0]);
  const header = cols.map(c => `<th>${escapeHtml(String(c).replace(/_/g, " "))}</th>`).join("");
  const body = rows.map(row =>
    `<tr>${cols.map(c => `<td>${escapeHtml(String(row[c] ?? ""))}</td>`).join("")}</tr>`
  ).join("");
  return `
<details class="qa-table-details">
  <summary class="qa-table-toggle">Show all ${rows.length} rows ▾</summary>
  <div class="qa-table-scroll">
    <table class="qa-table">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</details>`;
}

function wireAsk(inputId, buttonId) {
  const btn = $(buttonId);
  const input = $(inputId);
  if (btn) btn.addEventListener("click", () => askQuestion(inputId, buttonId));
  if (input) input.addEventListener("keydown", e => { if (e.key === "Enter") askQuestion(inputId, buttonId); });

  const toggleBtn = $("chat-toggle-btn");
  const fabBtn = $("chat-fab-btn");
  const collapseBtn = $("chat-collapse-btn");
  const expandRailBtn = $("chat-collapsed-rail");
  const closeBtn = $("chat-close-btn");

  if (toggleBtn) toggleBtn.addEventListener("click", toggleChatSidebar);
  if (fabBtn) fabBtn.addEventListener("click", openChatDrawer);
  if (collapseBtn) collapseBtn.addEventListener("click", collapseChatDrawer);
  if (expandRailBtn) expandRailBtn.addEventListener("click", openChatDrawer);
  if (closeBtn) closeBtn.addEventListener("click", closeChatDrawer);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.activeElement === input) collapseChatDrawer();
  });
}

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

wireAsk("ask-input", "ask-button");
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
      const content = $("pa-results-content");
      const placeholder = $("pa-placeholder");
      if (content) {
        if (placeholder) placeholder.style.display = "none";
        content.innerHTML = `<p class="skill-empty">⚠️ ${escapeHtml(e.message)}</p>`;
        content.style.display = "block";
        $("pa-results")?.classList.remove("pa-results--empty");
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
      const content = $("pa-results-content");
      const placeholder = $("pa-placeholder");
      if (content) {
        if (placeholder) placeholder.style.display = "none";
        content.innerHTML = `<p class="skill-empty">⚠️ ${escapeHtml(e.message)}</p>`;
        content.style.display = "block";
        $("pa-results")?.classList.remove("pa-results--empty");
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
      const newSettings = readPaSettingsForm();
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
