import React from 'react';
import ReactECharts from 'echarts-for-react';
import type { Assessment } from '../../types';

interface AssessmentTabProps {
  assessmentData: Assessment | null;
  onRefresh?: () => void;
}

const fmtDay = (iso?: string) => {
  if (!iso) return "–";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
};

const formatForecastDelay = (delay?: number | null) => {
  if (delay === undefined || delay === null) {
    return { text: "–", className: "" };
  }
  const text = delay > 0 ? `+${delay}d` : `${delay}d`;
  let className = "delta-red";
  if (delay <= 5) {
    className = "delta-green";
  } else if (delay <= 10) {
    className = "delta-yellow";
  }
  return { text, className };
};

const normName = (str?: string) => (str || "").toLowerCase().replace(/[–—−]/g, "-").replace(/\s+/g, " ").trim();
const getPrefix = (str?: string) => {
  const match = normName(str).match(/^(m\d+)/);
  return match ? match[1] : null;
};

import ReactMarkdown from 'react-markdown';

// Component wrapper to render markdown text inline or as blocks
const renderTextWithLineBreaks = (text: string) => {
  return <ReactMarkdown>{text}</ReactMarkdown>;
};

export const AssessmentTab: React.FC<AssessmentTabProps> = ({ assessmentData, onRefresh }) => {
  if (!assessmentData) {
    return (
      <section id="tab-assessment" className="tab-panel active">
        <div className="panel-head">
          <div className="program-summary">
            <h2>Project Status summary</h2>
            <p className="program-desc">
              A program to modernize the commerce platform: redesigning checkout,
              achieving mobile parity, hardening security, compliance, and performance,
              and standing up a unified analytics foundation, culminating in a phased
              go-live in Q4 2026.
            </p>
          </div>
          <div className="panel-head-actions">
            <button id="assess-button" className="btn-primary" onClick={onRefresh}>Refresh report</button>
          </div>
        </div>
        <p id="assess-empty" className="muted">
          No report yet. Click “Refresh report” to generate one.
        </p>
      </section>
    );
  }

  const d = assessmentData;
  const noticeText = d.notice || (d as any).warning;

  // Calculate logic
  const m = d.metrics || {} as any;
  const ms = m.milestone_completion || {};
  const msKeys = Object.keys(ms);
  const aiMilestones = d.milestones || [];

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

  const onTrackCount = Math.max(0, totalMs - delayedCount);
  let milestoneColorClass = "delta-green";
  if (delayedCount === 1) milestoneColorClass = "delta-yellow";
  else if (delayedCount > 1) milestoneColorClass = "delta-red";

  const overdue = m.overdue_points_pct;
  const delayFormatted = formatForecastDelay(m.forecast_delay_days);

  // Monte Carlo chart config
  const mc = d.monte_carlo;
  let echartsOption = {};
  if (mc) {
    const forecastData = mc.forecast || [];
    const actualSeriesData = (mc.actual || []).map((p: any) => [new Date(p.x).getTime(), p.y]);
    const p50SeriesData = (mc.p50_line && mc.p50_line.length ? mc.p50_line : forecastData).map((p: any) => [new Date(p.x).getTime(), p.y]);
    const p80SeriesData = (mc.p80_line && mc.p80_line.length ? mc.p80_line : forecastData).map((p: any) => [new Date(p.x).getTime(), p.y]);

    const markLines = [];
    if (mc.target_date) markLines.push({ xAxis: new Date(mc.target_date).getTime(), lineStyle: { color: '#dc2626', width: 2, type: 'dashed' }, label: { formatter: 'Target', position: 'start', color: '#991b1b', fontWeight: 'bold' }});
    if (mc.p50_date) markLines.push({ xAxis: new Date(mc.p50_date).getTime(), lineStyle: { color: '#2563eb', width: 2, type: 'dashed' }, label: { formatter: 'P50', position: 'start', color: '#1e40af', fontWeight: 'bold' }});
    if (mc.p80_date) markLines.push({ xAxis: new Date(mc.p80_date).getTime(), lineStyle: { color: '#d97706', width: 2, type: 'dashed' }, label: { formatter: 'P80', position: 'start', color: '#92400e', fontWeight: 'bold' }});
    if (mc.total_scope) markLines.push({ yAxis: mc.total_scope, lineStyle: { color: '#64748b', width: 1.5, type: 'dashed' }, label: { formatter: 'Target Scope', position: 'end', color: '#1e293b', fontWeight: 'bold' }});

    echartsOption = {
      tooltip: { trigger: 'axis' },
      legend: { textStyle: { color: '#1e293b', fontWeight: 600, fontSize: 12 }, itemGap: 20 },
      grid: { left: '3%', right: '8%', bottom: '3%', containLabel: true },
      xAxis: { 
        type: 'time', 
        axisLabel: { color: '#334155', fontWeight: 600 }, 
        splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } }
      },
      yAxis: { 
        type: 'value', 
        axisLabel: { color: '#334155', fontWeight: 600 }, 
        splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.2)' } }
      },
      series: [
        {
          name: 'Delivered (Cumulative SP)',
          type: 'line',
          data: actualSeriesData,
          itemStyle: { color: '#2563eb' },
          areaStyle: { color: 'rgba(37, 99, 235, 0.12)' },
          smooth: true,
          showSymbol: true,
          symbolSize: 6,
          markLine: { data: markLines, symbol: 'none' }
        },
        {
          name: 'P50 Likely Forecast',
          type: 'line',
          data: p50SeriesData,
          itemStyle: { color: '#0284c7' },
          lineStyle: { type: 'dashed', width: 2.5 },
          showSymbol: false,
          smooth: true,
        },
        {
          name: 'P80 Conservative Forecast',
          type: 'line',
          data: p80SeriesData,
          itemStyle: { color: '#d97706' },
          lineStyle: { type: 'dashed', width: 2.5 },
          showSymbol: false,
          smooth: true,
        }
      ]
    };
  }

  const renderMilestoneTimeline = () => {
    const keys = Object.keys(ms || {});
    if (!keys.length) return <p className="muted">No milestone data.</p>;

    keys.sort((a, b) => {
      const ra = ms[a].release_date || "9999-99-99";
      const rb = ms[b].release_date || "9999-99-99";
      return ra < rb ? -1 : ra > rb ? 1 : 0;
    });

    const seg = (cls: string, pct: number, label: string) => pct > 0 ? (
      <div className={`mt-seg ${cls}`} style={{ width: `${pct}%` }} title={`${label} ${pct}%`}>
        {pct >= 8 ? `${pct}%` : ""}
      </div>
    ) : null;

    return (
      <>
        {keys.map(k => {
          const e = ms[k];
          const t = e.total || 0;
          const dPct = e.percent_done ?? (t ? Math.round(100 * (e.done || 0) / t) : 0);
          const tdPct = Math.max(0, 100 - dPct);
          const rel = e.release_date ? fmtDay(e.release_date) : "–";

          return (
            <div className="mt-row" key={k}>
              <div className="mt-head">
                <span className="mt-name">{k}</span>
                <span className="mt-meta">{e.done || 0}/{t} done · rel {rel}</span>
              </div>
              <div className="mt-track">
                {seg("done", dPct, "Done")}
                {dPct === 0 ? (
                  <div className="mt-seg todo" style={{ width: '100%' }} title="To Do 100%"></div>
                ) : (
                  seg("todo", tdPct, "To Do")
                )}
              </div>
            </div>
          );
        })}
        <div className="mt-legend">
          <span><i className="mt-dot done"></i> Done</span>
          <span><i className="mt-dot todo"></i> To Do</span>
        </div>
      </>
    );
  };

  return (
    <section id="tab-assessment" className="tab-panel active">
      <div className="panel-head">
        <div className="program-summary">
          <h2>Project Status summary</h2>
          <p className="program-desc">
            A program to modernize the commerce platform: redesigning checkout,
            achieving mobile parity, hardening security, compliance, and performance,
            and standing up a unified analytics foundation, culminating in a phased
            go-live in Q4 2026.
          </p>
        </div>
        <div className="panel-head-actions">
          <button id="assess-button" className="btn-primary" onClick={onRefresh}>Refresh report</button>
        </div>
      </div>

      {noticeText && (
        <div id="assess-notice" className="info-banner">
          <span className="info-badge">Offline Fallback</span> {noticeText}
        </div>
      )}

      <div id="assess-result">
        {/* HEALTH */}
        <section className="section-card">
          <h3>Health</h3>
          <div className="health-card">
            <div className="kpi-strip kpi-strip-4">
              <div className="kpi">
                <div className="kpi-label">Status</div>
                <div className="kpi-value">
                  <span id="c-badge" className={`badge ${d.overall_status || ""}`}>
                    {(d.overall_status || "–").replace("_", " ")}
                  </span>
                </div>
                <div className="kpi-sub">overall program status assessment</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Milestones On Track</div>
                <div className="kpi-value" id="c-milestones">
                  {!totalMs ? "–" : <span className={milestoneColorClass}>{onTrackCount}/{totalMs}</span>}
                </div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Overdue</div>
                <div className="kpi-value warn" id="c-overdue">
                  {overdue === undefined || overdue === null ? "–" : `${overdue}%`}
                </div>
                <div className="kpi-sub">% of delayed work (story points in versions with past release date)</div>
              </div>
              <div className="kpi">
                <div className="kpi-label">Completion forecast</div>
                <div className={`kpi-value warn ${delayFormatted.className}`} id="c-delay">
                  {delayFormatted.text}
                </div>
                <div className="kpi-sub">projected delay vs. target (days), Monte Carlo P50</div>
              </div>
            </div>
          </div>
        </section>

        {/* MILESTONE PROGRESS TIMELINE */}
        <section className="section-card">
          <h3>Milestone Timeline</h3>
          <div className="milestone-timeline" id="a-milestone-timeline">
            {renderMilestoneTimeline()}
          </div>
        </section>

        {/* MONTE CARLO FORECAST */}
        <section className="section-card">
          <h3>Monte Carlo Forecast <span className="sub-header">cumulative throughput vs. projection</span></h3>
          {mc && (
            <div className="chart-box" style={{ height: '350px' }}>
              <ReactECharts option={echartsOption} style={{ height: '100%', width: '100%' }} />
            </div>
          )}
          <p id="mc-note" className="chart-note muted">
            {mc?.target_date && <span style={{ color: '#dc2626', fontWeight: 600 }}>🎯 Target Date: <strong>{mc.target_date}</strong></span>}
            {mc?.p50_date && <>&nbsp;|&nbsp;<span style={{ color: '#2563eb', fontWeight: 600 }}>🔵 P50 Est: <strong>{mc.p50_date}</strong></span></>}
            {mc?.p80_date && <>&nbsp;|&nbsp;<span style={{ color: '#d97706', fontWeight: 600 }}>🟡 P80 Est: <strong>{mc.p80_date}</strong></span></>}
            {mc?.total_scope && <>&nbsp;|&nbsp;<span style={{ color: '#334155', fontWeight: 600 }}>📊 Target Scope: <strong>{mc.total_scope} SP</strong></span></>}
          </p>

          <div className="ai-summary forecast" id="a-forecast">
            <p className={d.forecast ? "" : "muted"}>{d.forecast || "–"}</p>
          </div>
        </section>

        {/* MILESTONES status by AI */}
        <section className="section-card">
          <h3><span className="sparkle">✨</span> Milestones status by AI</h3>
          <div id="a-milestones">
            {(d.milestones || []).map((x: any, i: number) => {
              const st = x.status || '';
              return (
                <div key={i} className={`item ${st}`}>
                  <div className="item-title">
                    {x.name} <span className={`badge ${st}`} style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px' }}>{st.replace('_', ' ')}</span>
                  </div>
                  <div className="item-body">
                    {renderTextWithLineBreaks(x.assessment || "")}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* RISKS */}
        <section className="section-card">
          <h3><span className="sparkle">✨</span> Risks by AI</h3>
          <div id="a-risks">
            {!(d.risks || []).length ? (
              <p className="item-body">No risks triggered.</p>
            ) : (
              (d.risks || []).map((x: any, i: number) => {
                const sev = (x.severity || '').toLowerCase();
                const badgeCls = sev === 'high' || sev === 'critical' ? 'off_track' : sev === 'medium' ? 'at_risk' : 'on_track';
                return (
                  <div key={i} className={`item ${sev}`}>
                    <div className="item-title">
                      {x.finding} <span className={`badge ${badgeCls}`} style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px' }}>{sev}</span>
                    </div>
                    <div className="item-body">
                      {renderTextWithLineBreaks(x.evidence || "")}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* AI SUMMARY */}
        <section className="section-card ai-block">
          <h3><span className="sparkle">✨</span> AI Summary</h3>
          <div className="ai-summary" id="a-ai-summary">
            {d.ai_summary ? (
              <div>{renderTextWithLineBreaks(d.ai_summary)}</div>
            ) : (
              <p className="muted">–</p>
            )}
          </div>
        </section>

        {/* AI RECOMMENDED ACTIONS */}
        <section className="section-card ai-block">
          <h3><span className="sparkle">✨</span> Actions recommended by AI</h3>
          <div className="ai-summary">
            <ul className="actions" style={{ margin: 0 }} id="a-actions">
              {(d.recommended_actions || []).map((a: string, i: number) => (
                <li key={i} className="action-item">{a}</li>
              ))}
            </ul>
          </div>
        </section>

      </div>
    </section>
  );
};
