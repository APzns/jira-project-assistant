/* ---------- API Fetch Client ---------- */

import { API_BASE } from "./state.js";

const _AUTH_HEADER = `Basic ${btoa('demo:Dem06435')}`;
export async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: "include", ...options, headers: { Authorization: _AUTH_HEADER, ...(options.headers || {}) }, signal: controller.signal });
    return response;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(id);
  }
}

export async function fetchAssessment(mode = "real", forceRefresh = false, projectKey = null) {
  let endpoint = forceRefresh ? `${API_BASE}/assess?mode=${mode}` : `${API_BASE}/assess/latest?mode=${mode}`;
  if (projectKey && projectKey !== "ALL") {
    endpoint += `&project_key=${encodeURIComponent(projectKey)}`;
  }
  const resp = await fetchWithTimeout(endpoint, {}, 60000);
  if (!resp.ok) {
    throw new Error(`HTTP error ${resp.status}`);
  }
  return await resp.json();
}

export async function fetchStatsSummary(mode = "real", projectKey = null) {
  let endpoint = `${API_BASE}/stats/summary?mode=${mode}`;
  if (projectKey && projectKey !== "ALL") {
    endpoint += `&project_key=${encodeURIComponent(projectKey)}`;
  }
  const resp = await fetchWithTimeout(endpoint, {}, 30000);
  if (!resp.ok) {
    throw new Error(`HTTP error ${resp.status}`);
  }
  return await resp.json();
}

export async function fetchTeams() {
  const resp = await fetchWithTimeout(`${API_BASE}/stats/teams`, {}, 15000);
  if (!resp.ok) return [];
  return await resp.json();
}

export async function fetchProjects(includeArchived = false) {
  const resp = await fetchWithTimeout(`${API_BASE}/projects?include_archived=${includeArchived}`, {}, 15000);
  if (!resp.ok) {
    throw new Error(`HTTP error ${resp.status}`);
  }
  return await resp.json();
}

export async function postAsk(question) {
  const resp = await fetchWithTimeout(`${API_BASE}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  }, 90000);
  if (!resp.ok) {
    throw new Error(`HTTP error ${resp.status}`);
  }
  return await resp.json();
}

export async function fetchCurrentUser() {
  const resp = await fetchWithTimeout(`${API_BASE}/me`, {}, 15000);
  if (!resp.ok) return { username: "demo" };
  return await resp.json();
}
