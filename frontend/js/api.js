/* ---------- API Fetch Client ---------- */

export async function fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: "include", ...options, signal: controller.signal });
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

export async function fetchAssessment(mode = "real", forceRefresh = false) {
  const endpoint = forceRefresh ? `/assess?mode=${mode}` : `/assess/latest?mode=${mode}`;
  const resp = await fetchWithTimeout(endpoint, {}, 60000);
  if (!resp.ok) {
    throw new Error(`HTTP error ${resp.status}`);
  }
  return await resp.json();
}

export async function postAsk(question) {
  const resp = await fetchWithTimeout('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  if (!resp.ok) {
    throw new Error(`HTTP error ${resp.status}`);
  }
  return await resp.json();
}
