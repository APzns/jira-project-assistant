import React, { useState, useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { Assessment } from '../../types';

function predClass(val: number | null | undefined): string {
  if (val == null) return "";
  return val >= 90 ? "delta-green" : val >= 70 ? "delta-yellow" : "delta-red";
}

function defectClass(pct: number | string | null | undefined): string {
  if (pct == null || pct === "–") return "";
  const val = typeof pct === "number" ? pct : parseFloat(pct);
  if (isNaN(val)) return "";
  return val >= 30 ? "delta-red" : val >= 15 ? "delta-yellow" : "delta-green";
}

const COLORS = ["#4c8dff", "#a855f7", "#e05260", "#f5a623", "#3fbf7f", "#818cf8", "#ff7bb0", "#14b8a6", "#f43f5e", "#8b5cf6", "#0ea5e9", "#10b981", "#f97316"];
function teamColor(_teamName: string, idx: number): string {
  return COLORS[idx % COLORS.length];
}

interface PredictabilityTabProps {
  assessmentData: Assessment;
}

export default function PredictabilityTab({ assessmentData }: PredictabilityTabProps) {
  const m = assessmentData?.metrics || {};
  const overallStatus = assessmentData?.overall_status || "";
  const pt = m.points_by_sprint_team;
  const sprintProgress = m.sprint_progress || [];

  const [avgMode, setAvgMode] = useState<boolean>(true);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set(pt?.teams || []));
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const stateBySprint: Record<string, string> = {};
  sprintProgress.forEach((s: any) => { stateBySprint[s.sprint] = s.state; });

  const allTeams = pt?.teams || [];
  const sprints = pt?.sprints || [];

  // Derived Predictability KPIs
  let pctVal = m.predictability?.pct;
  if (pt && sprintProgress) {
    let closedComm = 0;
    let closedComp = 0;
    pt.sprints.forEach((s: string, i: number) => {
      if (stateBySprint[s] === "closed") {
        pt.teams.forEach((team: string) => {
          closedComm += (pt.committed[team] || [])[i] || 0;
          closedComp += (pt.completed[team] || [])[i] || 0;
        });
      }
    });
    if (closedComm > 0) {
      pctVal = Math.round(1000 * (closedComp / closedComm)) / 10;
    }
  }

  const oc = m.overcommit_next || {};
  let ocClass = "";
  if (oc.pct != null) {
    const equivPv = Math.round(100 / (1 + oc.pct / 100));
    ocClass = predClass(equivPv);
  }

  const drVal = m.defects_ratio?.pct;
  const dcCount = m.dependency_conflicts?.count;

  // AI Summary
  const summaryText = assessmentData?.predictability_summary || assessmentData?.predictability_comment || "";
  const recommendedActions = assessmentData?.recommended_actions || [];

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

  const setProgramAvg = () => {
    setAvgMode(true);
    setSelectedTeams(new Set(allTeams));
  };

  const setByTeam = () => {
    setAvgMode(false);
    if (selectedTeams.size === 0) setSelectedTeams(new Set(allTeams));
  };

  const setClearAll = () => {
    setAvgMode(false);
    setSelectedTeams(new Set());
  };

  const toggleRow = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  // ECharts Options
  const echartTeamPointsOption = useMemo(() => {
    if (!pt) return {};
    
    let lastClosed = -1;
    sprints.forEach((s: string, i: number) => { if (stateBySprint[s] === "closed") lastClosed = i; });

    const labels = sprints.map((s: string) => {
      const st = stateBySprint[s];
      return s + (st === "active" ? "\n(active)" : st === "closed" ? "" : "\n(planned)");
    });

    // Calc selData (committed, completed sums)
    const activeTeams = avgMode ? allTeams : allTeams.filter((t: string) => selectedTeams.has(t));
    const selCommitted = new Array(sprints.length).fill(0);
    const selCompleted = new Array(sprints.length).fill(0);
    activeTeams.forEach((team: string) => {
      (pt.committed[team] || []).forEach((v: number, i: number) => selCommitted[i] += (v || 0));
      (pt.completed[team] || []).forEach((v: number, i: number) => selCompleted[i] += (v || 0));
    });

    const series = [];

    if (avgMode) {
      const closedCompleted: number[] = [];
      sprints.forEach((_s: string, i: number) => { if (i <= lastClosed && selCompleted[i] != null) closedCompleted.push(selCompleted[i]); });
      const avgClosedCompleted = closedCompleted.length ? Math.round(closedCompleted.reduce((a, b) => a + b, 0) / closedCompleted.length) : 0;
      
      const completedWithForecast = sprints.map((_s: string, i: number) => i <= lastClosed ? selCompleted[i] : avgClosedCompleted);
      
      series.push({
        name: "Completed SP",
        type: "bar",
        data: completedWithForecast.map((val: number, i: number) => ({
          value: val,
          itemStyle: { color: i <= lastClosed ? "#4c8dff" : "rgba(76, 141, 255, 0.3)" }
        })),
        barWidth: '60%',
        z: 2
      });
      series.push({
        name: "Total Committed SP",
        type: "line",
        data: selCommitted,
        itemStyle: { color: "#818cf8" },
        lineStyle: { width: 3 },
        symbol: 'circle',
        symbolSize: 8,
        z: 3
      });
    } else {
      const teamAvgClosed: Record<string, number> = {};
      activeTeams.forEach((team: string) => {
        const vals: number[] = [];
        sprints.forEach((_s: string, i: number) => {
          if (i <= lastClosed) vals.push((pt.completed[team] || [])[i] || 0);
        });
        teamAvgClosed[team] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      });

      activeTeams.forEach((team: string) => {
        const idx = allTeams.indexOf(team);
        const col = teamColor(team, idx);
        const data = sprints.map((_s: string, i: number) => ({
          value: i <= lastClosed ? ((pt.completed[team] || [])[i] || 0) : teamAvgClosed[team],
          itemStyle: { color: i <= lastClosed ? col : `rgba(${parseInt(col.slice(1,3),16)},${parseInt(col.slice(3,5),16)},${parseInt(col.slice(5,7),16)}, 0.35)` }
        }));
        series.push({
          name: `Completed SP (${team})`,
          type: 'bar',
          stack: 'completed',
          data,
          barWidth: '60%',
          z: 2
        });
      });

      series.push({
        name: "Total Committed SP",
        type: "line",
        data: selCommitted,
        itemStyle: { color: "#818cf8" },
        lineStyle: { width: 3 },
        symbol: 'circle',
        symbolSize: 8,
        z: 3
      });
    }

    return {
      tooltip: { trigger: 'axis', backgroundColor: '#1e2430', borderColor: '#2a303c', textStyle: { color: '#e6e9ef' } },
      legend: { bottom: 0, textStyle: { color: '#9aa4b2' } },
      grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#9aa4b2' }, splitLine: { show: false } },
      yAxis: { type: 'value', name: 'Story Points', axisLabel: { color: '#9aa4b2' }, splitLine: { lineStyle: { color: 'rgba(42,48,60,0.6)' } }, nameTextStyle: { color: '#9aa4b2', fontWeight: 'bold' } },
      series
    };
  }, [pt, selectedTeams, avgMode, sprints, allTeams, stateBySprint]);

  const echartPredByTeamOption = useMemo(() => {
    if (!pt) return {};
    // let lastClosed = -1;
    // sprints.forEach((s: string, i: number) => { if (stateBySprint[s] === "closed") lastClosed = i; });

    const labels = sprints.map((s: string) => {
      const st = stateBySprint[s];
      return s + (st === "active" ? "\n(active)" : st === "closed" ? "" : "\n(planned)");
    });

    const series = [];

    if (avgMode) {
      const sprintPreds = sprints.map((_s: string, i: number) => {
        let totComm = 0, totComp = 0;
        allTeams.forEach((team: string) => {
          totComm += (pt.committed[team] || [])[i] || 0;
          totComp += (pt.completed[team] || [])[i] || 0;
        });
        return totComm === 0 ? null : Math.round((totComp / totComm) * 100);
      });
      const closedPreds = sprintPreds.filter((p: number | null, i: number) => stateBySprint[sprints[i]] === "closed" && p != null) as number[];
      const avgAllClosed = closedPreds.length ? Math.round(closedPreds.reduce((a, b) => a + b, 0) / closedPreds.length) : 0;
      
      const data = sprints.map((s: string, i: number) => {
        const st = stateBySprint[s];
        return (st === "closed" || st === "active") ? sprintPreds[i] : avgAllClosed;
      });

      series.push({
        name: "All-teams avg",
        type: 'line',
        data,
        itemStyle: { color: "#4c8dff" },
        lineStyle: { width: 3 },
        symbol: 'circle',
        symbolSize: 8,
      });
    } else {
      const activeTeams = allTeams.filter((t: string) => selectedTeams.has(t));
      activeTeams.forEach((team: string) => {
        const idx = allTeams.indexOf(team);
        const col = teamColor(team, idx);
        
        const teamPreds = sprints.map((_s: string, i: number) => {
          const comm = (pt.committed[team] || [])[i] || 0;
          const comp = (pt.completed[team] || [])[i] || 0;
          return comm === 0 ? null : Math.round((comp / comm) * 100);
        });
        
        const closedPreds = teamPreds.filter((p: number | null, i: number) => stateBySprint[sprints[i]] === "closed" && p != null) as number[];
        const avgClosed = closedPreds.length ? Math.round(closedPreds.reduce((a, b) => a + b, 0) / closedPreds.length) : 0;
        
        const data = sprints.map((s: string, i: number) => {
          const st = stateBySprint[s];
          const val = (st === "closed" || st === "active") ? teamPreds[i] : avgClosed;
          if (val == null) return null;
          return {
            value: val,
            itemStyle: { color: val >= 90 ? "#3fbf7f" : val >= 70 ? "#f5a623" : "#e05260" }
          };
        });

        series.push({
          name: team,
          type: 'line',
          data,
          itemStyle: { color: col },
          lineStyle: { width: 3, color: col },
          symbol: 'circle',
          symbolSize: 10,
        });
      });
    }

    return {
      title: { text: 'Predictability', textStyle: { color: '#9aa4b2', fontSize: 14 } },
      tooltip: { trigger: 'axis', backgroundColor: '#1e2430', borderColor: '#2a303c', textStyle: { color: '#e6e9ef' }, valueFormatter: (val: number) => val + '%' },
      legend: { bottom: 0, textStyle: { color: '#9aa4b2' } },
      grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#9aa4b2' }, splitLine: { show: false } },
      yAxis: { type: 'value', axisLabel: { color: '#9aa4b2', formatter: '{value}%' }, splitLine: { lineStyle: { color: 'rgba(42,48,60,0.6)' } } },
      series
    };
  }, [pt, selectedTeams, avgMode, sprints, allTeams, stateBySprint]);


  // Table Data Preparation
  const activeTeamsSet = avgMode ? new Set(allTeams) : selectedTeams;
  const allDataCommitted = new Array(sprints.length).fill(0);
  const allDataCompleted = new Array(sprints.length).fill(0);
  activeTeamsSet.forEach(team => {
    (pt?.committed[team] || []).forEach((v: number, i: number) => allDataCommitted[i] += (v || 0));
    (pt?.completed[team] || []).forEach((v: number, i: number) => allDataCompleted[i] += (v || 0));
  });

  const avgAllVals: number[] = [];
  sprints.forEach((s: string, i: number) => { if (stateBySprint[s] === "closed") avgAllVals.push(allDataCompleted[i]); });
  const avgRounded = avgAllVals.length ? Math.round(avgAllVals.reduce((a,b)=>a+b,0)/avgAllVals.length) : 0;

  const teamAvg: Record<string, number> = {};
  allTeams.forEach((t: string) => {
    const vals: number[] = [];
    sprints.forEach((s: string, j: number) => {
      if (stateBySprint[s] === "closed") vals.push((pt?.completed[t] || [])[j] || 0);
    });
    teamAvg[t] = vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
  });

  const pctOf = (completed: number, committed: number) => committed ? Math.round(100 * completed / committed) : 0;

  return (
    <>
      <h2>Predictability</h2>

      <section className="section-card">
        <h3>Health <span id="p-badge" className={`badge ${overallStatus}`}>{overallStatus.replace('_', ' ') || "–"}</span></h3>
        <div className="health-card">
          <div className="kpi-strip kpi-strip-4">
            <div className="kpi">
              <div className="kpi-label">Past predictability</div>
              <div className={`kpi-value ${pctVal != null ? predClass(pctVal) : ""}`} id="p-predictability">{pctVal == null ? "–" : `${pctVal}%`}</div>
              <div className="kpi-sub">average points completed vs. committed in closed sprints</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Next sprint commitment</div>
              <div className={`kpi-value ${ocClass}`} id="p-overcommit">{oc.pct == null ? "–" : `${oc.pct > 0 ? "+" : ""}${Math.round(oc.pct)}% vs avg`}</div>
              <div className="kpi-sub">committed vs. average closed-sprint velocity</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Defects ratio</div>
              <div className={`kpi-value ${defectClass(drVal)}`} id="p-defects">{drVal == null ? "–" : `${drVal}%`}</div>
              <div className="kpi-sub">Defects SP / Total SP (closed sprints)</div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Unresolved blockers</div>
              <div className={`kpi-value ${dcCount != null ? (dcCount > 0 ? "delta-red" : "delta-green") : ""}`} id="p-depconflicts">{dcCount == null ? "–" : dcCount}</div>
              <div className="kpi-sub">active blockers from dependency conflicts / blocked issues</div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-card">
        <h3>Predictability statistics</h3>
        
        {/* Team Filter */}
        <div id="pred-team-filter" className="team-filter">
          {pt && pt.sprints && pt.sprints.length > 0 ? (
            <div className="team-filter-bar">
              <div className="team-mode-group">
                <button type="button" className={`mode-btn ${avgMode ? "active" : ""}`} onClick={setProgramAvg}>Program average</button>
                <button type="button" className={`mode-btn ${!avgMode && selectedTeams.size > 0 ? "active" : ""}`} onClick={setByTeam}>By team</button>
                <button type="button" className={`mode-btn ${!avgMode && selectedTeams.size === 0 ? "active" : ""}`} onClick={setClearAll}>Clear all</button>
              </div>
              <div className="team-chip-row">
                {allTeams.map((team: string, idx: number) => {
                  const on = !avgMode && selectedTeams.has(team);
                  const col = teamColor(team, idx);
                  return (
                    <label key={team} className={`team-chip ${on ? "on" : ""}`} style={{ '--team-col': col } as React.CSSProperties}>
                      <input type="checkbox" checked={on} onChange={() => toggleTeam(team)} />
                      <i className="team-dot" style={{ background: col }}></i>
                      <span className="team-chip-name">{team}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : (
            <span className="muted">No sprint/team data yet.</span>
          )}
        </div>

        {pt && pt.sprints && pt.sprints.length > 0 && (
          <>
            <div className="charts-row-2">
              <div>
                <h4 className="chart-subtitle">Committed vs completed</h4>
                <div className="chart-box">
                  <ReactECharts option={echartTeamPointsOption} style={{ height: '100%', width: '100%' }} />
                </div>
              </div>
              <div>
                <h4 className="chart-subtitle">Predictability by team</h4>
                <div className="chart-box">
                  <ReactECharts option={echartPredByTeamOption} style={{ height: '100%', width: '100%' }} />
                </div>
              </div>
            </div>

            <table className="data-table" id="delivery-table">
              <thead>
                <tr><th>Sprint</th><th>Committed SP</th><th>Completed SP</th><th>Predictability</th><th></th></tr>
              </thead>
              <tbody>
                {sprints.map((sprint: string, i: number) => {
                  const st = stateBySprint[sprint] || "future";
                  const isSettled = (st === "closed");
                  const committed = allDataCommitted[i];
                  const completedVal = isSettled ? allDataCompleted[i] : avgRounded;
                  const pv = pctOf(completedVal, committed);
                  const pCls = predClass(pv);
                  const tag = st === "closed" ? "closed" : st === "active" ? "active" : "planned";
                  const rowId = "pt-" + i;
                  const isExp = expandedRows.has(rowId);

                  return (
                    <React.Fragment key={sprint}>
                      <tr className="sprint-row">
                        <td>
                          <button type="button" className="tree-toggle-btn per-team-toggle" onClick={() => toggleRow(rowId)}>
                            <span className="tree-icon">{isExp ? "▼" : "►"}</span>
                            <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "13px" }}>{sprint}</span>
                          </button>
                          <span className={`sprint-state s-${st}`}>{tag}</span>
                        </td>
                        <td>{committed} SP</td>
                        <td className={pCls}>{completedVal} SP</td>
                        <td className={pCls}>
                          {isSettled ? `${pv}%` : <>{pv}% <span className="vs-avg">vs avg ({avgRounded} SP)</span></>}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button type="button" className="per-team-toggle link-btn" onClick={() => toggleRow(rowId)}>
                            {isExp ? 'Teams ▴' : 'Teams ▾'}
                          </button>
                        </td>
                      </tr>
                      {isExp && allTeams.map((t: string, tIdx: number) => {
                        const c = (pt.committed[t] || [])[i] || 0;
                        const done = (pt.completed[t] || [])[i] || 0;
                        const basis = isSettled ? done : teamAvg[t];
                        const teamP = c > 0 ? pctOf(basis, c) : null;
                        const teamCls = teamP != null ? predClass(teamP) : "";
                        const swatch = <i className="team-swatch" style={{ background: teamColor(t, tIdx) }}></i>;

                        return (
                          <tr key={`${sprint}-${t}`} className="per-team-row">
                            <td className="team-cell" style={{ paddingLeft: "20px" }}>
                              <span className="tree-line">├──</span>
                              {swatch}
                              <span style={{ color: "#ffffff", fontWeight: 600, fontSize: "13px" }}>{t}</span>
                            </td>
                            <td>{c} SP</td>
                            <td className={teamCls}>{basis} SP</td>
                            <td className={teamCls}>
                              {teamP != null ? (
                                isSettled ? `${teamP}%` : <>{teamP}% <span className="vs-avg">vs avg ({teamAvg[t]} SP)</span></>
                              ) : (
                                isSettled ? `–` : <>– <span className="vs-avg">vs avg ({teamAvg[t]} SP)</span></>
                              )}
                            </td>
                            <td></td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="section-card ai-block">
        <h3><span className="sparkle">✨</span> AI Summary</h3>
        <div className="ai-summary" id="delivery-ai-summary">
          {summaryText ? <div dangerouslySetInnerHTML={{ __html: summaryText }} /> : <p className="muted">–</p>}
        </div>
      </section>

      <section className="section-card ai-block">
        <h3><span className="sparkle">✨</span> Recommended Actions by AI</h3>
        <div className="ai-summary">
          <ul className="actions" style={{ margin: 0 }} id="delivery-ai-actions">
            {recommendedActions.length > 0 ? (
              recommendedActions.map((a: string, i: number) => <li key={i}>{a}</li>)
            ) : (
              <li className="muted">No actions specified.</li>
            )}
          </ul>
        </div>
      </section>
    </>
  );
}
