import { $, setText, escapeHtml, teamColor } from "../utils.js";
import { state } from "../state.js";
import { renderQualityByTeamChart } from "../charts/quality.js";

function defectClass(pct) {
  if (pct == null || pct === "–") return "";
  const val = typeof pct === "number" ? pct : parseFloat(pct);
  if (isNaN(val)) return "";
  return val >= 30 ? "delta-red" : val >= 15 ? "delta-yellow" : "delta-green";
}
function buildGenericTeamFilter(hostId, stateObj, onChange) {
  const host = $(hostId);
  if (!host || !stateObj) return;
  const { teams = [], selected, avgMode } = stateObj;

  const chips = (teams || []).map((team, idx) => {
    const on = !avgMode && selected.has(team);
    const col = teamColor(team, idx);
    return `<label class="team-chip ${on ? "on" : ""}" style="--team-col: ${col}">
      <input type="checkbox" data-team="${escapeHtml(team)}" ${on ? "checked" : ""}/>
      <i class="team-dot" style="background:${col}"></i>
      <span class="team-chip-name">${escapeHtml(team)}</span>
    </label>`;
  }).join("");

  host.innerHTML =
    `<div class="team-filter-bar">` +
      `<div class="team-mode-group">` +
        `<span class="filter-title">FILTER BY TEAM:</span>` +
        (stateObj.showAverage ? `<button type="button" class="mode-btn ${avgMode ? "active" : ""}" data-avg>Average</button>` : ``) +
        `<button type="button" class="mode-btn ${!avgMode && selected.size === teams.length ? "active" : ""}" data-all>All teams</button>` +
        `<button type="button" class="mode-btn ${!avgMode && selected.size === 0 ? "active" : ""}" data-none>Clear selection</button>` +
      `</div>` +
      `<div class="team-chip-row">${chips}</div>` +
    `</div>`;

  host.querySelectorAll('.team-chip').forEach(chip => {
    chip.addEventListener("click", (e) => {
      e.preventDefault();
      const cb = chip.querySelector('input[data-team]');
      const tName = cb.dataset.team;

      if (stateObj.avgMode) {
        stateObj.avgMode = false;
        stateObj.selected = new Set([tName]);
      } else {
        if (stateObj.selected.has(tName)) {
          stateObj.selected.delete(tName);
        } else {
          stateObj.selected.add(tName);
        }
      }
      buildGenericTeamFilter(hostId, stateObj, onChange);
      onChange();
    });
  });

  const avgBtn = host.querySelector("[data-avg]");
  const allBtn = host.querySelector("[data-all]");
  const noneBtn = host.querySelector("[data-none]");

  if (avgBtn) avgBtn.addEventListener("click", (e) => {
    e.preventDefault();
    stateObj.avgMode = true;
    stateObj.selected = new Set(teams || []);
    buildGenericTeamFilter(hostId, stateObj, onChange);
    onChange();
  });

  if (allBtn) allBtn.addEventListener("click", (e) => {
    e.preventDefault();
    stateObj.avgMode = false;
    stateObj.selected = new Set(teams || []);
    buildGenericTeamFilter(hostId, stateObj, onChange);
    onChange();
  });

  if (noneBtn) noneBtn.addEventListener("click", (e) => {
    e.preventDefault();
    stateObj.avgMode = false;
    stateObj.selected = new Set();
    buildGenericTeamFilter(hostId, stateObj, onChange);
    onChange();
  });
}

function buildQualityTeamFilter() {
  if (!state.qualityState) return;
  buildGenericTeamFilter("q-team-filter", state.qualityState, () => {
    buildQualityTeamFilter();
    renderQualityDefects(state.qualityState.bugStats, false);
  });
}

export function renderQualityTab(d) {
  const m = (d && d.metrics) || {};
  const bs = m.bug_stats || {};

  renderQualityDefects(bs, true);
  renderQualityAISummary(d);
  renderQualityByTeamChart();
}

export function renderQualityDefects(bugStats, isNewData = true) {
  const sumEl = $("q-defects-summary");
  const tblEl = $("q-defects-table");
  if (!sumEl || !tblEl) return;

  if (!bugStats) {
    sumEl.textContent = "";
    tblEl.innerHTML = "";
    return;
  }

  if (isNewData) {
    const items = bugStats.defects_per_sprint || [];
    const teamsSet = new Set();
    items.forEach(it => { if (it.team) teamsSet.add(it.team); });
    const teams = Array.from(teamsSet).sort();
    state.qualityState = {
      bugStats: bugStats,
      teams: teams,
      selected: new Set(teams),
      avgMode: false
    };
  }
  buildQualityTeamFilter();

  let items = bugStats.defects_per_sprint || [];
  const isAllTeamsSelected = !state.qualityState || state.qualityState.avgMode || (state.qualityState.selected && state.qualityState.teams && state.qualityState.selected.size === state.qualityState.teams.length);

  if (state.qualityState && !state.qualityState.avgMode) {
    items = items.filter(it => state.qualityState.selected.has(it.team));
  }

  if (!items.length) {
    const fallbackRatio = bugStats.defects_ratio_pct;
    const fallbackStr = fallbackRatio != null ? `${fallbackRatio}` : "–";
    const fallbackCls = defectClass(fallbackRatio);
    sumEl.innerHTML = `Defects ratio: <strong class="${fallbackCls}">${fallbackStr}%</strong> <span class="muted">avg(Sprint Defect Ratios) — Bug SP / Total SP per team (closed sprints)</span>`;
    tblEl.innerHTML = '<p class="muted">No defect breakdown available.</p>';
    return;
  }

  const expandedSet = new Set();
  tblEl.querySelectorAll(".per-team-toggle").forEach(btn => {
    if (btn.textContent.includes("▴") || btn.querySelector(".tree-icon")?.textContent === "▼") {
      expandedSet.add(btn.dataset.target);
    }
  });

  const sprintsMap = new Map();
  items.forEach(item => {
    const sName = item.sprint || "Unplanned";
    if (!sprintsMap.has(sName)) {
      sprintsMap.set(sName, []);
    }
    sprintsMap.get(sName).push(item);
  });

  let sprintIdx = 0;
  let rowsHtml = "";
  let sumOfClosedSprintRatios = 0;
  let closedSprintCount = 0;

  sprintsMap.forEach((teamItems, sprintName) => {
    const rowId = "qpt-" + sprintIdx;
    const isExp = expandedSet.has(rowId);

    const firstItem = teamItems[0] || {};
    const stState = (firstItem.sprint_state || "closed").toLowerCase();
    const isClosed = (stState === "closed");
    const stateTag = isClosed ? "completed" : "active";
    const stateCls = isClosed ? "s-closed" : "s-active";

    const sprintBugSp = teamItems.reduce((acc, it) => acc + (it.bug_sp ?? 0), 0);
    const sprintOtherSp = teamItems.reduce((acc, it) => acc + (it.other_sp ?? 0), 0);

    let sumOfPercentages = 0;
    let validTeamsCount = 0;

    const perTeamRows = teamItems.map(it => {
      const tName = it.team || "—";
      const tBugSp = it.bug_sp ?? 0;
      const tOtherSp = it.other_sp ?? 0;
      const tTotalSp = it.total_sp ?? 0;
      const tBugCount = it.bug_count ?? 0;
      const tTotalCount = it.total_count ?? 0;

      let tRatio = 0.0;
      if (typeof it.defect_ratio_pct === "number") {
        tRatio = it.defect_ratio_pct;
      } else if (tTotalSp > 0) {
        tRatio = Math.round((100 * tBugSp / tTotalSp) * 10) / 10;
      } else if (tTotalCount > 0) {
        tRatio = Math.round((100 * tBugCount / tTotalCount) * 10) / 10;
      }

      sumOfPercentages += tRatio;
      validTeamsCount++;

      const tRatioCls = defectClass(tRatio);
      const swatch = `<i class="team-swatch" style="background:${teamColor(tName)}"></i>`;

      return `<tr class="per-team-row" data-parent="${rowId}" style="display:${isExp ? 'table-row' : 'none'}">
        <td class="team-cell" style="padding-left: 20px;">
          <span class="tree-line">├──</span>
          ${swatch}
          <span style="color: #ffffff; font-weight: 600; font-size: 13px;">${escapeHtml(tName)}</span>
        </td>
        <td class="${tRatioCls}">${tBugSp} SP</td>
        <td>${tOtherSp} SP</td>
        <td class="${tRatioCls}">${tRatio}%</td>
        <td></td>
      </tr>`;
    }).join("");

    const sprintRatio = validTeamsCount > 0
      ? Math.round((sumOfPercentages / validTeamsCount) * 10) / 10
      : 0.0;
    const sprintRatioCls = defectClass(sprintRatio);

    if (isClosed) {
      sumOfClosedSprintRatios += sprintRatio;
      closedSprintCount++;
    }

    rowsHtml += `<tr class="sprint-row">
      <td>
        <button type="button" class="tree-toggle-btn per-team-toggle" data-target="${rowId}">
          <span class="tree-icon">${isExp ? "▼" : "►"}</span>
          <span style="color: #ffffff; font-weight: 600; font-size: 13px;">${escapeHtml(sprintName)}</span>
        </button>
        <span class="sprint-state ${stateCls}">${stateTag}</span>
      </td>
      <td class="${sprintRatioCls}">${sprintBugSp} SP</td>
      <td>${sprintOtherSp} SP</td>
      <td class="${sprintRatioCls}">${sprintRatio}%</td>
      <td style="text-align: right;"><button type="button" class="per-team-toggle link-btn" data-target="${rowId}">${isExp ? 'Teams ▴' : 'Teams ▾'}</button></td>
    </tr>${perTeamRows}`;

    sprintIdx++;
  });

  let overallRatioNum = 0.0;
  if (isAllTeamsSelected && typeof bugStats.defects_ratio_pct === "number") {
    overallRatioNum = bugStats.defects_ratio_pct;
  } else if (closedSprintCount > 0) {
    overallRatioNum = Math.round((sumOfClosedSprintRatios / closedSprintCount) * 10) / 10;
  }
  const overallRatioStr = `${overallRatioNum}`;
  const overallRatioCls = defectClass(overallRatioNum);

  sumEl.innerHTML = `Defects ratio: <strong class="${overallRatioCls}">${overallRatioStr}%</strong> <span class="muted">avg(Sprint Defect Ratios) — Bug SP / Total SP per team (closed sprints)</span>`;

  tblEl.innerHTML = `
    <table class="data-table" id="quality-table">
      <thead>
        <tr>
          <th style="width: 40%;">SPRINT</th>
          <th style="width: 18%;">DEFECT SP</th>
          <th style="width: 18%;">OTHER SP</th>
          <th style="width: 14%;">DEFECT RATIO</th>
          <th style="width: 10%; text-align: right;"></th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;

  tblEl.querySelectorAll(".per-team-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const rows = tblEl.querySelectorAll(`.per-team-row[data-parent="${targetId}"]`);
      const allTargetBtns = tblEl.querySelectorAll(`.per-team-toggle[data-target="${targetId}"]`);

      const firstBtn = allTargetBtns[0] || btn;
      const isCurrentlyExpanded = firstBtn.textContent.includes("▴") || firstBtn.querySelector(".tree-icon")?.textContent === "▼";

      rows.forEach(r => { r.style.display = isCurrentlyExpanded ? "none" : "table-row"; });

      allTargetBtns.forEach(tb => {
        const iconEl = tb.querySelector(".tree-icon");
        if (iconEl) {
          iconEl.textContent = isCurrentlyExpanded ? "►" : "▼";
        }
        if (tb.classList.contains("link-btn")) {
          tb.textContent = isCurrentlyExpanded ? "Teams ▾" : "Teams ▴";
        }
      });
    });
  });
}

export function renderQualityAISummary(d) {
  const sumEl = $("quality-ai-summary");
  if (sumEl) {
    const s = d.quality_summary || "";
    sumEl.innerHTML = s ? (window.marked ? marked.parse(s) : `<p>${escapeHtml(s)}</p>`)
                        : '<p class="muted">–</p>';
  }

  const actEl = $("quality-ai-actions");
  if (actEl) {
    const actions = d.recommended_actions || [];
    actEl.innerHTML = actions.length
      ? actions.map(a => `<li>${escapeHtml(a)}</li>`).join("")
      : '<p class="muted">–</p>';
  }
}
