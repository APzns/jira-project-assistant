/* ============================================================================
 * api/client.ts — Typed fetch client for the Jira Project Assistant API.
 *
 * All endpoints are prefixed with /api.
 * All requests use credentials: 'include' for cookie-based auth.
 * Mirrors the fetch logic from the vanilla JS frontend (api.js + skills.js).
 * ========================================================================== */

import type {
  Assessment,
  AISettings,
  SaveSettingsResponse,
  ResetSettingsResponse,
  StakeholdersData,
  SaveStakeholdersResponse,
  ReportsData,
  SaveReportsResponse,
  SkillRequest,
  AnalyzeStatusResponse,
  ProposeNextStepsResponse,
  GenerateReportResponse,
  AskResponse,
  ProjectSetting,
} from '../types';

// ---------------------------------------------------------------------------
// Base helpers
// ---------------------------------------------------------------------------

const API_BASE = '/api';

/**
 * Fetch with an AbortController-based timeout.
 * Mirrors the original fetchWithTimeout from api.js.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 45_000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
    }
    throw error;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Parse a JSON response, throwing on HTTP errors with the server detail if available.
 */
async function parseJsonResponse<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const detail = body?.detail ?? body?.error ?? `HTTP ${resp.status}`;
    throw new Error(String(detail));
  }
  return resp.json() as Promise<T>;
}

/**
 * POST JSON helper — builds the standard request options.
 */
function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

/**
 * Fetch the program-status assessment.
 * @param mode      "real" (default) or "synthetic"
 * @param forceRefresh  true → GET /api/assess (regenerate); false → GET /api/assess/latest (cached)
 */
export async function fetchAssessment(
  mode: string = 'real',
  forceRefresh = false,
): Promise<Assessment> {
  const endpoint = forceRefresh
    ? `${API_BASE}/assess?mode=${mode}`
    : `${API_BASE}/assess/latest?mode=${mode}`;
  const resp = await fetchWithTimeout(endpoint, {}, 60_000);
  return parseJsonResponse<Assessment>(resp);
}

// ---------------------------------------------------------------------------
// Ask (AI Q&A)
// ---------------------------------------------------------------------------

/**
 * Send a free-form question to the AI assistant.
 */
export async function postAsk(question: string): Promise<AskResponse> {
  const resp = await fetchWithTimeout(
    `${API_BASE}/ask`,
    postJson({ question }),
  );
  return parseJsonResponse<AskResponse>(resp);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Load the current AI settings (profiles, active profile, flat overrides).
 */
export async function loadSettings(): Promise<AISettings> {
  const resp = await fetchWithTimeout(`${API_BASE}/settings`, {}, 10_000);
  return parseJsonResponse<AISettings>(resp);
}

/**
 * Save AI settings to disk.
 */
export async function saveSettings(
  settings: Partial<AISettings>,
): Promise<SaveSettingsResponse> {
  const resp = await fetchWithTimeout(
    `${API_BASE}/settings`,
    postJson(settings),
    10_000,
  );
  return parseJsonResponse<SaveSettingsResponse>(resp);
}

/**
 * Reset all AI settings / report profiles to factory defaults.
 */
export async function resetSettings(): Promise<ResetSettingsResponse> {
  const resp = await fetchWithTimeout(
    `${API_BASE}/settings/reset`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    10_000,
  );
  return parseJsonResponse<ResetSettingsResponse>(resp);
}

// ---------------------------------------------------------------------------
// Stakeholders
// ---------------------------------------------------------------------------

/**
 * Fetch all stakeholder profiles.
 */
export async function loadStakeholders(): Promise<StakeholdersData> {
  const resp = await fetchWithTimeout(`${API_BASE}/stakeholders`, {}, 10_000);
  return parseJsonResponse<StakeholdersData>(resp);
}

/**
 * Save stakeholder profiles.
 */
export async function saveStakeholders(
  data: StakeholdersData,
): Promise<SaveStakeholdersResponse> {
  const resp = await fetchWithTimeout(
    `${API_BASE}/stakeholders`,
    postJson(data),
    10_000,
  );
  return parseJsonResponse<SaveStakeholdersResponse>(resp);
}

// ---------------------------------------------------------------------------
// Reports (templates)
// ---------------------------------------------------------------------------

/**
 * Fetch all report templates.
 */
export async function loadReports(): Promise<ReportsData> {
  const resp = await fetchWithTimeout(`${API_BASE}/reports`, {}, 10_000);
  return parseJsonResponse<ReportsData>(resp);
}

/**
 * Save report templates (full list).
 */
export async function saveReports(
  data: ReportsData,
): Promise<SaveReportsResponse> {
  const resp = await fetchWithTimeout(
    `${API_BASE}/reports`,
    postJson(data),
    10_000,
  );
  return parseJsonResponse<SaveReportsResponse>(resp);
}

/**
 * Reset report templates to factory defaults.
 */
export async function resetReports(): Promise<SaveReportsResponse> {
  const resp = await fetchWithTimeout(
    `${API_BASE}/reports/reset`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } },
    10_000,
  );
  return parseJsonResponse<SaveReportsResponse>(resp);
}

// ---------------------------------------------------------------------------
// Skills (AI skill runner)
// ---------------------------------------------------------------------------

/**
 * Generic skill caller — POST /api/skills/{skillName}.
 * Timeout is 90s because LLM skills may take a while.
 */
async function callSkill<T>(
  skillName: string,
  payload: SkillRequest = {},
): Promise<T> {
  const resp = await fetchWithTimeout(
    `${API_BASE}/skills/${skillName}`,
    postJson(payload),
    90_000,
  );
  return parseJsonResponse<T>(resp);
}

/**
 * Run the "Analyze Status" skill.
 */
export async function analyzeStatus(
  payload: SkillRequest = {},
): Promise<AnalyzeStatusResponse> {
  return callSkill<AnalyzeStatusResponse>('analyze-status', payload);
}

/**
 * Run the "Propose Next Steps" skill.
 */
export async function proposeNextSteps(
  payload: SkillRequest = {},
): Promise<ProposeNextStepsResponse> {
  return callSkill<ProposeNextStepsResponse>('propose-next-steps', payload);
}

/**
 * Run the "Generate Report" skill.
 */
export async function generateReport(
  payload: SkillRequest = {},
): Promise<GenerateReportResponse> {
  return callSkill<GenerateReportResponse>('generate-report', payload);
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * Load project settings configuration.
 * GET /api/projects/settings
 */
export async function loadProjectSettings(): Promise<ProjectSetting[]> {
  const url = `${API_BASE}/projects/settings`;
  const response = await fetchWithTimeout(url, { method: 'GET' });
  return parseJsonResponse<ProjectSetting[]>(response);
}

/**
 * Save project settings configuration.
 * POST /api/projects/settings
 */
export async function saveProjectSettings(
  settings: ProjectSetting[],
): Promise<ProjectSetting[]> {
  const url = `${API_BASE}/projects/settings`;
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return parseJsonResponse<ProjectSetting[]>(response);
}
