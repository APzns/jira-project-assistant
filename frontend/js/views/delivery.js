import { $, setText, escapeHtml, teamColor, hexToRgba } from "../utils.js";
import { state } from "../state.js";

function predClass(val) {
  if (val == null) return "";
  return val >= 90 ? "delta-green" : val >= 70 ? "delta-yellow" : "delta-red";
}

function defectClass(pct) {
  if (pct == null || pct === "–") return "";
  const val = typeof pct === "number" ? pct : parseFloat(pct);
  if (isNaN(val)) return "";
  return val >= 30 ? "delta-red" : val >= 15 ? "delta-yellow" : "delta-green";
}

export function renderDeliveryTab(d) {
  const m = (d && d.metrics) || {};
  renderTeamPoints(m.points_by_sprint_team, m.sprint_progress);
  renderPredictabilityKPIs(m, d.overall_status);
  renderPredictabilityAISummary(d);
}

export function renderPredictabilityKPIs(m, overallStatus) {
  const badge = $("p-badge");
  if (badge) {
    badge.textContent = (overallStatus || "").replace("_", " ") || "–";
    badge.className = "badge " + (overallStatus || "");
  }

  const pred = m.predictability || {};
  const predEl = $("p-predictability");
  if (predEl) {
    let pctVal = pred.pct;
    if (m.points_by_sprint_team && m.sprint_progress) {
      const stateBySprint = {};
      (m.sprint_progress || []).forEach(s => { stateBySprint[s.sprint] = s.state; });
      const pt = m.points_by_sprint_team;
      let closedComm = 0;
      let closedComp = 0;
      (pt.sprints || []).forEach((s, i) => {
        if (stateBySprint[s] === "closed") {
          (pt.teams || []).forEach(team => {
            closedComm += (pt.committed[team] || [])[i] || 0;
            closedComp += (pt.completed[team] || [])[i] || 0;
          });
        }
      });
      if (closedComm > 0) {
        pctVal = Math.round(1000 * (closedComp / closedComm)) / 10;
      }
    }
    predEl.textContent = pctVal == null ? "–" : `${pctVal}%`;
    predEl.className = "kpi-value " + (pctVal != null ? predClass(pctVal) : "");
  }

  const oc = m.overcommit_next || {};
  const ocEl = $("p-overcommit");
  if (ocEl) {
    ocEl.textContent = oc.pct == null ? "–" : `${oc.pct > 0 ? "+" : ""}${Math.round(oc.pct)}% vs avg`;
    let ocClass = "";
    if (oc.pct != null) {
      const equivPv = Math.round(100 / (1 + oc.pct / 100));
      ocClass = predClass(equivPv);
    }
    ocEl.className = "kpi-value " + ocClass;
  }

  const dr = m.defects_ratio || {};
  const drEl = $("p-defects");
  if (drEl) {
    const drVal = dr.pct;
    drEl.textContent = drVal == null ? "–" : `${drVal}%`;
    drEl.className = "kpi-value " + (drVal != null ? defectClass(drVal) : "");
  }

  const dc = m.dependency_conflicts || {};
  const dcEl = $("p-depconflicts");
  if (dcEl) {
    dcEl.textContent = dc.count == null ? "–" : String(dc.count);
    dcEl.className = "kpi-value " + (dc.count != null ? (dc.count > 0 ? "delta-red" : "delta-green") : "");
  }
}

export function renderPredictabilityAISummary(d) {
  const sumEl = $("delivery-ai-summary");
  if (sumEl) {
    const s = d.predictability_summary || d.predictability_comment || "";
    sumEl.innerHTML = s ? (window.marked ? marked.parse(s) : `<p>${escapeHtml(s)}</p>`) : '<p class="muted">–</p>';
  }

  const actEl = $("delivery-ai-actions");
  if (actEl) {
    const actions = d.recommended_actions || [];
    actEl.innerHTML = actions.length
      ? actions.map(a => `<li>${escapeHtml(a)}</li>`).join("")
      : '<li class="muted">No actions specified.</li>';
  }
}

export function renderTeamPoints(pt, sprintProgress) {
  const host = $("pred-team-filter");
  if (!pt || !pt.sprints || !pt.sprints.length) {
    if (host) host.innerHTML = '<span class="muted">No sprint/team data yet.</span>';
    if (state.teamPointsChart) { state.teamPointsChart.destroy(); state.teamPointsChart = null; }
    if (state.predByTeamChart) { state.predByTeamChart.destroy(); state.predByTeamChart = null; }
    const tb = document.querySelector("#delivery-table tbody");
    if (tb) tb.innerHTML = '<tr><td colspan="5" class="muted">No data.</td></tr>';
    return;
  }

  const stateBySprint = {};
  (sprintProgress || []).forEach(s => { stateBySprint[s.sprint] = s.state; });

  state.deliveryState = {
    pt,
    selected: new Set(pt.teams || []),
    predSelected: new Set(pt.teams || []),
    avgMode: true,
    showAverage: false,
    stateBySprint
  };

  buildTeamFilter();
  drawDelivery();
  renderPredByTeam();
  drawDeliveryTable();
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
        `<button type="button" class="mode-btn ${avgMode ? "active" : ""}" data-avg>Program average</button>` +
        `<button type="button" class="mode-btn ${!avgMode && selected.size > 0 ? "active" : ""}" data-team-mode>By team</button>` +
        `<button type="button" class="mode-btn ${!avgMode && selected.size === 0 ? "active" : ""}" data-clear-all>Clear all</button>` +
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
  const teamModeBtn = host.querySelector("[data-team-mode]");
  const clearAllBtn = host.querySelector("[data-clear-all]");

  if (avgBtn) avgBtn.addEventListener("click", (e) => {
    e.preventDefault();
    stateObj.avgMode = true;
    stateObj.selected = new Set(teams || []);
    buildGenericTeamFilter(hostId, stateObj, onChange);
    onChange();
  });

  if (teamModeBtn) teamModeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    stateObj.avgMode = false;
    if (stateObj.selected.size === 0) {
      stateObj.selected = new Set(teams || []);
    }
    buildGenericTeamFilter(hostId, stateObj, onChange);
    onChange();
  });

  if (clearAllBtn) clearAllBtn.addEventListener("click", (e) => {
    e.preventDefault();
    stateObj.avgMode = false;
    stateObj.selected = new Set();
    buildGenericTeamFilter(hostId, stateObj, onChange);
    onChange();
  });
}

export function buildTeamFilter() {
  if (!state.deliveryState) return;
  const stateObj = {
    teams: state.deliveryState.pt.teams,
    selected: state.deliveryState.selected,
    avgMode: state.deliveryState.avgMode,
    showAverage: false
  };
  buildGenericTeamFilter("pred-team-filter", stateObj, () => {
    state.deliveryState.selected = stateObj.selected;
    state.deliveryState.avgMode = stateObj.avgMode;
    buildTeamFilter();
    drawDelivery();
    renderPredByTeam();
    drawDeliveryTable();
  });
}

function sumSelected(teamSet) {
  const { pt, selected } = state.deliveryState;
  const set = teamSet || selected;
  const n = pt.sprints.length;
  const committed = new Array(n).fill(0);
  const completed = new Array(n).fill(0);
  (pt.teams || []).forEach(team => {
    if (set && !set.has(team)) return;
    (pt.committed[team] || []).forEach((v, i) => committed[i] += (v || 0));
    (pt.completed[team] || []).forEach((v, i) => completed[i] += (v || 0));
  });
  return { committed, completed };
}

function avgVelocity(teamSet) {
  const { pt, stateBySprint } = state.deliveryState;
  const { completed } = sumSelected(teamSet);
  const vals = [];
  pt.sprints.forEach((s, i) => { if (stateBySprint[s] === "closed") vals.push(completed[i]); });
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function drawDelivery() {
  if (!state.deliveryState) return;
  const { pt, stateBySprint } = state.deliveryState;
  const sprints = pt.sprints;
  const selData = sumSelected();

  let lastClosed = -1;
  sprints.forEach((s, i) => { if (stateBySprint[s] === "closed") lastClosed = i; });

  const committedLine = selData.committed.slice();

  const labels = sprints.map(s => {
    const st = stateBySprint[s];
    const tag = st === "active" ? "  (active)" : st === "closed" ? "" : "  (planned)";
    return s + tag;
  });

  const annotations = {};
  if (lastClosed >= 0 && lastClosed < sprints.length - 1) {
    annotations.now = {
      type: "line", scaleID: "x", value: lastClosed + 0.5,
      borderColor: "#e05260", borderWidth: 2, borderDash: [4, 4],
      label: { display: true, content: "now", position: "start",
               color: "#e6e9ef", backgroundColor: "rgba(224,82,96,0.85)",
               font: { size: 10 }, padding: 3 }
    };
  }

  let dsets = [];

  if (state.deliveryState.avgMode) {
    const closedCompleted = [];
    sprints.forEach((s, i) => { if (i <= lastClosed && selData.completed[i] != null) closedCompleted.push(selData.completed[i]); });
    const avgClosedCompleted = closedCompleted.length ? Math.round(closedCompleted.reduce((a, b) => a + b, 0) / closedCompleted.length) : 0;
    const completedWithForecast = sprints.map((s, i) => i <= lastClosed ? (selData.completed[i] != null ? selData.completed[i] : 0) : avgClosedCompleted);
    const completedBarColors = sprints.map((s, i) => i <= lastClosed ? "#4c8dff" : hexToRgba("#4c8dff", 0.30));

    dsets.push({
      type: "bar",
      label: "Completed SP",
      data: completedWithForecast,
      backgroundColor: completedBarColors,
      borderColor: completedBarColors,
      borderWidth: 0,
      order: 1,
      _lastClosed: lastClosed
    });

    dsets.push({
      type: "line",
      label: "Total Committed SP",
      data: committedLine,
      borderColor: "#818cf8",
      backgroundColor: "#818cf8",
      borderWidth: 3,
      pointRadius: 4,
      tension: 0.2,
      order: -1
    });
  } else {
    const selectedTeams = (pt.teams || []).filter(t => (state.deliveryState.selected || new Set()).has(t));

    const teamAvgClosed = {};
    selectedTeams.forEach(team => {
      const vals = [];
      sprints.forEach((s, i) => {
        if (i <= lastClosed) {
          vals.push((pt.completed[team] || [])[i] || 0);
        }
      });
      teamAvgClosed[team] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    });

    selectedTeams.forEach(team => {
      const idx = (pt.teams || []).indexOf(team);
      const col = teamColor(team, idx);
      const completedWithForecast = sprints.map((_, i) => {
        if (i <= lastClosed) {
          return (pt.completed[team] || [])[i] || 0;
        }
        return teamAvgClosed[team];
      });
      const bg = sprints.map((_, i) => i <= lastClosed ? col : hexToRgba(col, 0.35));
      dsets.push({
        type: "bar",
        label: `Completed SP (${team})`,
        data: completedWithForecast,
        backgroundColor: bg,
        borderColor: col,
        borderWidth: { top: 1, right: 0, bottom: 0, left: 0 },
        stack: "completed",
        barPercentage: 0.7,
        categoryPercentage: 0.8,
        order: 1,
        _lastClosed: lastClosed
      });
    });

    const selTeams = (pt.teams || []).filter(t => (state.deliveryState.selected || new Set()).has(t));
    dsets.push({
      type: "line",
      label: selTeams.length === 1 ? `Total Committed SP (${selTeams[0]})` : "Total Committed SP",
      data: selData.committed.slice(),
      borderColor: "#818cf8",
      backgroundColor: "#818cf8",
      borderWidth: 3,
      pointRadius: 4,
      tension: 0.2,
      order: -1
    });
  }

  const ctx = $("teamPointsChart");
  if (state.teamPointsChart) state.teamPointsChart.destroy();
  state.teamPointsChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: dsets
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: "#9aa4b2",
            usePointStyle: true,
            padding: 14,
            boxWidth: 14,
            generateLabels: () => [
              { text: "Total Committed SP", fontColor: "#9aa4b2", color: "#9aa4b2", strokeStyle: "#818cf8", fillStyle: "#818cf8", pointStyle: "circle" },
              { text: "Completed SP", fontColor: "#9aa4b2", color: "#9aa4b2", strokeStyle: "#4c8dff", fillStyle: "#4c8dff", pointStyle: "rectRounded" }
            ]
          }
        },
        tooltip: {
          backgroundColor: "#1e2430", borderColor: "#2a303c", borderWidth: 1,
          titleColor: "#e6e9ef", bodyColor: "#c7cdd6", padding: 10, cornerRadius: 8,
          callbacks: {
            label: ctx => {
              const ds = ctx.dataset;
              const val = ctx.parsed.y;
              let label = ds.label || "";
              if (ds._lastClosed != null && ctx.dataIndex > ds._lastClosed && ds.type === "bar") {
                label = `${ds.label || "Completed"} (forecast)`;
              }
              return `${label}: ${val}`;
            }
          }
        },
        annotation: { annotations }
      },
      scales: {
        x: { stacked: true, ticks: { color: "#9aa4b2" }, grid: { display: false }, border: { color: "#2a303c" } },
        y: {
          title: { display: true, text: "Story Points", color: "#9aa4b2", font: { size: 12, weight: "bold" } },
          stacked: true, beginAtZero: true, ticks: { color: "#9aa4b2", precision: 0, maxTicksLimit: 6 },
          grid: { color: "rgba(42,48,60,0.6)" }, border: { display: false }
        }
      }
    }
  });
}

export function renderPredByTeam() {
  if (!state.deliveryState) return;
  const ctx = $("predByTeamChart");
  if (!ctx) return;

  const prev = Chart.getChart(ctx);
  if (prev) prev.destroy();

  const { pt, stateBySprint } = state.deliveryState;
  if (!state.deliveryState.predSelected) state.deliveryState.predSelected = new Set(pt.teams || []);
  if (!state.deliveryState.selected) state.deliveryState.selected = new Set(state.deliveryState.predSelected);
  const selected = state.deliveryState.selected;
  const sprints = pt.sprints;

  let lastClosed = -1;
  sprints.forEach((s, i) => { if (stateBySprint[s] === "closed") lastClosed = i; });

  const labels = sprints.map(s => {
    const st = stateBySprint[s];
    const tag = st === "active" ? "  (active)" : st === "closed" ? "" : "  (planned)";
    return s + tag;
  });

  const annotations = {};
  if (lastClosed >= 0 && lastClosed < sprints.length - 1) {
    annotations.now = {
      type: "line", scaleID: "x", value: lastClosed + 0.5,
      borderColor: "#e05260", borderWidth: 2, borderDash: [4, 4],
      label: { display: true, content: "now", position: "start",
               color: "#e6e9ef", backgroundColor: "rgba(224,82,96,0.85)",
               font: { size: 10 }, padding: 3 }
    };
  }

  let dsets = [];

  const getTeamPred = (team) => {
    const committed = pt.committed[team] || [];
    const completed = pt.completed[team] || [];
    return sprints.map((_, i) => {
      const comm = committed[i] || 0;
      const comp = completed[i] || 0;
      if (comm === 0) return null;
      return Math.round((comp / comm) * 100);
    });
  };

  const getAvgPredOverClosed = (teamPreds) => {
    const closedVals = [];
    teamPreds.forEach((val, i) => {
      if (i <= lastClosed && val != null) {
        closedVals.push(val);
      }
    });
    if (!closedVals.length) return 0;
    return Math.round(closedVals.reduce((a, b) => a + b, 0) / closedVals.length);
  };

  if (state.deliveryState.avgMode) {
    const allTeams = pt.teams || [];
    const sprintPreds = sprints.map((_, i) => {
      let totComm = 0;
      let totComp = 0;
      allTeams.forEach(team => {
        totComm += (pt.committed[team] || [])[i] || 0;
        totComp += (pt.completed[team] || [])[i] || 0;
      });
      if (totComm === 0) return null;
      return Math.round((totComp / totComm) * 100);
    });

    const closedPreds = [];
    sprints.forEach((s, i) => {
      if (stateBySprint[s] === "closed" && sprintPreds[i] != null) {
        closedPreds.push(sprintPreds[i]);
      }
    });
    const avgAllClosed = closedPreds.length
      ? Math.round(closedPreds.reduce((a, b) => a + b, 0) / closedPreds.length)
      : 0;

    const combinedAvgLine = sprints.map((s, i) => {
      const st = stateBySprint[s];
      if (st === "closed" || st === "active") {
        return sprintPreds[i];
      }
      return avgAllClosed;
    });

    dsets.push({
      label: "All-teams avg",
      data: combinedAvgLine,
      borderColor: "#4c8dff",
      backgroundColor: "#4c8dff",
      borderWidth: 3,
      pointRadius: 4,
      pointHoverRadius: 7,
      tension: 0.15,
      spanGaps: true,
      segment: {
        borderDash: ctx => (ctx.p0DataIndex >= lastClosed ? [6, 4] : undefined)
      }
    });
  } else {
    const selTeams = (pt.teams || []).filter(t => selected.has(t));
    const numTeams = selTeams.length;
    selTeams.forEach((team, tIdx) => {
      const idx = (pt.teams || []).indexOf(team);
      const col = teamColor(team, idx);
      const teamPreds = getTeamPred(team);
      const teamAvgClosed = getAvgPredOverClosed(teamPreds);

      const jitter = (tIdx - (numTeams - 1) / 2) * 6.0;

      const combinedLine = sprints.map((s, i) => {
        const st = stateBySprint[s];
        const rawVal = (st === "closed" || st === "active") ? teamPreds[i] : teamAvgClosed;
        return rawVal != null ? rawVal + jitter : null;
      });

      const pointColors = sprints.map((s, i) => {
        const st = stateBySprint[s];
        const val = (st === "closed" || st === "active") ? teamPreds[i] : teamAvgClosed;
        if (val == null) return col;
        return val >= 90 ? "#3fbf7f" : val >= 70 ? "#f5a623" : "#e05260";
      });

      dsets.push({
        label: team,
        data: combinedLine,
        borderColor: col,
        backgroundColor: col,
        pointBackgroundColor: pointColors,
        pointBorderColor: pointColors,
        borderWidth: 3,
        pointRadius: 5,
        pointHoverRadius: 8,
        tension: 0.15,
        spanGaps: true,
        segment: {
          borderDash: ctx => (ctx.p0DataIndex >= lastClosed ? [6, 4] : undefined)
        },
        _jitter: jitter
      });
    });
  }

  state.predByTeamChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: dsets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        title: { display: true, text: "Predictability", color: "#9aa4b2", font: { size: 14, weight: "bold" } },
        legend: { display: true, position: "bottom", labels: { color: "#9aa4b2", usePointStyle: true } }
      },
      scales: {
        x: { ticks: { color: "#9aa4b2" }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: "#9aa4b2", callback: (val) => `${val}%` }, grid: { color: "rgba(42,48,60,0.6)" } }
      }
    }
  });
}

export function drawDeliveryTable() {
  if (!state.deliveryState) return;
  const { pt, stateBySprint } = state.deliveryState;
  const tb = document.querySelector("#delivery-table tbody");
  if (!tb) return;
  if (!pt || !pt.sprints || !pt.sprints.length) { tb.innerHTML = '<tr><td colspan="5" class="muted">No data.</td></tr>'; return; }

  const allTeams = pt.teams || [];
  const allTeamsSet = new Set(allTeams);

  const allData = sumSelected(allTeamsSet);
  const avgAll = avgVelocity(allTeamsSet);
  const avgRounded = Math.round(avgAll);

  const teamAvg = {};
  allTeams.forEach(t => {
    const vals = [];
    pt.sprints.forEach((s, j) => {
      if (stateBySprint[s] === "closed") vals.push((pt.completed[t] || [])[j] || 0);
    });
    teamAvg[t] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  });

  const pctOf = (completed, committed) => committed ? Math.round(100 * completed / committed) : 0;

  const expandedSet = new Set();
  tb.querySelectorAll(".per-team-toggle").forEach(btn => {
    if (btn.textContent.trim() === "Teams ▴") expandedSet.add(btn.dataset.target);
  });

  tb.innerHTML = pt.sprints.map((sprint, i) => {
    const st = stateBySprint[sprint] || "future";
    const isSettled = (st === "closed");
    const committed = allData.committed[i];
    const completedVal = isSettled ? allData.completed[i] : avgRounded;

    const pv = pctOf(completedVal, committed);
    const pTxt = isSettled ? `${pv}%` : `${pv}% <span class="vs-avg">vs avg (${avgRounded} SP)</span>`;
    const pCls = predClass(pv);

    const tag = st === "closed" ? "closed" : st === "active" ? "active" : "planned";
    const rowId = "pt-" + i;
    const isExp = expandedSet.has(rowId);

    const perTeamRows = allTeams.map(t => {
      const c = (pt.committed[t] || [])[i] || 0;
      const done = (pt.completed[t] || [])[i] || 0;
      const basis = isSettled ? done : teamAvg[t];
      const teamP = c > 0 ? pctOf(basis, c) : null;
      const teamPTxt = teamP != null 
        ? (isSettled ? `${teamP}%` : `${teamP}% <span class="vs-avg">vs avg (${teamAvg[t]} SP)</span>`)
        : (isSettled ? `–` : `– <span class="vs-avg">vs avg (${teamAvg[t]} SP)</span>`);
      const teamCls = teamP != null ? predClass(teamP) : "";
      const swatch = `<i class="team-swatch" style="background:${teamColor(t, allTeams.indexOf(t))}"></i>`;
      return `<tr class="per-team-row" data-parent="${rowId}" style="display:${isExp ? 'table-row' : 'none'}">
        <td class="team-cell" style="padding-left: 20px;">
          <span class="tree-line">├──</span>
          ${swatch}
          <span style="color: var(--text); font-weight: 600; font-size: 13px;">${escapeHtml(t)}</span>
        </td>
        <td>${c} SP</td>
        <td class="${teamCls}">${basis} SP</td>
        <td class="${teamCls}">${teamPTxt}</td>
        <td></td>
      </tr>`;
    }).join("") || `<tr class="per-team-row" data-parent="${rowId}" style="display:${isExp ? 'table-row' : 'none'}">
        <td colspan="5" class="muted">No team data.</td></tr>`;

    return `<tr class="sprint-row">
        <td>
          <button type="button" class="tree-toggle-btn per-team-toggle" data-target="${rowId}">
            <span class="tree-icon">${isExp ? "▼" : "►"}</span>
            <span style="color: var(--text); font-weight: 600; font-size: 13px;">${escapeHtml(sprint)}</span>
          </button>
          <span class="sprint-state s-${st}">${tag}</span>
        </td>
        <td>${committed} SP</td>
        <td class="${pCls}">${completedVal} SP</td>
        <td class="${pCls}">${pTxt}</td>
        <td style="text-align: right;"><button type="button" class="per-team-toggle link-btn" data-target="${rowId}">${isExp ? 'Teams ▴' : 'Teams ▾'}</button></td>
      </tr>${perTeamRows}`;
  }).join("");

  tb.querySelectorAll(".per-team-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const rows = tb.querySelectorAll(`.per-team-row[data-parent="${targetId}"]`);
      const allTargetBtns = tb.querySelectorAll(`.per-team-toggle[data-target="${targetId}"]`);

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
