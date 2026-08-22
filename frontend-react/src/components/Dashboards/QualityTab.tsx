import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import ReactECharts from 'echarts-for-react';
import type { Assessment } from '../../types';

// Mock color generator for teams to match utility functionality
const teamColor = (teamName: string, index?: number): string => {
  const colors = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'
  ];
  if (index !== undefined) return colors[index % colors.length];
  let hash = 0;
  for (let i = 0; i < teamName.length; i++) {
    hash = teamName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const defectClass = (pct: number | string | undefined | null): string => {
  if (pct == null || pct === "–") return "";
  const val = typeof pct === "number" ? pct : parseFloat(pct as string);
  if (isNaN(val)) return "";
  return val >= 30 ? "delta-red" : val >= 15 ? "delta-yellow" : "delta-green";
};

interface QualityTabProps {
  assessmentData: Assessment;
}

export const QualityTab: React.FC<QualityTabProps> = ({ assessmentData }) => {
  // Extract metrics & bug stats (using any to match legacy properties not strongly typed in types.ts)
  const m: any = assessmentData?.metrics || {};
  const bs = m.bug_stats || {};
  const rawItems: any[] = bs.defects_per_sprint || [];
  
  // Extract unique teams
  const allTeams = useMemo(() => {
    const teamsSet = new Set<string>();
    rawItems.forEach(it => { if (it.team) teamsSet.add(it.team); });
    return Array.from(teamsSet).sort();
  }, [rawItems]);

  // States for filtering
  const [avgMode, setAvgMode] = useState<boolean>(false);
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set(allTeams));
  const [expandedSprints, setExpandedSprints] = useState<Set<string>>(new Set());

  // Update selected teams if allTeams change (like on mount)
  // To avoid infinite loops, we just initialize the state with allTeams once, 
  // but if new data arrives, we might want to reset. We'll leave it as is for simplicity.

  const toggleTeam = (tName: string) => {
    if (avgMode) {
      setAvgMode(false);
      setSelectedTeams(new Set([tName]));
    } else {
      const next = new Set(selectedTeams);
      if (next.has(tName)) next.delete(tName);
      else next.add(tName);
      setSelectedTeams(next);
    }
  };

  const setAverageMode = () => {
    setAvgMode(true);
    setSelectedTeams(new Set(allTeams));
  };

  const setAllTeams = () => {
    setAvgMode(false);
    setSelectedTeams(new Set(allTeams));
  };

  const clearTeams = () => {
    setAvgMode(false);
    setSelectedTeams(new Set());
  };

  const toggleSprint = (sprintId: string) => {
    const next = new Set(expandedSprints);
    if (next.has(sprintId)) next.delete(sprintId);
    else next.add(sprintId);
    setExpandedSprints(next);
  };

  // Filter items based on selected teams
  const filteredItems = useMemo(() => {
    if (!avgMode) {
      return rawItems.filter(it => selectedTeams.has(it.team));
    }
    return rawItems;
  }, [rawItems, avgMode, selectedTeams]);

  const isAllTeamsSelected = avgMode || selectedTeams.size === allTeams.length;

  // Process data for table
  const sprintsMap = new Map<string, any[]>();
  filteredItems.forEach(item => {
    const sName = item.sprint || "Unplanned";
    if (!sprintsMap.has(sName)) sprintsMap.set(sName, []);
    sprintsMap.get(sName)!.push(item);
  });

  const sprintRows: any[] = [];
  let sumOfClosedSprintRatios = 0;
  let closedSprintCount = 0;

  let sprintIdx = 0;
  sprintsMap.forEach((teamItems, sprintName) => {
    const rowId = "qpt-" + sprintIdx;
    const isExp = expandedSprints.has(rowId);
    const firstItem = teamItems[0] || {};
    const stState = (firstItem.sprint_state || "closed").toLowerCase();
    const isClosed = (stState === "closed");
    
    const sprintBugSp = teamItems.reduce((acc, it) => acc + (it.bug_sp ?? 0), 0);
    const sprintOtherSp = teamItems.reduce((acc, it) => acc + (it.other_sp ?? 0), 0);

    let sumOfPercentages = 0;
    let validTeamsCount = 0;

    const perTeamRows = teamItems.map((it, idx) => {
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

      return {
        key: `${rowId}-${idx}`,
        tName, tBugSp, tOtherSp, tRatio,
        tRatioCls: defectClass(tRatio),
        color: teamColor(tName)
      };
    });

    const sprintRatio = validTeamsCount > 0
      ? Math.round((sumOfPercentages / validTeamsCount) * 10) / 10
      : 0.0;
    
    if (isClosed) {
      sumOfClosedSprintRatios += sprintRatio;
      closedSprintCount++;
    }

    sprintRows.push({
      rowId, isExp, sprintName, isClosed,
      sprintBugSp, sprintOtherSp, sprintRatio,
      sprintRatioCls: defectClass(sprintRatio),
      perTeamRows
    });
    sprintIdx++;
  });

  let overallRatioNum = 0.0;
  if (isAllTeamsSelected && typeof bs.defects_ratio_pct === "number") {
    overallRatioNum = bs.defects_ratio_pct;
  } else if (closedSprintCount > 0) {
    overallRatioNum = Math.round((sumOfClosedSprintRatios / closedSprintCount) * 10) / 10;
  }

  // Chart data
  const chartOptions = useMemo(() => {
    if (!rawItems.length) return null;
    const teamData: Record<string, { bug_sp: number; total_sp: number }> = {};
    rawItems.forEach(item => {
      const t = item.team || "Unassigned";
      if (!teamData[t]) teamData[t] = { bug_sp: 0, total_sp: 0 };
      teamData[t].bug_sp += item.bug_sp || 0;
      teamData[t].total_sp += item.total_sp || 0;
    });

    const teams = Object.keys(teamData).sort();
    const ratios = teams.map(t => {
      const tot = teamData[t].total_sp;
      return tot > 0 ? Math.round(100 * teamData[t].bug_sp / tot) : 0;
    });

    return {
      grid: { left: 40, right: 20, top: 20, bottom: 30 },
      tooltip: { trigger: 'axis', formatter: '{b}: {c}%' },
      xAxis: {
        type: 'category',
        data: teams,
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        max: 100,
        axisLabel: { formatter: '{value}%' },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } }
      },
      series: [
        {
          name: 'Defect SP Ratio',
          type: 'bar',
          data: ratios.map((r, i) => ({
            value: r,
            itemStyle: { color: teamColor(teams[i]) }
          })),
          itemStyle: { borderRadius: [4, 4, 0, 0] }
        }
      ]
    };
  }, [rawItems]);

  return (
    <section id="tab-quality" className="tab-panel" style={{ display: 'block' }}>
      <h2>Quality</h2>
      
      <section className="section-card">
        <h3>Quality statistics</h3>
        
        <div id="q-team-filter" className="team-filter">
          <div className="team-filter-bar">
            <div className="team-mode-group">
              <span className="filter-title">FILTER BY TEAM:</span>
              {/* Only show Average button if implemented in JS originally? (it checks stateObj.showAverage, assume true here or omit. We include for completeness) */}
              <button type="button" className={`mode-btn ${avgMode ? "active" : ""}`} onClick={setAverageMode}>Average</button>
              <button type="button" className={`mode-btn ${!avgMode && selectedTeams.size === allTeams.length ? "active" : ""}`} onClick={setAllTeams}>All teams</button>
              <button type="button" className={`mode-btn ${!avgMode && selectedTeams.size === 0 ? "active" : ""}`} onClick={clearTeams}>Clear selection</button>
            </div>
            <div className="team-chip-row">
              {allTeams.map((team, idx) => {
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
        </div>

        <div id="q-defects-summary" style={{ fontWeight: 500, fontSize: 15, marginBottom: 16 }}>
          {filteredItems.length > 0 ? (
            <>
              Defects ratio: <strong className={defectClass(overallRatioNum)}>{overallRatioNum}%</strong> <span className="muted">avg(Sprint Defect Ratios) — Bug SP / Total SP per team (closed sprints)</span>
            </>
          ) : (
             <>
               Defects ratio: <strong className={defectClass(bs.defects_ratio_pct)}>{bs.defects_ratio_pct ?? "–"}%</strong> <span className="muted">avg(Sprint Defect Ratios) — Bug SP / Total SP per team (closed sprints)</span>
             </>
          )}
        </div>

        <div id="q-defects-table" style={{ marginBottom: 16 }}>
          {!filteredItems.length ? (
            <p className="muted">No defect breakdown available.</p>
          ) : (
            <table className="data-table" id="quality-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>SPRINT</th>
                  <th style={{ width: '18%' }}>DEFECT SP</th>
                  <th style={{ width: '18%' }}>OTHER SP</th>
                  <th style={{ width: '14%' }}>DEFECT RATIO</th>
                  <th style={{ width: '10%', textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {sprintRows.map(sr => (
                  <React.Fragment key={sr.rowId}>
                    <tr className="sprint-row">
                      <td>
                        <button type="button" className="tree-toggle-btn per-team-toggle" onClick={() => toggleSprint(sr.rowId)}>
                          <span className="tree-icon">{sr.isExp ? "▼" : "►"}</span>
                          <span style={{ color: '#ffffff', fontWeight: 600, fontSize: 13 }}>{sr.sprintName}</span>
                        </button>
                        <span className={`sprint-state ${sr.isClosed ? "s-closed" : "s-active"}`}>
                          {sr.isClosed ? "completed" : "active"}
                        </span>
                      </td>
                      <td className={sr.sprintRatioCls}>{sr.sprintBugSp} SP</td>
                      <td>{sr.sprintOtherSp} SP</td>
                      <td className={sr.sprintRatioCls}>{sr.sprintRatio}%</td>
                      <td style={{ textAlign: 'right' }}>
                        <button type="button" className="per-team-toggle link-btn" onClick={() => toggleSprint(sr.rowId)}>
                          {sr.isExp ? 'Teams ▴' : 'Teams ▾'}
                        </button>
                      </td>
                    </tr>
                    {sr.isExp && sr.perTeamRows.map((ptr: any) => (
                      <tr key={ptr.key} className="per-team-row">
                        <td className="team-cell" style={{ paddingLeft: 20 }}>
                          <span className="tree-line">├──</span>
                          <i className="team-swatch" style={{ background: ptr.color }}></i>
                          <span style={{ color: '#ffffff', fontWeight: 600, fontSize: 13 }}>{ptr.tName}</span>
                        </td>
                        <td className={ptr.tRatioCls}>{ptr.tBugSp} SP</td>
                        <td>{ptr.tOtherSp} SP</td>
                        <td className={ptr.tRatioCls}>{ptr.tRatio}%</td>
                        <td></td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {chartOptions && (
          <div className="chart-box" style={{ marginTop: '20px', height: '300px' }}>
            <ReactECharts option={chartOptions} style={{ height: '100%', width: '100%' }} />
          </div>
        )}
      </section>

      <section className="section-card ai-block">
        <h3><span className="sparkle">✨</span> AI Summary</h3>
        <div className="ai-summary" id="quality-ai-summary">
          {assessmentData?.ai_summary ? (
            <ReactMarkdown>{assessmentData.ai_summary}</ReactMarkdown>
          ) : (
            <p className="muted">–</p>
          )}
        </div>
      </section>

      <section className="section-card ai-block">
        <h3><span className="sparkle">✨</span> Next Steps Suggestions by AI</h3>
        <div className="ai-summary">
          <ul className="actions" style={{ margin: 0 }} id="quality-ai-actions">
            {assessmentData?.recommended_actions?.length ? (
              assessmentData.recommended_actions.map((action, i) => (
                <li key={i}>{action}</li>
              ))
            ) : (
              <p className="muted">–</p>
            )}
          </ul>
        </div>
      </section>
    </section>
  );
};
