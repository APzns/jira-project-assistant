import { $, teamColor } from "../utils.js";
import { state } from "../state.js";

export function renderQualityByTeamChart() {
  const ctx = $("qualityByTeamChart");
  if (!ctx || !state.qualityState || !state.qualityState.bugStats) return;

  if (state.qualityByTeamChart) {
    state.qualityByTeamChart.destroy();
    state.qualityByTeamChart = null;
  }

  const items = state.qualityState.bugStats.defects_per_sprint || [];
  if (!items.length) return;

  const teamData = {};
  items.forEach(item => {
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

  state.qualityByTeamChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: teams,
      datasets: [{
        label: 'Defect SP Ratio (%)',
        data: ratios,
        backgroundColor: teams.map(t => teamColor(t)),
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { callback: v => v + "%" },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        x: { grid: { display: false } }
      },
      plugins: {
        legend: { display: false }
      }
    }
  });
}
