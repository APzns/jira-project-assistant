import { $, hexToRgba, teamColor } from "../utils.js";
import { state } from "../state.js";

if (typeof Chart !== "undefined") {
  Chart.defaults.color = "#475569";
  Chart.defaults.font.family = "-apple-system, 'Segoe UI', Roboto, sans-serif";
  Chart.defaults.font.size = 12;
}

export function renderMonteCarloChart(mc) {
  const canvas = $("monteCarloChart");
  if (!canvas || !mc) return;

  if (state.monteCarloChart) {
    state.monteCarloChart.destroy();
    state.monteCarloChart = null;
  }

  const actualData = (mc.actual || []).map(p => ({ x: p.x, y: p.y }));
  const forecastData = (mc.forecast || []).map(p => ({ x: p.x, y: p.y }));

  const annotations = {};

  function formatShortDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  if (mc.target_date) {
    const formattedTarget = formatShortDate(mc.target_date);
    annotations.targetLine = {
      type: 'line',
      xMin: mc.target_date,
      xMax: mc.target_date,
      borderColor: '#dc2626',
      borderWidth: 2,
      borderDash: [5, 5],
      label: {
        display: true,
        content: `Target: ${formattedTarget || mc.target_date}`,
        position: 'start',
        backgroundColor: '#fee2e2',
        color: '#991b1b',
        borderColor: '#fca5a5',
        borderWidth: 1,
        borderRadius: 4,
        padding: 5,
        font: { size: 11, weight: 'bold' }
      }
    };
  }

  if (mc.p50_date) {
    const formattedP50 = formatShortDate(mc.p50_date);
    annotations.p50Line = {
      type: 'line',
      xMin: mc.p50_date,
      xMax: mc.p50_date,
      borderColor: '#2563eb',
      borderWidth: 2,
      borderDash: [5, 5],
      label: {
        display: true,
        content: `P50: ${formattedP50 || mc.p50_date}`,
        position: 'start',
        backgroundColor: '#dbeafe',
        color: '#1e40af',
        borderColor: '#93c5fd',
        borderWidth: 1,
        borderRadius: 4,
        padding: 5,
        font: { size: 11, weight: 'bold' }
      }
    };
  }

  if (mc.p80_date) {
    const formattedP80 = formatShortDate(mc.p80_date);
    annotations.p80Line = {
      type: 'line',
      xMin: mc.p80_date,
      xMax: mc.p80_date,
      borderColor: '#d97706',
      borderWidth: 2,
      borderDash: [5, 5],
      label: {
        display: true,
        content: `P80: ${formattedP80 || mc.p80_date}`,
        position: 'start',
        backgroundColor: '#fef3c7',
        color: '#92400e',
        borderColor: '#fcd34d',
        borderWidth: 1,
        borderRadius: 4,
        padding: 5,
        font: { size: 11, weight: 'bold' }
      }
    };
  }

  if (mc.total_scope) {
    annotations.scopeLine = {
      type: 'line',
      yMin: mc.total_scope,
      yMax: mc.total_scope,
      borderColor: '#64748b',
      borderWidth: 1.5,
      borderDash: [4, 4],
      label: {
        display: true,
        content: `Target Scope: ${mc.total_scope} SP`,
        position: 'end',
        backgroundColor: '#334155',
        color: '#ffffff',
        borderRadius: 4,
        padding: 5,
        font: { size: 11, weight: 'bold' }
      }
    };
  }

  const p50Data = (mc.p50_line && mc.p50_line.length ? mc.p50_line : forecastData).map(p => ({ x: p.x, y: p.y }));
  const p80Data = (mc.p80_line && mc.p80_line.length ? mc.p80_line : forecastData).map(p => ({ x: p.x, y: p.y }));

  const datasets = [
    {
      label: 'Delivered (Cumulative SP)',
      data: actualData,
      borderColor: '#2563eb',
      backgroundColor: 'rgba(37, 99, 235, 0.12)',
      borderWidth: 3,
      fill: true,
      tension: 0.25,
      pointRadius: 5,
      pointBackgroundColor: '#2563eb',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 2,
      pointHoverRadius: 7,
    },
    {
      label: 'P50 Likely Forecast',
      data: p50Data,
      borderColor: '#0284c7',
      borderWidth: 2.5,
      borderDash: [6, 4],
      fill: false,
      tension: 0.1,
      pointRadius: 3,
      pointBackgroundColor: '#0284c7',
    },
    {
      label: 'P80 Conservative Forecast',
      data: p80Data,
      borderColor: '#d97706',
      borderWidth: 2.5,
      borderDash: [3, 3],
      fill: false,
      tension: 0.1,
      pointRadius: 3,
      pointBackgroundColor: '#d97706',
    }
  ];

  try {
    state.monteCarloChart = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: { unit: 'week', displayFormats: { week: 'MMM d' } },
            grid: { color: 'rgba(148, 163, 184, 0.2)' },
            ticks: { color: '#334155', font: { weight: '600', size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(148, 163, 184, 0.2)' },
            ticks: { color: '#334155', font: { weight: '600', size: 11 } }
          }
        },
        plugins: {
          legend: {
            labels: {
              color: '#1e293b',
              usePointStyle: true,
              font: { size: 12, weight: '600' },
              padding: 16
            }
          },
          annotation: { annotations }
        }
      }
    });
  } catch (err) {
    console.error("Error rendering Monte Carlo Chart:", err);
  }

  const noteEl = $("mc-note");
  if (noteEl) {
    const targetStr = mc.target_date ? `<span style="color:#dc2626; font-weight:600;">🎯 Target Date: <strong>${mc.target_date}</strong></span>` : '';
    const p50Str = mc.p50_date ? `<span style="color:#2563eb; font-weight:600;">🔵 P50 Est: <strong>${mc.p50_date}</strong></span>` : '';
    const p80Str = mc.p80_date ? `<span style="color:#d97706; font-weight:600;">🟡 P80 Est: <strong>${mc.p80_date}</strong></span>` : '';
    const scopeStr = mc.total_scope ? `<span style="color:#334155; font-weight:600;">📊 Target Scope: <strong>${mc.total_scope} SP</strong></span>` : '';
    const parts = [targetStr, p50Str, p80Str, scopeStr].filter(Boolean);
    noteEl.innerHTML = parts.join(' &nbsp;|&nbsp; ');
  }
}
