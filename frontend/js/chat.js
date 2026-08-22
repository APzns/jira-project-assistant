/**
 * chat.js — Global "Ask AI" Copilot Chat Drawer & Query Execution
 */

import { $, setText, show, hide, escapeHtml } from "./utils.js";
import { API_BASE, state } from "./state.js";
import { fetchWithTimeout } from "./api.js";

export function openChatDrawer() {
  const drawer = $("chat-drawer");
  const fab = $("chat-fab-btn");
  if (drawer) {
    drawer.classList.add("open");
    drawer.classList.remove("collapsed", "closed");
  }
  if (fab) fab.classList.add("hidden");
  setTimeout(() => {
    const input = $("ask-input");
    if (input) input.focus({ preventScroll: true });
    window.dispatchEvent(new Event("resize"));
  }, 150);
}

export function collapseChatDrawer() {
  const drawer = $("chat-drawer");
  const fab = $("chat-fab-btn");
  if (drawer) {
    drawer.classList.add("collapsed");
    drawer.classList.remove("open", "closed");
  }
  if (fab) fab.classList.add("hidden");
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
  }, 150);
}

export function closeChatDrawer() {
  const drawer = $("chat-drawer");
  const fab = $("chat-fab-btn");
  if (drawer) {
    drawer.classList.add("closed");
    drawer.classList.remove("open", "collapsed");
  }
  if (fab) fab.classList.remove("hidden");
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
  }, 150);
}

export function toggleChatSidebar() {
  const drawer = $("chat-drawer");
  if (drawer && drawer.classList.contains("open") && !drawer.classList.contains("collapsed") && !drawer.classList.contains("closed")) {
    closeChatDrawer();
  } else {
    openChatDrawer();
  }
}

function _getActiveTab() {
  const active = document.querySelector(".tab.active");
  return active ? (active.dataset.tab || null) : null;
}

export function askAiCopilot(question) {
  if (!question || !question.trim()) {
    openChatDrawer();
    return;
  }
  openChatDrawer();
  const input = $("ask-input");
  if (input) {
    input.value = question.trim();
  }
  askQuestion("ask-input", "ask-button");
}

export async function askQuestion(inputId, buttonId) {
  const errorDiv = $("ask-error");
  if (errorDiv) hide("ask-error");

  const input = $(inputId);
  const btn = $(buttonId);
  if (!input || !btn) return;
  const q = input.value.trim();
  if (!q) return;

  if (q.length > 500) {
    if (errorDiv) {
      errorDiv.textContent = "Error: Input exceeds maximum length of 500 characters.";
      show("ask-error");
    }
    return;
  }

  const blockedKeywords = /ignore\s*(all)?\s*previous\s*instructions|forget\s*your\s*instructions|system\s*prompt|you\s*are\s*now\s*a/i;
  if (blockedKeywords.test(q)) {
    if (errorDiv) {
      errorDiv.textContent = "Error: Your message contains blocked keywords and cannot be processed.";
      show("ask-error");
    }
    return;
  }

  const now = Date.now();
  if (state.lastAskTime && now - state.lastAskTime < 3000) {
    if (errorDiv) {
      errorDiv.textContent = "Error: Please wait a few seconds before asking again.";
      show("ask-error");
    }
    return;
  }
  state.lastAskTime = now;

  openChatDrawer();

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = "Thinking…";

  const entryId = "qa-" + Date.now();
  addHistoryEntry(entryId, q, "Thinking…");
  input.value = "";

  const historyPayload = state.askHistory.slice(-5);
  const contextTab = _getActiveTab();

  try {
    const res = await fetchWithTimeout(`${API_BASE}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: q,
        history: historyPayload.length ? historyPayload : undefined,
        context: contextTab || undefined,
        project_key: state.currentProject || undefined,
      }),
    }, 90000);
    const d = await res.json();
    const answer = d.error ? ("⚠️ " + d.error) : (d.answer || "No answer returned.");
    updateHistoryEntry(entryId, answer, d.rows || [], d.skill_used || null);
    state.askHistory.push({ question: q, answer });
    if (state.askHistory.length > 10) state.askHistory.shift();
  } catch (e) {
    const errorMsg = e.message && e.message.toLowerCase().includes("timed out")
      ? "⚠️ Request timed out. The AI model is taking longer than expected to respond. Please try again."
      : "⚠️ Could not reach the API. Is the server running?";
    updateHistoryEntry(entryId, errorMsg, []);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

export function addHistoryEntry(entryId, question, answerText) {
  const container = $("ask-history");
  if (!container) return;
  const time = new Date().toLocaleTimeString();
  const html =
    `<details class="qa" open data-entry="${entryId}">
       <summary><span class="qa-q">${escapeHtml(question)}</span>
                <span class="qa-time">${time}</span></summary>
       <div class="qa-a">${escapeHtml(answerText)}</div>
     </details>`;
  container.insertAdjacentHTML("beforeend", html);
  container.scrollTop = container.scrollHeight;
}

export function updateHistoryEntry(entryId, answerText, rows, skillUsed) {
  document.querySelectorAll(`[data-entry="${entryId}"] .qa-a`)
    .forEach(el => {
      const aiHtml = window.marked
        ? marked.parse(answerText)
        : escapeHtml(answerText);

      const tableHtml = (rows && rows.length > 10)
        ? _renderRowsTable(rows)
        : "";

      const skillBadge = skillUsed
        ? `<div class="skill-used-badge">✨ Answered using: <strong>${escapeHtml(skillUsed)}</strong> skill</div>`
        : "";

      el.innerHTML = skillBadge + aiHtml + tableHtml;
    });

  const container = $("ask-history");
  if (container) container.scrollTop = container.scrollHeight;
}

function _renderRowsTable(rows) {
  if (!rows || !rows.length) return "";
  const cols = Object.keys(rows[0]);
  const header = cols.map(c => `<th>${escapeHtml(String(c).replace(/_/g, " "))}</th>`).join("");
  const body = rows.map(row =>
    `<tr>${cols.map(c => `<td>${escapeHtml(String(row[c] ?? ""))}</td>`).join("")}</tr>`
  ).join("");
  return `
<details class="qa-table-details">
  <summary class="qa-table-toggle">Show all ${rows.length} rows ▾</summary>
  <div class="qa-table-scroll">
    <table class="qa-table">
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>
</details>`;
}

export function initChatEvents(inputId = "ask-input", buttonId = "ask-button") {
  const btn = $(buttonId);
  const input = $(inputId);
  if (btn) btn.addEventListener("click", () => askQuestion(inputId, buttonId));
  if (input) input.addEventListener("keydown", e => { if (e.key === "Enter") askQuestion(inputId, buttonId); });

  const toggleBtn = $("chat-toggle-btn");
  const fabBtn = $("chat-fab-btn");
  const collapseBtn = $("chat-collapse-btn");
  const expandRailBtn = $("chat-collapsed-rail");
  const closeBtn = $("chat-close-btn");

  if (toggleBtn) toggleBtn.addEventListener("click", toggleChatSidebar);
  if (fabBtn) fabBtn.addEventListener("click", openChatDrawer);
  if (collapseBtn) collapseBtn.addEventListener("click", collapseChatDrawer);
  if (expandRailBtn) expandRailBtn.addEventListener("click", openChatDrawer);
  if (closeBtn) closeBtn.addEventListener("click", closeChatDrawer);

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.activeElement === input) collapseChatDrawer();
  });

  document.querySelectorAll(".drawer-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const prompt = chip.dataset.prompt;
      if (prompt && input) {
        input.value = prompt;
        input.focus({ preventScroll: true });
      }
    });
  });
}
