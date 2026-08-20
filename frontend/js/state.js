/* ---------- Centralized Application State ---------- */

export const API_BASE = (typeof window !== "undefined" && window.location.port === "5500")
  ? "http://127.0.0.1:8000"
  : "";

export const ENV = "development";

export const state = {
  currentProject: "CORE",
  projectsCache: [],
  dashboardDataCache: {},
  monteCarloChart: null,
  teamPointsChart: null,
  predByTeamChart: null,
  qualityByTeamChart: null,
  deliveryState: null,
  progressTabState: null,
  qualityState: null,
  askHistory: [],
  lastAskTime: 0,
};

