import { $, setText, show, hide, escapeHtml, fmtDate, fmtDay, formatForecastDelay } from "../utils.js";
import { renderMonteCarloChart } from "../charts/delivery.js";

export function renderAssessmentTab(d, projectKey = "ALL", projectObj = null, origD = null) {
  const fullData = origD || d;
  show("assess-result");
  hide("assess-empty");
  hide("assess-error");

  // Update Project Header Title and Description
  const titleEl = $("dashboard-project-title");
  const descEl = $("dashboard-project-desc");
  if (titleEl) {
    if (projectKey === "ALL") {
      titleEl.textContent = "Portfolio Overview (ALL) — Status summary";
    } else if (projectObj) {
      titleEl.textContent = `${projectObj.name} (${projectKey}) — Status summary`;
    } else {
      titleEl.textContent = `Project ${projectKey} — Status summary`;
    }
  }
  if (descEl) {
    if (projectKey === "ALL") {
      descEl.textContent = "Enterprise delivery intelligence across all active projects, tracking cross-initiative velocity, dependencies, and risk triggers.";
    } else if (projectObj && projectObj.description) {
      descEl.textContent = projectObj.description;
    } else {
      descEl.textContent = `Status assessment and delivery metrics for project ${projectKey}.`;
    }
  }

  const noticeEl = $("assess-notice");
  if (noticeEl) {
    const noticeText = d.notice || d.warning;
    if (noticeText) {
      noticeEl.innerHTML = `<span class="info-badge">Offline Fallback</span> ${escapeHtml(noticeText)}`;
      show("assess-notice");
    } else {
      hide("assess-notice");
    }
  }


  const m = fullData.metrics || {};
  const ms = m.milestone_completion || {};
  const msKeys = Object.keys(ms);
  const aiMilestones = fullData.milestones || [];

  const normName = str => (str || "").toLowerCase().replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
  const getPrefix = str => {
    const match = normName(str).match(/^(m\d+)/);
    return match ? match[1] : null;
  };

  let milestoneList = msKeys.length ? [...msKeys] : aiMilestones.map(x => x.name).filter(Boolean);
  if (!msKeys.length) {
    const seen = new Set();
    milestoneList = milestoneList.filter(name => {
      const n = normName(name);
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
  }
  const totalMs = milestoneList.length;

  let delayedCount = 0;
  let hasPriorDelayed = false;
  milestoneList.forEach(k => {
    const normK = normName(k);
    const prefK = getPrefix(k);

    const aiMs = aiMilestones.find(x => {
      const normX = normName(x.name);
      const prefX = getPrefix(x.name);
      if (prefK && prefX) return prefK === prefX;
      return normK === normX;
    });

    let info = ms[k];
    if (!info) {
      const matchingKey = msKeys.find(mk => {
        const normMK = normName(mk);
        const prefMK = getPrefix(mk);
        if (prefK && prefMK) return prefK === prefMK;
        return normK === normMK;
      });
      if (matchingKey) info = ms[matchingKey];
    }
    info = info || {};

    const pct = info.percent_done ?? (info.total ? Math.round(100 * (info.done || 0) / info.total) : 0);
    const days = info.days_to_release;

    const isCompleted = pct >= 100;
    const isNotOnTrack = (aiMs && aiMs.status !== "on_track" && aiMs.status !== "completed") || (days != null && days < 0 && pct < 100);

    if (isNotOnTrack || (hasPriorDelayed && !isCompleted)) {
      hasPriorDelayed = true;
      delayedCount++;
    }
  });

  const milestonesEl = $("c-milestones");
  if (milestonesEl) {
    if (!totalMs) {
      milestonesEl.textContent = "–";
      milestonesEl.className = "kpi-value";
    } else {
      const onTrackCount = Math.max(0, totalMs - delayedCount);
      milestonesEl.textContent = `${onTrackCount}/${totalMs}`;

      let colorClass = "delta-green";
      if (delayedCount === 1) {
        colorClass = "delta-yellow";
      } else if (delayedCount > 1) {
        colorClass = "delta-red";
      }
      milestonesEl.className = `kpi-value ${colorClass}`;
    }
  }

  const overdue = m.overdue_points_pct;
  setText("c-overdue", (overdue === undefined || overdue === null) ? "–" : `${overdue}%`);

  const badge = $("c-badge");
  if (badge) {
    badge.textContent = (fullData.overall_status || "").replace("_", " ");
    badge.className = "badge " + (fullData.overall_status || "");
  }

  setText("assess-generated",
    (fullData.generated_at ? "· Report generated " + fmtDate(d.generated_at) : "") +
    (fullData.mode === "synthetic" ? " · SYNTHETIC" : ""));

  setText("a-forecast", d.overcommitment_summary || fullData.forecast || "");

  const delay = m.forecast_delay_days;
  const delayEl = $("c-delay");
  if (delayEl) {
    const formatted = formatForecastDelay(delay);
    delayEl.textContent = formatted.text;
    delayEl.className = "kpi-value " + formatted.className;
  }

  const sumEl = $("a-ai-summary");
  if (sumEl) {
    const summary = d.summary || fullData.ai_summary || "";
    sumEl.innerHTML = summary
      ? (window.marked ? marked.parse(summary) : `<p>${escapeHtml(summary)}</p>`)
      : '<p class="muted">–</p>';
  }

  renderMilestoneTimeline(ms);

  const mEl = $("a-milestones");
  if (mEl) {
    mEl.innerHTML = "";
    (fullData.milestones || []).forEach(x => {
      const bodyHtml = window.marked ? marked.parse(x.assessment || "") : escapeHtml(x.assessment || "");
      const st = x.status || '';
      mEl.insertAdjacentHTML("beforeend",
        `<div class="item ${st}"><div class="item-title">${escapeHtml(x.name)} <span class="badge ${st}" style="margin-left:8px; font-size:11px; padding:2px 8px;">${st.replace('_',' ')}</span></div><div class="item-body">${bodyHtml}</div></div>`);
    });
  }

  const rEl = $("a-risks");
  if (rEl) {
    rEl.innerHTML = "";
    if (!(d.risks || []).length) rEl.innerHTML = '<p class="item-body">No risks triggered.</p>';
    (d.risks || fullData.risks || []).forEach(x => {
      const bodyText = x.mitigation ? `${x.evidence || ""}\n\n**Mitigation:** ${x.mitigation}` : (x.evidence || "");
      const bodyHtml = window.marked ? marked.parse(bodyText) : escapeHtml(bodyText);
      const sev = (x.severity || '').toLowerCase();
      const badgeCls = sev === 'high' || sev === 'critical' ? 'off_track' : sev === 'medium' ? 'at_risk' : 'on_track';
      rEl.insertAdjacentHTML("beforeend",
        `<div class="item ${sev}"><div class="item-title">${escapeHtml(x.title || x.finding || "Risk")} <span class="badge ${badgeCls}" style="margin-left:8px; font-size:11px; padding:2px 8px;">${sev}</span></div><div class="item-body">${bodyHtml}</div></div>`);
    });
  }

  const aEl = $("a-actions");
  if (aEl) {
    aEl.innerHTML = "";
    (fullData.recommended_actions || []).forEach(a => {
      const li = document.createElement("li");
      li.className = "action-item";
      li.textContent = a;
      aEl.appendChild(li);
    });
  }

  if (fullData.monte_carlo) {
    renderMonteCarloChart(fullData.monte_carlo);
  }
}

export function renderMilestoneTimeline(mc) {
  const el = $("a-milestone-timeline");
  if (!el) return;
  const keys = Object.keys(mc || {});
  if (!keys.length) { el.innerHTML = '<p class="muted">No milestone data.</p>'; return; }

  keys.sort((a, b) => {
    const ra = mc[a].release_date || "9999-99-99";
    const rb = mc[b].release_date || "9999-99-99";
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });

  const seg = (cls, pct, label) => pct > 0
    ? `<div class="mt-seg ${cls}" style="width:${pct}%" title="${label} ${pct}%">${pct >= 8 ? pct + "%" : ""}</div>`
    : "";

  let html = "";
  keys.forEach(k => {
    const e = mc[k];
    const t = e.total || 0;
    const dPct = e.percent_done ?? (t ? Math.round(100 * (e.done || 0) / t) : 0);
    const tdPct = Math.max(0, 100 - dPct);
    const rel = e.release_date ? fmtDay(e.release_date) : "–";
    const todoSeg = dPct === 0
      ? `<div class="mt-seg todo" style="width:100%" title="To Do 100%"></div>`
      : seg("todo", tdPct, "To Do");
    html += `<div class="mt-row">
      <div class="mt-head"><span class="mt-name">${escapeHtml(k)}</span>
        <span class="mt-meta">${e.done || 0}/${t} done · rel ${rel}</span></div>
      <div class="mt-track">${seg("done", dPct, "Done")}${todoSeg}</div>
    </div>`;
  });
  html += `<div class="mt-legend">
    <span><i class="mt-dot done"></i> Done</span>
    <span><i class="mt-dot todo"></i> To Do</span></div>`;
  el.innerHTML = html;
}
