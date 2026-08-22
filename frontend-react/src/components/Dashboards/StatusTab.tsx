import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Assessment } from '../../types';

// ------------- UTILITIES -------------
const predClass = (val?: number | null) => {
  if (val == null) return "";
  return val >= 90 ? "delta-green" : val >= 70 ? "delta-yellow" : "delta-red";
};

const teamColors = [
  '#4c8dff', '#a855f7', '#3fb950', '#e05260', '#f5a623', '#00c7e6', '#ff8b94'
];

const getTeamColor = (teamName: string) => {
  let hash = 0;
  for (let i = 0; i < teamName.length; i++) hash = teamName.charCodeAt(i) + ((hash << 5) - hash);
  return teamColors[Math.abs(hash) % teamColors.length];
};

const formatForecastDelay = (delay?: number | null) => {
  if (delay == null) return { text: "–", className: "" };
  if (delay <= 0) return { text: "On track", className: "delta-green" };
  return { text: `+${delay}d delay`, className: "delta-red" };
};

const fmtDay = (dateStr?: string | null) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const getIssueCategory = (item: any) => {
  const st = (item.status || "").toLowerCase();
  const cat = (item.status_category || "").toLowerCase();

  if (st.includes("review") || cat.includes("review")) return "review";
  if (st === "done" || cat === "done") return "done";
  if (st.includes("progress") || cat.includes("progress") || st.includes("in dev")) return "progress";
  return "todo";
};

// ------------- COMPONENTS -------------

const SegmentedProgressBar = ({ items }: { items: any[] }) => {
  let todo = 0, inProg = 0, inRev = 0, done = 0;
  const total = items.length;
  items.forEach(i => {
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

  return (
    <div className="progress-breakdown-cell">
      <div className="segmented-progress-wrap" title={hoverText}>
        <div className="segmented-progress-bar">
          <div className="seg-fill seg-done" style={{ width: `${donePct}%` }} title={`${done} Done (${donePct}%)`} />
          <div className="seg-fill seg-review" style={{ width: `${inRevPct}%` }} title={`${inRev} In Review (${inRevPct}%)`} />
          <div className="seg-fill seg-prog" style={{ width: `${inProgPct}%` }} title={`${inProg} In Progress (${inProgPct}%)`} />
          <div className="seg-fill seg-todo" style={{ width: `${todoPct}%` }} title={`${todo} To Do (${todoPct}%)`} />
        </div>
        <span className="progress-percent-label">{donePct}%</span>
      </div>
    </div>
  );
};

const StatusBadge = ({ item }: { item: any }) => {
  const category = getIssueCategory(item);
  const displayLabel = item.status || (category === "review" ? "In Review" : category === "done" ? "Done" : category === "progress" ? "In Progress" : "To Do");
  
  let bClass = "b-todo";
  if (category === "done") bClass = "b-done";
  else if (category === "review") bClass = "b-review";
  else if (category === "progress") bClass = "b-prog";

  return (
    <span className={`badge-count ${bClass}`} style={{ fontSize: "11px", padding: "3px 8px" }}>
      {displayLabel}
    </span>
  );
};

const TeamFilter = ({ 
  teams, 
  selectedTeams, 
  avgMode, 
  setSelectedTeams, 
  setAvgMode 
}: { 
  teams: string[], 
  selectedTeams: Set<string>, 
  avgMode: boolean, 
  setSelectedTeams: (s: Set<string>) => void,
  setAvgMode: (b: boolean) => void
}) => {
  const toggleTeam = (team: string) => {
    if (avgMode) {
      setAvgMode(false);
      setSelectedTeams(new Set([team]));
    } else {
      const next = new Set(selectedTeams);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      setSelectedTeams(next);
    }
  };

  return (
    <div className="team-filter-bar">
      <div className="team-mode-group">
        <span className="filter-title">FILTER BY TEAM:</span>
        <button type="button" className={`mode-btn ${avgMode ? "active" : ""}`} onClick={() => { setAvgMode(true); setSelectedTeams(new Set(teams)); }}>Average</button>
        <button type="button" className={`mode-btn ${!avgMode && selectedTeams.size === teams.length ? "active" : ""}`} onClick={() => { setAvgMode(false); setSelectedTeams(new Set(teams)); }}>All teams</button>
        <button type="button" className={`mode-btn ${!avgMode && selectedTeams.size === 0 ? "active" : ""}`} onClick={() => { setAvgMode(false); setSelectedTeams(new Set()); }}>Clear selection</button>
      </div>
      <div className="team-chip-row">
        {teams.map((team, _idx) => {
          const on = !avgMode && selectedTeams.has(team);
          const col = getTeamColor(team);
          return (
            <label key={team} className={`team-chip ${on ? "on" : ""}`} style={{ "--team-col": col } as any}>
              <input type="checkbox" checked={on} onChange={() => toggleTeam(team)} />
              <i className="team-dot" style={{ background: col }}></i>
              <span className="team-chip-name">{team}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
};

const StatusTable = ({ issues, criticalKeys }: { issues: any[], criticalKeys: Set<string> }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const byFixVersion = useMemo(() => {
    const map: Record<string, any> = {};
    issues.forEach(r => {
      const fv = r.fixversion || "(none)";
      if (!map[fv]) {
        map[fv] = { state: r.sprint_state || "planned", release_date: r.release_date, items: [], teams: {} };
      }
      map[fv].items.push(r);
      const tm = r.team || "(none)";
      if (!map[fv].teams[tm]) map[fv].teams[tm] = { items: [] };
      map[fv].teams[tm].items.push(r);
    });
    return map;
  }, [issues]);

  if (!issues.length) {
    return <p className="muted">No issues for selected teams.</p>;
  }

  return (
    <>
      <div style={{ marginBottom: "14px", display: "flex", gap: "16px", alignItems: "center", fontSize: "12px", background: "rgba(255,255,255,0.02)", padding: "8px 12px", borderRadius: "6px", border: "1px solid var(--border)" }}>
        <span className="muted" style={{ fontWeight: 600 }}>Status Legend:</span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><span style={{ color: "#7d8590" }}>●</span> To Do</span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><span style={{ color: "#4c8dff" }}>●</span> In Progress</span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><span style={{ color: "#a855f7" }}>●</span> In Review</span>
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}><span style={{ color: "#3fb950" }}>●</span> Done</span>
      </div>

      <table className="data-table" id="status-table">
        <thead>
          <tr>
            <th style={{ width: "45%" }}>Fix Version / Team / Issue</th>
            <th style={{ width: "40%" }}>Status Breakdown</th>
            <th style={{ width: "15%", textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {Object.keys(byFixVersion).sort().map(vName => {
            const vObj = byFixVersion[vName];
            const sId = `v-${vName}`;
            const sTag = vObj.state === "closed" ? "completed" : vObj.state === "active" ? "active" : "planned";
            const isExp = expanded.has(sId);

            let delayDays = 0;
            if (vObj.release_date && vObj.release_date !== "None") {
              const rDate = new Date(vObj.release_date);
              const now = new Date();
              rDate.setHours(0,0,0,0);
              now.setHours(0,0,0,0);
              const hasUnclosed = vObj.items.some((item: any) => (item.status_category || "").toLowerCase() !== "done");
              if (hasUnclosed && now > rDate) {
                delayDays = Math.floor((now.getTime() - rDate.getTime()) / (1000 * 60 * 60 * 24));
              }
            }

            return (
              <React.Fragment key={sId}>
                <tr className="sprint-row">
                  <td>
                    <button type="button" className="tree-toggle-btn tgl-btn" onClick={() => toggleExpand(sId)}>
                      <span className="tree-icon">{isExp ? "▼" : "►"}</span>
                      <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "13px" }}>{vName}</span>
                    </button>
                    <span className={`sprint-state s-${vObj.state}`}>{sTag}</span>
                    {vObj.release_date && vObj.release_date !== "None" && (
                      <span className="muted" style={{ fontSize: "11px", fontWeight: "normal", marginLeft: "8px" }}>
                        (Release: {vObj.release_date})
                      </span>
                    )}
                    {delayDays > 0 && (
                      <span className="sprint-state s-delayed">Delayed by {delayDays} day{delayDays > 1 ? 's' : ''}</span>
                    )}
                  </td>
                  <td><SegmentedProgressBar items={vObj.items} /></td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="tgl-btn link-btn" onClick={() => toggleExpand(sId)}>
                      {isExp ? "Expand ▴" : "Expand ▾"}
                    </button>
                  </td>
                </tr>

                {isExp && Object.keys(vObj.teams).sort().map(tName => {
                  const tObj = vObj.teams[tName];
                  const tId = `t-${vName}-${tName}`;
                  const isExpT = expanded.has(tId);

                  return (
                    <React.Fragment key={tId}>
                      <tr className="row-team">
                        <td style={{ paddingLeft: "20px" }}>
                          <span className="tree-line">├──</span>
                          <button type="button" className="tree-toggle-btn tgl-btn" onClick={() => toggleExpand(tId)}>
                            <span className="tree-icon">{isExpT ? "▼" : "►"}</span>
                            <i className="team-swatch" style={{ background: getTeamColor(tName) }}></i>
                            <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "13px" }}>{tName}</span>
                          </button>
                        </td>
                        <td><SegmentedProgressBar items={tObj.items} /></td>
                        <td style={{ textAlign: "right" }}>
                          <button type="button" className="tgl-btn link-btn" onClick={() => toggleExpand(tId)}>
                            {isExpT ? "Issues ▴" : "Issues ▾"}
                          </button>
                        </td>
                      </tr>

                      {isExpT && tObj.items.sort((a: any, b: any) => a.key.localeCompare(b.key)).map((issue: any) => {
                        const isCritical = criticalKeys.has(issue.key);
                        return (
                          <tr key={issue.key} className="row-issue">
                            <td style={{ paddingLeft: "44px" }}>
                              <span className="tree-line">└──</span>
                              <span className="muted" style={{ fontSize: "11px", marginRight: "8px", fontWeight: 600 }}>{issue.key}</span>
                              <span className="badge" style={{ background: "var(--bg-lighter)", color: "var(--text-muted)", padding: "2px 6px", fontSize: "10px", marginRight: "8px", border: "1px solid var(--border)" }}>
                                {issue.issue_type || "Task"}
                              </span>
                              {isCritical && (
                                <span className="badge" style={{ background: "rgba(224,82,96,0.1)", color: "#e05260", border: "1px solid rgba(224,82,96,0.3)", fontSize: "10px", padding: "2px 6px", marginRight: "8px" }}>
                                  🔥 Critical Path
                                </span>
                              )}
                              {issue.summary}
                            </td>
                            <td><StatusBadge item={issue} /></td>
                            <td></td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
};

export const StatusTab = ({ assessmentData }: { assessmentData: Assessment }) => {
  const m = assessmentData?.metrics || {};
  const issues = m.progress_issues || [];

  const allTeams = useMemo(() => Array.from(new Set(issues.map((i: any) => i.team || "(none)"))).sort(), [issues]);
  
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set(allTeams));
  const [avgMode, setAvgMode] = useState(false);

  // Health KPIs calculation
  let maxDelayDays = 0;
  const fvMap: Record<string, { release_date: string, items: any[] }> = {};
  issues.forEach((i: any) => {
    const fv = i.fixversion;
    if (!fv || fv === "(none)") return;
    if (!fvMap[fv]) fvMap[fv] = { release_date: i.release_date, items: [] };
    fvMap[fv].items.push(i);
  });

  const now = new Date();
  now.setHours(0,0,0,0);
  Object.values(fvMap).forEach(vObj => {
    if (vObj.release_date && vObj.release_date !== "None") {
      const rDate = new Date(vObj.release_date);
      rDate.setHours(0,0,0,0);
      const hasUnclosed = vObj.items.some(item => (item.status_category || "").toLowerCase() !== "done");
      if (hasUnclosed && now > rDate) {
        const diffDays = Math.floor((now.getTime() - rDate.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays > maxDelayDays) maxDelayDays = diffDays;
      }
    }
  });

  const currentProgress = maxDelayDays > 0 ? { text: `-${maxDelayDays}d`, className: "delta-red" } : { text: "On track", className: "delta-green" };
  const forecastDelay = formatForecastDelay(m.forecast_delay_days);
  
  const oc = m.overcommit_next || {};
  const overcommitClass = oc.pct != null ? predClass(Math.round(100 / (1 + oc.pct / 100))) : "";
  const overcommitText = oc.pct == null ? "–" : `${oc.pct > 0 ? "+" : ""}${Math.round(oc.pct)}% vs avg`;

  const dc = m.dependency_conflicts || {};
  const unresolvedBlockersClass = dc.count != null ? (dc.count > 0 ? "delta-red" : "delta-green") : "";
  const unresolvedBlockersText = dc.count == null ? "–" : String(dc.count);

  const filteredIssues = useMemo(() => {
    return issues.filter((r: any) => selectedTeams.has(r.team || "(none)"));
  }, [issues, selectedTeams]);

  const criticalKeys = useMemo(() => new Set<string>((m.critical_path?.critical_keys as string[]) || []), [m.critical_path]);

  return (
    <section id="tab-status" className="tab-panel" style={{ display: 'block' }}>
      <h2>Delivery</h2>

      {/* 1. Delivery status */}
      <section className="section-card">
        <h3>Health <span className={`badge ${assessmentData.overall_status || ""}`}>{assessmentData.overall_status?.replace("_", " ") || "–"}</span></h3>
        <div className="health-card">
          <div className="kpi-strip kpi-strip-4">
            <div className="kpi">
              <div className="kpi-label">Current progress</div>
              <div className={`kpi-value ${currentProgress.className}`}>{currentProgress.text}</div>
              <div className="kpi-sub">based on release date of a fixversion with an earliest release date with not closed artifacts</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Completion forecast</div>
              <div className={`kpi-value ${forecastDelay.className}`}>{forecastDelay.text}</div>
              <div className="kpi-sub">projected delay vs. target (days), Monte Carlo P50</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Next sprint commitment</div>
              <div className={`kpi-value ${overcommitClass}`}>{overcommitText}</div>
              <div className="kpi-sub">committed vs. average closed-sprint velocity</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Unresolved blockers</div>
              <div className={`kpi-value ${unresolvedBlockersClass}`}>{unresolvedBlockersText}</div>
              <div className="kpi-sub">active blockers from dependency conflicts / blocked issues</div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. FixVersions progress */}
      <section className="section-card">
        <h3>FixVersions progress</h3>
        <TeamFilter 
          teams={allTeams} 
          selectedTeams={selectedTeams} 
          avgMode={avgMode} 
          setSelectedTeams={setSelectedTeams} 
          setAvgMode={setAvgMode} 
        />
        <StatusTable issues={filteredIssues} criticalKeys={criticalKeys} />
      </section>

      {/* 3. Blockers */}
      <section className="section-card">
        <h3>Blockers</h3>
        <div className="dep-alerts">
          {!dc.items?.length ? (
            <p className="muted">No dependency conflicts flagged.</p>
          ) : (
            <table className="blockers-table">
              <thead>
                <tr>
                  <th>Blocker</th>
                  <th>Blocked</th>
                </tr>
              </thead>
              <tbody>
                {dc.items.map((x: any, _idx: number) => (
                  <tr key={_idx}>
                    <td className="blocker-cell">
                      <div className="issue-header">
                        <span className="issue-key">{x.blocker || x.key || ""}</span>
                        <span className="team-tag">{x.blocker_team || "—"}</span>
                      </div>
                      <div className="issue-summary">{x.blocker_summary || ""}</div>
                      <div className="issue-meta">
                        <span className="sprint-info">{x.blocker_sprint || "Unplanned"}{x.blocker_sprint_end ? ` (Ends: ${fmtDay(x.blocker_sprint_end)})` : ""}</span>
                      </div>
                    </td>
                    <td className="blocked-cell">
                      <div className="issue-header">
                        <span className="issue-key">{x.blocked || ""}</span>
                        <span className="team-tag">{x.blocked_team || "—"}</span>
                      </div>
                      <div className="issue-summary">{x.blocked_summary || x.summary || ""}</div>
                      <div className="issue-meta">
                        <span className="sprint-info">{x.blocked_sprint || "Unplanned"}{x.blocked_sprint_end ? ` (Ends: ${fmtDay(x.blocked_sprint_end)})` : ""}</span>
                        {x.reason && <span className="reason-tag">{x.reason}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* 4. Program Outlook (Elevated AI Insights) */}
      <section className="section-card">
        <h3><span className="sparkle">✨</span> Program Outlook</h3>
        <div className="ai-block">
          <h4><span className="sparkle">✨</span> Status summary by AI</h4>
          <div className="ai-summary" id="s-ai-summary">
            {assessmentData.ai_summary ? <ReactMarkdown>{assessmentData.ai_summary}</ReactMarkdown> : <p className="muted">–</p>}
          </div>
        </div>
        <div className="ai-block">
          <h4><span className="sparkle">✨</span> Forecast</h4>
          <div className="ai-summary">
            {assessmentData.forecast ? <p>{assessmentData.forecast}</p> : <p className="muted">–</p>}
          </div>
        </div>
        <div className="ai-block">
          <h4><span className="sparkle">✨</span> Risks by AI</h4>
          <div className="ai-summary">
            {assessmentData.risks?.length ? (
              <ul>
                {assessmentData.risks.map((x: any, i: number) => (
                  <li key={i}><strong>{x.finding}</strong> {x.severity ? `(${x.severity})` : ""}: {x.evidence}</li>
                ))}
              </ul>
            ) : <p className="muted">–</p>}
          </div>
        </div>
        <div className="ai-block">
          <h4><span className="sparkle">✨</span> Actions recommended by AI</h4>
          <div className="ai-summary">
            {assessmentData.recommended_actions?.length ? (
              <ul>
                {assessmentData.recommended_actions.map((a: string, i: number) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : <p className="muted">–</p>}
          </div>
        </div>
      </section>
    </section>
  );
};
