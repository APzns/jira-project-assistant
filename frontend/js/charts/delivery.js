import { $, hexToRgba, teamColor } from "../utils.js";
import { state } from "../state.js";

Chart.defaults.color = "#9aa4b2";
Chart.defaults.font.family = "-apple-system, 'Segoe UI', Roboto, sans-serif";
Chart.defaults.font.size = 12;

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
      borderColor: 'rgba(239, 68, 68, 0.85)',
      borderWidth: 2,
      borderDash: [6, 6],
      label: {
        display: true,
        content: `Target: ${formattedTarget || mc.target_date}`,
        position: 'start',
        backgroundColor: 'rgba(239, 68, 68, 0.25)',
        color: '#f87171',
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
      borderColor: 'rgba(59, 130, 246, 0.85)',
      borderWidth: 2,
      borderDash: [4, 4],
      label: {
        display: true,
        content: `P50: ${formattedP50 || mc.p50_date}`,
        position: 'start',
        backgroundColor: 'rgba(59, 130, 246, 0.25)',
        color: '#60a5fa',
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
      borderColor: 'rgba(234, 179, 8, 0.85)',
      borderWidth: 2,
      borderDash: [4, 4],
      label: {
        display: true,
        content: `P80: ${formattedP80 || mc.p80_date}`,
        position: 'end',
        backgroundColor: 'rgba(234, 179, 8, 0.25)',
        color: '#facc15',
        font: { size: 11, weight: 'bold' }
      }
    };
  }

  if (mc.total_scope) {
    annotations.scopeLine = {
      type: 'line',
      yMin: mc.total_scope,
      yMax: mc.total_scope,
      borderColor: 'rgba(230, 233, 239, 0.35)',
      borderWidth: 1.5,
      borderDash: [3, 3],
      label: {
        display: true,
        content: `Target Scope: ${mc.total_scope} SP`,
        position: 'end',
        backgroundColor: 'rgba(30, 36, 48, 0.75)',
        color: '#e6e9ef',
        font: { size: 10, weight: 'bold' }
      }
    };
  }

  const p50Data = (mc.p50_line && mc.p50_line.length ? mc.p50_line : forecastData).map(p => ({ x: p.x, y: p.y }));
  const p80Data = (mc.p80_line && mc.p80_line.length ? mc.p80_line : forecastData).map(p => ({ x: p.x, y: p.y }));

  const datasets = [
    {
      label: 'Delivered (Cumulative SP)',
      data: actualData,
      borderColor: '#4c8dff',
      backgroundColor: hexToRgba('#4c8dff', 0.15),
      borderWidth: 3,
      fill: true,
      tension: 0.25,
      pointRadius: 4,
      pointBackgroundColor: '#4c8dff',
    },
    {
      label: 'P50 Likely Forecast',
      data: p50Data,
      borderColor: '#60a5fa',
      borderWidth: 2.5,
      borderDash: [6, 4],
      fill: false,
      tension: 0.1,
      pointRadius: 3,
      pointBackgroundColor: '#60a5fa',
    },
    {
      label: 'P80 Conservative Forecast',
      data: p80Data,
      borderColor: '#f5a623',
      borderWidth: 2.5,
      borderDash: [3, 3],
      fill: '-1',
      backgroundColor: 'rgba(168, 85, 247, 0.25)',
      tension: 0.1,
      pointRadius: 3,
      pointBackgroundColor: '#f5a623',
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
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#9aa4b2' }
          },
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: { color: '#9aa4b2' }
          }
        },
        plugins: {
          legend: { labels: { color: '#e2e8f0', usePointStyle: true } },
          annotation: { annotations }
        }
      }
    });
  } catch (err) {
    console.error("Error rendering Monte Carlo Chart:", err);
  }

  const noteEl = $("mc-note");
  if (noteEl) {
    const targetStr = mc.target_date ? `<span style="color:#f87171">🎯 Target Date: <strong>${mc.target_date}</strong></span>` : '';
    const p50Str = mc.p50_date ? `<span style="color:#60a5fa">🔵 P50 Est: <strong>${mc.p50_date}</strong></span>` : '';
    const p80Str = mc.p80_date ? `<span style="color:#facc15">🟡 P80 Est: <strong>${mc.p80_date}</strong></span>` : '';
    const scopeStr = mc.total_scope ? `<span style="color:#9aa4b2">📊 Target Scope: <strong>${mc.total_scope} SP</strong></span>` : '';
    const parts = [targetStr, p50Str, p80Str, scopeStr].filter(Boolean);
    noteEl.innerHTML = parts.join(' &nbsp;|&nbsp; ');
  }
}
