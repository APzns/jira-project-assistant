import { $, setText, escapeHtml, teamColor, formatForecastDelay, fmtDay } from "../utils.js";
import { state } from "../state.js";

function predClass(val) {
  if (val == null) return "";
  return val >= 90 ? "delta-green" : val >= 70 ? "delta-yellow" : "delta-red";
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

export function renderStatusTab(d, projectKey = "ALL", projectObj = null, origD = null) {
  const fullData = origD || d;
  const m = (fullData && fullData.metrics) || {};

  const badge = $("s-badge");
  if (badge) {
    badge.textContent = (d.overall_status || "").replace("_", " ") || "–";
    badge.className = "badge " + (d.overall_status || "");
  }

  const cpEl = $("s-current-progress");
  if (cpEl) {
    const issues = m.progress_issues || [];
    const fvMap = {};
    issues.forEach(i => {
      const fv = i.fixversion;
      if (!fv || fv === "(none)") return;
      if (!fvMap[fv]) fvMap[fv] = { release_date: i.release_date, items: [] };
      fvMap[fv].items.push(i);
    });

    const now = new Date();
    now.setHours(0,0,0,0);
    
    let maxDelayDays = 0;
    Object.values(fvMap).forEach(vObj => {
      if (vObj.release_date && vObj.release_date !== "None") {
        const rDate = new Date(vObj.release_date);
        rDate.setHours(0,0,0,0);
        const hasUnclosed = vObj.items.some(item => (item.status_category || "").toLowerCase() !== "done");
        if (hasUnclosed && now > rDate) {
          const diffDays = Math.floor((now - rDate) / (1000 * 60 * 60 * 24));
          if (diffDays > maxDelayDays) maxDelayDays = diffDays;
        }
      }
    });

    if (maxDelayDays > 0) {
      cpEl.textContent = `-${maxDelayDays}d`;
      cpEl.className = "kpi-value delta-red";
    } else {
      cpEl.textContent = "On track";
      cpEl.className = "kpi-value delta-green";
    }
  }

  const cfEl = $("s-completion-forecast");
  if (cfEl) {
    const delay = m.forecast_delay_days;
    const formatted = formatForecastDelay(delay);
    cfEl.textContent = formatted.text;
    cfEl.className = "kpi-value " + formatted.className;
  }

  const oc = m.overcommit_next || {};
  const socEl = $("s-overcommit");
  if (socEl) {
    socEl.textContent = oc.pct == null ? "–" : `${oc.pct > 0 ? "+" : ""}${Math.round(oc.pct)}% vs avg`;
    let ocClass = "";
    if (oc.pct != null) {
      const equivPv = Math.round(100 / (1 + oc.pct / 100));
      ocClass = predClass(equivPv);
    }
    socEl.className = "kpi-value " + ocClass;
  }

  const dc = m.dependency_conflicts || {};
  const subEl = $("s-unresolved-blockers");
  if (subEl) {
    subEl.textContent = dc.count == null ? "–" : String(dc.count);
    subEl.className = "kpi-value " + (dc.count != null ? (dc.count > 0 ? "delta-red" : "delta-green") : "");
  }

  const items = dc.items || [];
  const critical = items.filter(x => x.reason && (x.reason.includes("late") || x.reason.includes("critical") || x.reason.includes("unplanned"))).length;
  setText("s-critical-path", critical || "0");
  setText("s-bugs", m.unresolved_bugs == null ? "–" : String(m.unresolved_bugs));

  const issues = m.progress_issues || [];
  const allTeams = Array.from(new Set(issues.map(i => i.team || "(none)"))).sort();
  
  if (!state.progressTabState || !state.progressTabState.selected) {
    state.progressTabState = { 
      issues: issues, 
      teams: allTeams, 
      selected: new Set(allTeams), 
      avgMode: false,
      sprintProgress: m.sprint_progress || [],
      critical_keys: new Set(m.critical_path ? (m.critical_path.critical_keys || []) : []),
      milestoneCompletion: m.milestone_completion || null
    };
  } else {
    state.progressTabState.issues = issues;
    state.progressTabState.teams = allTeams;
    state.progressTabState.sprintProgress = m.sprint_progress || [];
    state.progressTabState.critical_keys = new Set(m.critical_path ? (m.critical_path.critical_keys || []) : []);
    state.progressTabState.milestoneCompletion = m.milestone_completion || null;
  }

  buildDeliveryTeamFilter();

  const sumEl = $("status-ai-summary");
  if (sumEl) {
    const s = d.ai_summary || "";
    sumEl.innerHTML = s ? (window.marked ? marked.parse(s) : `<p>${escapeHtml(s)}</p>`)
                        : '<p class="muted">–</p>';
  }

  renderDelayedVersions(m.delayed_by_fixversion, "status-delayed");
  setText("s-blocked", m.blocked_issues == null ? "–" : String(m.blocked_issues));
  setText("s-crossteam", m.cross_team_blockers == null ? "–" : String(m.cross_team_blockers));
  
  if (m.critical_path) {
    setText("s-critical-path", m.critical_path.critical_keys ? m.critical_path.critical_keys.length : "0");
    renderCriticalPathChain(m.critical_path, "status-critical-path-chain");
  } else {
    setText("s-critical-path", "0");
  }
  
  renderDepAlerts(m.dependency_conflicts, "status-dep-alerts");

  const rEl = $("status-ai-risks");
  if (rEl) {
    const risks = d.risks || [];
    rEl.innerHTML = risks.length
      ? "<ul>" + risks.map(x => `<li><strong>${escapeHtml(x.finding)}</strong> (${escapeHtml(x.severity || '')}): ${escapeHtml(x.evidence)}</li>`).join("") + "</ul>"
      : '<p class="muted">–</p>';
  }

  const fEl = $("status-forecast");
  if (fEl) {
    const fc = d.forecast || "";
    fEl.innerHTML = fc ? `<p>${escapeHtml(fc)}</p>` : '<p class="muted">–</p>';
  }

  const aEl = $("status-ai-actions");
  if (aEl) {
    const acts = d.recommended_actions || [];
    aEl.innerHTML = acts.length
      ? "<ul>" + acts.map(a => `<li>${escapeHtml(a)}</li>`).join("") + "</ul>"
      : '<p class="muted">–</p>';
  }
}

export function buildDeliveryTeamFilter() {
  if (!state.progressTabState) return;
  buildGenericTeamFilter("delivery-team-filter", state.progressTabState, () => {
    renderStatusBreakdown();
  });
  renderStatusBreakdown();
}

export function renderStatusBreakdown() {
  const host = document.querySelector("#status-breakdown-table");
  if (!host) return;
  
  const expandedSet = new Set();
  host.querySelectorAll(".tgl-btn").forEach(btn => {
    if (btn.textContent.includes("▴")) expandedSet.add(btn.dataset.target);
  });
  
  if (!state.progressTabState || !state.progressTabState.issues) {
    host.innerHTML = '<p class="muted">No issues found.</p>';
    return;
  }
  
  const selectedTeams = state.progressTabState.selected || new Set();
  const rows = state.progressTabState.issues.filter(r => selectedTeams.has(r.team || "(none)"));

  if (!rows.length) {
    host.innerHTML = '<p class="muted">No issues for selected teams.</p>';
    return;
  }
  
  let html = `
    <div style="margin-bottom: 14px; display: flex; gap: 16px; align-items: center; font-size: 12px; background: rgba(255,255,255,0.02); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border)">
      <span class="muted" style="font-weight: 600">Status Legend:</span>
      <span style="display: flex; align-items: center; gap: 4px;"><span style="color: #7d8590">●</span> To Do</span>
      <span style="display: flex; align-items: center; gap: 4px;"><span style="color: #4c8dff">●</span> In Progress</span>
      <span style="display: flex; align-items: center; gap: 4px;"><span style="color: #a855f7">●</span> In Review</span>
      <span style="display: flex; align-items: center; gap: 4px;"><span style="color: #3fb950">●</span> Done</span>
    </div>
  `;

  const getIssueCategory = (item) => {
    const st = (item.status || "").toLowerCase();
    const cat = (item.status_category || "").toLowerCase();

    if (st.includes("review") || cat.includes("review")) return "review";
    if (st === "done" || cat === "done") return "done";
    if (st.includes("progress") || cat.includes("progress") || st.includes("in dev")) return "progress";
    return "todo";
  };

  const getCountsStr = (itemsList) => {
    let todo = 0, inProg = 0, inRev = 0, done = 0;
    const total = itemsList.length;
    itemsList.forEach(i => {
      const cat = getIssueCategory(i);
      if (cat === "done") done++;
      else if (cat === "review") inRev++;
      else if (cat === "progress") inProg++;
      else todo++;
    });

    const donePct = total ? (done / total * 100).toFixed(1) : "0.0";
    const inRevPct = total ? (inRev / total * 100).toFixed(1) : "0.0";
    const inProgPct = total ? (inProg / total * 100).toFixed(1) : "0.0";
    const todoPct = total ? (todo / total * 100).toFixed(1) : "0.0";

    const hoverText = `${done} Done  •  ${inRev} In Review  •  ${inProg} In Progress  •  ${todo} To Do  (Total: ${total})`;

    return `
      <div class="progress-breakdown-cell">
        <div class="segmented-progress-wrap" title="${hoverText}">
          <div class="segmented-progress-bar">
            <div class="seg-fill seg-done" style="width: ${donePct}%" title="${done} Done (${donePct}%)"></div>
            <div class="seg-fill seg-review" style="width: ${inRevPct}%" title="${inRev} In Review (${inRevPct}%)"></div>
            <div class="seg-fill seg-prog" style="width: ${inProgPct}%" title="${inProg} In Progress (${inProgPct}%)"></div>
            <div class="seg-fill seg-todo" style="width: ${todoPct}%" title="${todo} To Do (${todoPct}%)"></div>
          </div>
          <span class="progress-percent-label">${donePct}%</span>
        </div>
      </div>
    `;
  };

  const getStatusBadge = (item) => {
    const category = getIssueCategory(item);
    const displayLabel = escapeHtml((item && item.status) || (category === "review" ? "In Review" : category === "done" ? "Done" : category === "progress" ? "In Progress" : "To Do"));
    if (category === "done") return `<span class="badge-count b-done" style="font-size:11px; padding:3px 8px;">${displayLabel}</span>`;
    if (category === "review") return `<span class="badge-count b-review" style="font-size:11px; padding:3px 8px;">${displayLabel}</span>`;
    if (category === "progress") return `<span class="badge-count b-prog" style="font-size:11px; padding:3px 8px;">${displayLabel}</span>`;
    return `<span class="badge-count b-todo" style="font-size:11px; padding:3px 8px;">${displayLabel}</span>`;
  };

  const mc = state.progressTabState.milestoneCompletion;
  const norm = s => (s || "").toLowerCase().replace(/[–—−-]/g, "").replace(/\s+/g, "").trim();

  // Check if we have milestones defined
  const msKeys = mc ? Object.keys(mc) : [];
  const useMilestones = msKeys.length > 0 && msKeys.some(k => mc[k].fix_versions !== undefined);

  html += `<table class="data-table" id="status-table">
    <thead>
      <tr>
        <th style="width: 45%;">Milestone / Fix Version / Team / Issue</th>
        <th style="width: 40%;">Status Breakdown</th>
        <th style="width: 15%; text-align: right;">Actions</th>
      </tr>
    </thead>
    <tbody>`;

  let rowIdCounter = 0;

  if (useMilestones) {
    // Map each fix_version -> milestone name
    const fvToMilestone = {};
    msKeys.forEach(mName => {
      const mData = mc[mName];
      (mData.fix_versions || []).forEach(fvObj => {
        fvToMilestone[norm(fvObj.fix_version)] = mName;
      });
    });

    const byMilestone = {};
    msKeys.forEach(mName => {
      byMilestone[mName] = {
        name: mName,
        release_date: mc[mName]?.release_date,
        items: [],
        fixVersions: {}
      };
    });

    rows.forEach(r => {
      const fv = r.fixversion || "(none)";
      let mName = fvToMilestone[norm(fv)];
      if (!mName) {
        mName = msKeys.find(k => k.toLowerCase().includes("unassigned") || k.toLowerCase().includes("future")) || msKeys[msKeys.length - 1];
      }
      if (!byMilestone[mName]) {
        byMilestone[mName] = { name: mName, release_date: null, items: [], fixVersions: {} };
      }
      byMilestone[mName].items.push(r);

      if (!byMilestone[mName].fixVersions[fv]) {
        byMilestone[mName].fixVersions[fv] = {
          name: fv,
          state: r.sprint_state || "planned",
          release_date: r.release_date,
          items: [],
          teams: {}
        };
      }
      byMilestone[mName].fixVersions[fv].items.push(r);

      const tm = r.team || "(none)";
      if (!byMilestone[mName].fixVersions[fv].teams[tm]) {
        byMilestone[mName].fixVersions[fv].teams[tm] = { items: [] };
      }
      byMilestone[mName].fixVersions[fv].teams[tm].items.push(r);
    });

    Object.keys(byMilestone).forEach(mName => {
      const mObj = byMilestone[mName];
      if (!mObj.items.length) return;

      const mId = "m-" + (rowIdCounter++);
      const isExpM = expandedSet.has(mId);

      const fvKeys = Object.keys(mObj.fixVersions);
      // Filter out fix version that matches milestone name (deduplication)
      const otherFvs = fvKeys.filter(fv => norm(fv) !== norm(mName));
      const hasOtherFvs = otherFvs.length > 0;

      let delayBadge = "";
      let dateStr = mObj.release_date ? `<span class="muted" style="font-size:11px; font-weight:normal; margin-left: 8px;">(Deadline: ${escapeHtml(fmtDay(mObj.release_date))})</span>` : "";

      if (mObj.release_date) {
        const rDate = new Date(mObj.release_date);
        const now = new Date();
        rDate.setHours(0,0,0,0);
        now.setHours(0,0,0,0);
        const hasUnclosed = mObj.items.some(item => (item.status_category || "").toLowerCase() !== "done");
        if (hasUnclosed && now > rDate) {
          const diffDays = Math.floor((now - rDate) / (1000 * 60 * 60 * 24));
          if (diffDays > 0) {
            delayBadge = `<span class="sprint-state s-delayed">Delayed by ${diffDays} day${diffDays > 1 ? 's' : ''}</span>`;
          }
        }
      }

      const mChildClass = hasOtherFvs ? "row-version" : "row-team";

      html += `<tr class="sprint-row milestone-row">
        <td>
          <button type="button" class="tree-toggle-btn tgl-btn" data-target="${mId}" data-child-class="${mChildClass}">
            <span class="tree-icon">${isExpM ? "▼" : "►"}</span>
            <span style="color: var(--text); font-weight: 700; font-size: 13px;">${escapeHtml(mName)}</span>
          </button>
          ${dateStr}${delayBadge}
        </td>
        <td>${getCountsStr(mObj.items)}</td>
        <td style="text-align: right;"><button type="button" class="tgl-btn link-btn" data-target="${mId}" data-child-class="${mChildClass}">${isExpM ? "Expand ▴" : "Expand ▾"}</button></td>
      </tr>`;

      if (hasOtherFvs) {
        // Render child Fix Versions (Level 2)
        otherFvs.forEach(vName => {
          const vObj = mObj.fixVersions[vName];
          const vId = "v-" + (rowIdCounter++);
          const isExpV = expandedSet.has(vId);
          const sTag = vObj.state === "closed" ? "completed" : vObj.state === "active" ? "active" : "planned";

          let vDelayBadge = "";
          let vDateStr = vObj.release_date && vObj.release_date !== "None" ? `<span class="muted" style="font-size:11px; font-weight:normal; margin-left: 8px;">(Release: ${escapeHtml(vObj.release_date)})</span>` : "";

          if (vObj.release_date && vObj.release_date !== "None") {
            const rDate = new Date(vObj.release_date);
            const now = new Date();
            rDate.setHours(0,0,0,0);
            now.setHours(0,0,0,0);
            const hasUnclosed = vObj.items.some(item => (item.status_category || "").toLowerCase() !== "done");
            if (hasUnclosed && now > rDate) {
              const diffDays = Math.floor((now - rDate) / (1000 * 60 * 60 * 24));
              if (diffDays > 0) {
                vDelayBadge = `<span class="sprint-state s-delayed">Delayed by ${diffDays} day${diffDays > 1 ? 's' : ''}</span>`;
              }
            }
          }

          html += `<tr class="row-version" data-parent="${mId}" style="display:${isExpM ? 'table-row' : 'none'}">
            <td style="padding-left: 20px;">
              <span class="tree-line">├──</span>
              <button type="button" class="tree-toggle-btn tgl-btn" data-target="${vId}" data-child-class="row-team">
                <span class="tree-icon">${isExpV ? "▼" : "►"}</span>
                <span style="color: var(--text); font-weight: 600; font-size: 13px;">${escapeHtml(vName)}</span>
              </button>
              <span class="sprint-state s-${vObj.state}">${sTag}</span>
              ${vDateStr}${vDelayBadge}
            </td>
            <td>${getCountsStr(vObj.items)}</td>
            <td style="text-align: right;"><button type="button" class="tgl-btn link-btn" data-target="${vId}" data-child-class="row-team">${isExpV ? "Teams ▴" : "Teams ▾"}</button></td>
          </tr>`;

          // Teams under Fix Version (Level 3)
          Object.keys(vObj.teams).sort().forEach(tName => {
            const tObj = vObj.teams[tName];
            const tId = "t-" + (rowIdCounter++);
            const swatch = `<i class="team-swatch" style="background:${teamColor(tName)}"></i>`;
            const isExpT = expandedSet.has(tId);

            html += `<tr class="row-team" data-parent="${vId}" style="display:${isExpV ? 'table-row' : 'none'}">
              <td style="padding-left: 44px;">
                <span class="tree-line">├──</span>
                <button type="button" class="tree-toggle-btn tgl-btn" data-target="${tId}" data-child-class="row-issue">
                  <span class="tree-icon">${isExpT ? "▼" : "►"}</span>
                  ${swatch}
                  <span style="color: var(--text); font-weight: 600; font-size: 13px;">${escapeHtml(tName)}</span>
                </button>
              </td>
              <td>${getCountsStr(tObj.items)}</td>
              <td style="text-align: right;"><button type="button" class="tgl-btn link-btn" data-target="${tId}" data-child-class="row-issue">${isExpT ? "Issues ▴" : "Issues ▾"}</button></td>
            </tr>`;

            // Issues under Team (Level 4)
            tObj.items.sort((a,b) => a.key.localeCompare(b.key)).forEach(issue => {
              const isCritical = state.progressTabState.critical_keys && state.progressTabState.critical_keys.has(issue.key);
              const criticalBadge = isCritical ? `<span class="badge" style="background:rgba(224,82,96,0.1); color:#e05260; border:1px solid rgba(224,82,96,0.3); font-size:10px; padding:2px 6px; margin-right:8px;">🔥 Critical Path</span>` : "";
              html += `<tr class="row-issue" data-parent="${tId}" style="display:${isExpT ? 'table-row' : 'none'}">
                <td style="padding-left: 68px;">
                   <span class="tree-line">└──</span>
                   <span class="muted" style="font-size: 11px; margin-right: 8px; font-weight:600;">${escapeHtml(issue.key)}</span>
                   <span class="badge" style="background:var(--bg-lighter); color:var(--text-muted); padding:2px 6px; font-size:10px; margin-right:8px; border:1px solid var(--border)">${escapeHtml(issue.issue_type || "Task")}</span>
                   ${criticalBadge}${escapeHtml(issue.summary)}
                </td>
                <td>${getStatusBadge(issue)}</td>
                <td></td>
              </tr>`;
            });
          });
        });
      } else {
        // Direct Teams under Milestone (Level 2)
        const primaryFv = fvKeys[0];
        const teamsMap = primaryFv ? mObj.fixVersions[primaryFv]?.teams : {};
        Object.keys(teamsMap || {}).sort().forEach(tName => {
          const tObj = teamsMap[tName];
          const tId = "t-" + (rowIdCounter++);
          const swatch = `<i class="team-swatch" style="background:${teamColor(tName)}"></i>`;
          const isExpT = expandedSet.has(tId);

          html += `<tr class="row-team" data-parent="${mId}" style="display:${isExpM ? 'table-row' : 'none'}">
            <td style="padding-left: 20px;">
              <span class="tree-line">├──</span>
              <button type="button" class="tree-toggle-btn tgl-btn" data-target="${tId}" data-child-class="row-issue">
                <span class="tree-icon">${isExpT ? "▼" : "►"}</span>
                ${swatch}
                <span style="color: var(--text); font-weight: 600; font-size: 13px;">${escapeHtml(tName)}</span>
              </button>
            </td>
            <td>${getCountsStr(tObj.items)}</td>
            <td style="text-align: right;"><button type="button" class="tgl-btn link-btn" data-target="${tId}" data-child-class="row-issue">${isExpT ? "Issues ▴" : "Issues ▾"}</button></td>
          </tr>`;

          // Issues under Team (Level 3)
          tObj.items.sort((a,b) => a.key.localeCompare(b.key)).forEach(issue => {
            const isCritical = state.progressTabState.critical_keys && state.progressTabState.critical_keys.has(issue.key);
            const criticalBadge = isCritical ? `<span class="badge" style="background:rgba(224,82,96,0.1); color:#e05260; border:1px solid rgba(224,82,96,0.3); font-size:10px; padding:2px 6px; margin-right:8px;">🔥 Critical Path</span>` : "";
            html += `<tr class="row-issue" data-parent="${tId}" style="display:${isExpT ? 'table-row' : 'none'}">
              <td style="padding-left: 44px;">
                 <span class="tree-line">└──</span>
                 <span class="muted" style="font-size: 11px; margin-right: 8px; font-weight:600;">${escapeHtml(issue.key)}</span>
                 <span class="badge" style="background:var(--bg-lighter); color:var(--text-muted); padding:2px 6px; font-size:10px; margin-right:8px; border:1px solid var(--border)">${escapeHtml(issue.issue_type || "Task")}</span>
                 ${criticalBadge}${escapeHtml(issue.summary)}
              </td>
              <td>${getStatusBadge(issue)}</td>
              <td></td>
            </tr>`;
          });
        });
      }
    });
  } else {
    const byFixVersion = {};
    rows.forEach(r => {
      const fv = r.fixversion || "(none)";
      if (!byFixVersion[fv]) {
        byFixVersion[fv] = {
          state: r.sprint_state || "planned",
          release_date: r.release_date,
          items: [],
          teams: {}
        };
      }
      byFixVersion[fv].items.push(r);
      const tm = r.team || "(none)";
      if (!byFixVersion[fv].teams[tm]) {
        byFixVersion[fv].teams[tm] = { items: [] };
      }
      byFixVersion[fv].teams[tm].items.push(r);
    });

    const sortedVersions = Object.keys(byFixVersion).sort((a, b) => {
      if (a === "(none)") return 1;
      if (b === "(none)") return -1;
      const dateA = byFixVersion[a]?.release_date || "9999-99-99";
      const dateB = byFixVersion[b]?.release_date || "9999-99-99";
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return a.localeCompare(b);
    });

    sortedVersions.forEach((vName) => {
      const vObj = byFixVersion[vName];
      const sId = "v-" + rowIdCounter++;
      const sTag = vObj.state === "closed" ? "completed" : vObj.state === "active" ? "active" : "planned";
      const isExp = expandedSet.has(sId);
      
      let delayBadge = "";
      let dateStr = vObj.release_date && vObj.release_date !== "None" ? `<span class="muted" style="font-size:11px; font-weight:normal; margin-left: 8px;">(Release: ${escapeHtml(vObj.release_date)})</span>` : "";

      if (vObj.release_date && vObj.release_date !== "None") {
        const rDate = new Date(vObj.release_date);
        const now = new Date();
        rDate.setHours(0,0,0,0);
        now.setHours(0,0,0,0);
        
        const hasUnclosed = vObj.items.some(item => (item.status_category || "").toLowerCase() !== "done");
        if (hasUnclosed && now > rDate) {
          const diffTime = now - rDate;
          const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
          if (diffDays > 0) {
            delayBadge = `<span class="sprint-state s-delayed">Delayed by ${diffDays} day${diffDays > 1 ? 's' : ''}</span>`;
          }
        }
      }

      html += `<tr class="sprint-row">
        <td>
          <button type="button" class="tree-toggle-btn tgl-btn" data-target="${sId}" data-child-class="row-team">
            <span class="tree-icon">${isExp ? "▼" : "►"}</span>
            <span style="color: var(--text); font-weight: 600; font-size: 13px;">${escapeHtml(vName)}</span>
          </button>
          <span class="sprint-state s-${vObj.state}">${sTag}</span>
          ${dateStr}${delayBadge}
        </td>
        <td>${getCountsStr(vObj.items)}</td>
        <td style="text-align: right;"><button type="button" class="tgl-btn link-btn" data-target="${sId}" data-child-class="row-team">${isExp ? "Expand ▴" : "Expand ▾"}</button></td>
      </tr>`;
      
      Object.keys(vObj.teams).sort().forEach((tName) => {
        const tObj = vObj.teams[tName];
        const tId = "t-" + rowIdCounter++;
        const swatch = `<i class="team-swatch" style="background:${teamColor(tName)}"></i>`;
        const isExpT = expandedSet.has(tId);
        
        html += `<tr class="row-team" data-parent="${sId}" style="display:${isExp ? 'table-row' : 'none'}">
          <td style="padding-left: 20px;">
            <span class="tree-line">├──</span>
            <button type="button" class="tree-toggle-btn tgl-btn" data-target="${tId}" data-child-class="row-issue">
              <span class="tree-icon">${isExpT ? "▼" : "►"}</span>
              ${swatch}
              <span style="color: var(--text); font-weight: 600; font-size: 13px;">${escapeHtml(tName)}</span>
            </button>
          </td>
          <td>${getCountsStr(tObj.items)}</td>
          <td style="text-align: right;"><button type="button" class="tgl-btn link-btn" data-target="${tId}" data-child-class="row-issue">${isExpT ? "Issues ▴" : "Issues ▾"}</button></td>
        </tr>`;
        
        tObj.items.sort((a,b) => a.key.localeCompare(b.key)).forEach(issue => {
          const isCritical = state.progressTabState.critical_keys && state.progressTabState.critical_keys.has(issue.key);
          const criticalBadge = isCritical ? `<span class="badge" style="background:rgba(224,82,96,0.1); color:#e05260; border:1px solid rgba(224,82,96,0.3); font-size:10px; padding:2px 6px; margin-right:8px;">🔥 Critical Path</span>` : "";
          html += `<tr class="row-issue" data-parent="${tId}" style="display:${isExpT ? 'table-row' : 'none'}">
            <td style="padding-left: 44px;">
               <span class="tree-line">└──</span>
               <span class="muted" style="font-size: 11px; margin-right: 8px; font-weight:600;">${escapeHtml(issue.key)}</span>
               <span class="badge" style="background:var(--bg-lighter); color:var(--text-muted); padding:2px 6px; font-size:10px; margin-right:8px; border:1px solid var(--border)">${escapeHtml(issue.issue_type || "Task")}</span>
               ${criticalBadge}${escapeHtml(issue.summary)}
            </td>
            <td>${getStatusBadge(issue)}</td>
            <td></td>
          </tr>`;
        });
      });
    });
  }

  html += `</tbody></table>`;
  host.innerHTML = html;

  host.querySelectorAll(".tgl-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const targetId = btn.dataset.target;
      const childClass = btn.dataset.childClass;
      const rows = host.querySelectorAll(`.${childClass}[data-parent="${targetId}"]`);
      
      // find primary and secondary toggle buttons for this targetId
      const allTargetBtns = host.querySelectorAll(`.tgl-btn[data-target="${targetId}"]`);
      
      const firstBtn = allTargetBtns[0] || btn;
      const isCurrentlyExpanded = firstBtn.textContent.includes("▴") || firstBtn.querySelector(".tree-icon")?.textContent === "▼";
      
      rows.forEach(r => { 
        r.style.display = isCurrentlyExpanded ? "none" : "table-row"; 
        
        if (isCurrentlyExpanded) {
           const innerBtns = r.querySelectorAll(".tgl-btn");
           innerBtns.forEach(ib => {
             const treeIcon = ib.querySelector(".tree-icon");
             if (treeIcon) treeIcon.textContent = "►";
             if (ib.textContent.includes("▴")) {
               const base = ib.textContent.slice(0, -2);
               ib.textContent = base + " ▾";
             }
             const innerTargetId = ib.dataset.target;
             const innerChildClass = ib.dataset.childClass;
             const innerRows = host.querySelectorAll(`.${innerChildClass}[data-parent="${innerTargetId}"]`);
             innerRows.forEach(ir => {
                ir.style.display = "none";
                const innerInnerBtns = ir.querySelectorAll(".tgl-btn");
                innerInnerBtns.forEach(iib => {
                   const iTreeIcon = iib.querySelector(".tree-icon");
                   if (iTreeIcon) iTreeIcon.textContent = "►";
                   if (iib.textContent.includes("▴")) {
                     const iBase = iib.textContent.slice(0, -2);
                     iib.textContent = iBase + " ▾";
                   }
                   const iinnerTargetId = iib.dataset.target;
                   const iinnerChildClass = iib.dataset.childClass;
                   host.querySelectorAll(`.${iinnerChildClass}[data-parent="${iinnerTargetId}"]`).forEach(iir => {
                      iir.style.display = "none";
                   });
                });
             });
           });
        }
      });

      // Update icon and text on all toggle buttons sharing this targetId
      allTargetBtns.forEach(tb => {
        const iconEl = tb.querySelector(".tree-icon");
        if (iconEl) {
          iconEl.textContent = isCurrentlyExpanded ? "►" : "▼";
        }
        if (tb.classList.contains("link-btn")) {
          const baseText = tb.textContent.slice(0, -2);
          tb.textContent = isCurrentlyExpanded ? baseText + " ▾" : baseText + " ▴";
        }
      });
    });
  });

}

export function renderDelayedVersions(data, hostId) {
  const host = hostId ? $(hostId) : null;
  if (!host) return;

  const list = [...((data || {}).unreleased || []), ...((data || {}).released || [])];
  if (!list || !list.length) { 
    host.innerHTML = '<p class="muted">No delayed issues found.</p>'; 
    return; 
  }

  host.innerHTML = list.map(v => {
    const rows = (v.issues || []).map(it => `
      <tr><td>${escapeHtml(it.key)}</td><td>${escapeHtml(it.summary || "")}</td>
          <td>${escapeHtml(it.team || "–")}</td>
          <td class="delta-red">${it.delay_days}d</td></tr>`).join("");
    return `<details class="version-group" open>
      <summary><strong>${escapeHtml(v.fix_version)}</strong>
        — ${v.delayed_count} delayed
        <span class="muted">· release ${escapeHtml(v.release_date || "–")}</span>
      </summary>
      <table class="data-table">
        <thead><tr><th>Key</th><th>Summary</th><th>Team</th><th>Delay</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>`;
  }).join("");
}

export function renderCriticalPathChain(criticalPathData, hostId) {
  const host = hostId ? $(hostId) : null;
  if (!host) return;
  if (!criticalPathData || !criticalPathData.chain || !criticalPathData.chain.length) {
    host.innerHTML = '<p class="muted">No critical path issues detected.</p>';
    return;
  }
  const chain = criticalPathData.chain;
  let html = `<div style="display:flex; flex-direction:column; gap:8px;">`;
  chain.forEach((item, i) => {
    html += `<div style="display:flex; align-items:center; gap:8px; background:var(--bg-lighter); padding:8px 12px; border-radius:6px; border:1px solid var(--border)">
      <span class="badge" style="background:rgba(224,82,96,0.1); color:#e05260; border:1px solid rgba(224,82,96,0.3)">#${i+1}</span>
      <strong>${escapeHtml(item.key)}</strong>
      <span class="muted">${escapeHtml(item.summary || "")}</span>
      <span class="sprint-state s-${item.status === 'Done' ? 'closed' : 'active'}" style="margin-left:auto">${escapeHtml(item.status || "Open")}</span>
    </div>`;
  });
  html += `</div>`;
  host.innerHTML = html;
}

export function renderDepAlerts(depData, hostId) {
  const host = hostId ? $(hostId) : null;
  if (!host) return;
  const items = (depData || {}).items || [];
  if (!items.length) {
    host.innerHTML = '<p class="muted">No dependency conflicts flagged.</p>';
    return;
  }

  let html = `
    <table class="blockers-table">
      <thead>
        <tr>
          <th>Blocker</th>
          <th>Blocked</th>
        </tr>
      </thead>
      <tbody>
  `;

  items.forEach(x => {
    const blockerSprint = escapeHtml(x.blocker_sprint || "Unplanned");
    const blockerEnd = x.blocker_sprint_end ? ` (Ends: ${escapeHtml(fmtDay(x.blocker_sprint_end))})` : "";
    const blockedSprint = escapeHtml(x.blocked_sprint || "Unplanned");
    const blockedEnd = x.blocked_sprint_end ? ` (Ends: ${escapeHtml(fmtDay(x.blocked_sprint_end))})` : "";

    html += `
      <tr>
        <td class="blocker-cell">
          <div class="issue-header">
            <span class="issue-key">${escapeHtml(x.blocker || x.key || "")}</span>
            <span class="team-tag">${escapeHtml(x.blocker_team || "—")}</span>
          </div>
          <div class="issue-summary">${escapeHtml(x.blocker_summary || "")}</div>
          <div class="issue-meta">
            <span class="sprint-info">${blockerSprint}${blockerEnd}</span>
          </div>
        </td>
        <td class="blocked-cell">
          <div class="issue-header">
            <span class="issue-key">${escapeHtml(x.blocked || "")}</span>
            <span class="team-tag">${escapeHtml(x.blocked_team || "—")}</span>
          </div>
          <div class="issue-summary">${escapeHtml(x.blocked_summary || x.summary || "")}</div>
          <div class="issue-meta">
            <span class="sprint-info">${blockedSprint}${blockedEnd}</span>
            ${x.reason ? `<span class="reason-tag">${escapeHtml(x.reason)}</span>` : ""}
          </div>
        </td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  host.innerHTML = html;
}
