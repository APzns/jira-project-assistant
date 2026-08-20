/**
 * assistant.js — Dedicated Full-Page Conversational AI Assistant View
 * Interacts with backend LLM services, ingesting Jira data, Project Horizon charter,
 * decisions (D1–D3), risk triggers (R1–R4), and stakeholder personas to propose
 * and generate optimal delivery reports.
 */

import { $, escapeHtml } from "../utils.js";
import { API_BASE } from "../state.js";
import { fetchWithTimeout } from "../api.js";
import { openReportDetail, executeReportGeneration } from "../skills.js";

let _chatHistory = [];
let _isThinking = false;
let _lastProposedTemplate = null;

const DEFAULT_WELCOME_MESSAGE = `
Hello! I am your **Smart Project & Delivery Assistant** for **Project Horizon**.

I synthesize our live Jira metrics, Project Charter (Milestones M0–M3), Decision Log (D1–D3), Risk Registers (R1–R4), and Stakeholder Personas to recommend optimal delivery strategies and tailored executive reports.

### 💡 How can I help you today?
* **Design a Universal Stakeholder Report** covering VP Product, Security, and Engineering.
* **Analyze Milestone Health & Forecasts** using Monte Carlo P50/P80 confidence models.
* **Evaluate Scope & Velocity Trade-offs** (e.g. D3 scope freeze on Checkout vs compliance capacity).
* **Draft an Executive 1-Pager or Deck** for upcoming SteerCo meetings.

*Click any quick scenario on the left or type your request below!*
`;

/**
 * Format markdown text into clean HTML.
 */
function formatMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);

  // Headers
  html = html.replace(/^#### (.*$)/gim, '<h5 style="margin: 8px 0 4px; color: #a5b4fc; font-size: 13px;">$1</h5>');
  html = html.replace(/^### (.*$)/gim, '<h4 style="margin: 12px 0 6px; color: #818cf8; font-size: 15px; font-weight: 700;">$1</h4>');
  html = html.replace(/^## (.*$)/gim, '<h3 style="margin: 14px 0 8px; color: #f8fafc; font-size: 16px; font-weight: 700;">$1</h3>');

  // Bold & Italic
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Bullet points
  html = html.replace(/^\* (.*$)/gim, '<li style="margin-left: 18px; margin-bottom: 4px;">$1</li>');
  html = html.replace(/^- (.*$)/gim, '<li style="margin-left: 18px; margin-bottom: 4px;">$1</li>');

  // Numbered lists
  html = html.replace(/^(\d+)\. (.*$)/gim, '<li style="margin-left: 18px; margin-bottom: 4px;"><strong>$1.</strong> $2</li>');

  // Horizontal rules
  html = html.replace(/^---$/gim, '<hr style="border: 0; border-top: 1px solid rgba(99, 102, 241, 0.25); margin: 12px 0;" />');

  // Inline code / badges
  html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #a5b4fc; font-family: monospace;">$1</code>');

  // Paragraph line breaks
  html = html.replace(/\n\n/g, '<div style="margin-bottom: 10px;"></div>');
  html = html.replace(/\n/g, '<br />');

  return html;
}

/**
 * Render structured proposed template card.
 */
function renderProposedCard(tpl, messageIndex) {
  if (!tpl) return "";
  const blocksCount = (tpl.blocks || []).length;
  const stakeholdersCount = (tpl.stakeholder_ids || []).length;
  const scope = tpl.project_scope || tpl.project_key || "ALL";
  const format = (tpl.export_format || "html").toUpperCase();

  return `
    <div class="assistant-proposal-card" data-index="${messageIndex}">
      <div class="proposal-card-header">
        <div class="proposal-card-title">
          <span>📋</span>
          <strong>${escapeHtml(tpl.name || "Proposed Report Configuration")}</strong>
        </div>
        <span class="proposal-card-badge">✨ AI Recommended</span>
      </div>
      
      <div class="proposal-card-grid">
        <div class="proposal-grid-item">
          <span class="grid-lbl">Scope</span>
          <span class="grid-val">${escapeHtml(scope)}</span>
        </div>
        <div class="proposal-grid-item">
          <span class="grid-lbl">Audience</span>
          <span class="grid-val">${stakeholdersCount} Personas</span>
        </div>
        <div class="proposal-grid-item">
          <span class="grid-lbl">Visual Blocks</span>
          <span class="grid-val">${blocksCount} Sections</span>
        </div>
        <div class="proposal-grid-item">
          <span class="grid-lbl">Format</span>
          <span class="grid-val">${escapeHtml(format)}</span>
        </div>
      </div>

      <div class="proposal-card-desc">
        ${escapeHtml(tpl.description || "")}
      </div>

      <div class="proposal-card-actions">
        <button type="button" class="btn-secondary btn-prefill-studio" data-index="${messageIndex}" style="color: #818cf8; border-color: rgba(99, 102, 241, 0.4);">
          📝 Prefill in Report Studio
        </button>
        <button type="button" class="btn-primary btn-generate-now" data-index="${messageIndex}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          🚀 Generate Report Now
        </button>
      </div>
    </div>
  `;
}

/**
 * Render message history into the chat stream container.
 */
function renderChatStream() {
  const container = $("assistant-chat-stream");
  if (!container) return;

  if (_chatHistory.length === 0) {
    container.innerHTML = `
      <div class="assistant-message bot-message">
        <div class="msg-avatar">🤖</div>
        <div class="msg-content">
          <div class="msg-sender">Smart Project Assistant</div>
          <div class="msg-body">${formatMarkdown(DEFAULT_WELCOME_MESSAGE)}</div>
        </div>
      </div>
    `;
    return;
  }

  let html = `
    <div class="assistant-message bot-message">
      <div class="msg-avatar">🤖</div>
      <div class="msg-content">
        <div class="msg-sender">Smart Project Assistant</div>
        <div class="msg-body">${formatMarkdown(DEFAULT_WELCOME_MESSAGE)}</div>
      </div>
    </div>
  `;

  _chatHistory.forEach((msg, idx) => {
    const isUser = msg.role === "user";
    const avatar = isUser ? "👤" : "🤖";
    const senderName = isUser ? "You" : "Smart Project Assistant";
    const extraCard = (!isUser && msg.template) ? renderProposedCard(msg.template, idx) : "";

    html += `
      <div class="assistant-message ${isUser ? 'user-message' : 'bot-message'}">
        <div class="msg-avatar">${avatar}</div>
        <div class="msg-content">
          <div class="msg-sender">${senderName}</div>
          <div class="msg-body">${formatMarkdown(msg.content)}</div>
          ${extraCard}
        </div>
      </div>
    `;
  });

  if (_isThinking) {
    html += `
      <div class="assistant-message bot-message thinking-message">
        <div class="msg-avatar">🤖</div>
        <div class="msg-content">
          <div class="msg-sender">Smart Project Assistant</div>
          <div class="msg-body" style="display: flex; align-items: center; gap: 8px; color: #818cf8;">
            <span class="thinking-spinner">⏳</span>
            <span>Analyzing project charter, decisions, and Jira data...</span>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;

  // Bind inline action buttons
  container.querySelectorAll(".btn-prefill-studio").forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.index, 10);
      const msg = _chatHistory[idx];
      if (msg && msg.template) {
        prefillInReportStudio(msg.template);
      }
    };
  });

  container.querySelectorAll(".btn-generate-now").forEach(btn => {
    btn.onclick = () => {
      const idx = parseInt(btn.dataset.index, 10);
      const msg = _chatHistory[idx];
      if (msg && msg.template) {
        generateReportFromAssistant(msg.template);
      }
    };
  });
}

/**
 * Send user message to backend assistant service.
 */
export async function sendAssistantMessage(userText) {
  const text = (userText || "").trim();
  if (!text || _isThinking) return;

  _chatHistory.push({ role: "user", content: text });
  _isThinking = true;
  renderChatStream();

  const input = $("assistant-chat-input");
  if (input) input.value = "";

  try {
    const payload = {
      stakeholder_ids: ["exec-sponsor", "sec-lead", "eng-lead-core", "pm-default"],
      user_prompt: text,
      chat_history: _chatHistory.slice(0, -1)
    };

    const res = await fetchWithTimeout(`${API_BASE}/reports/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    });

    if (!res.ok) {
      throw new Error(`Failed to get assistant response (HTTP ${res.status})`);
    }

    const data = await res.json();
    _lastProposedTemplate = data.proposed_template || null;

    _chatHistory.push({
      role: "assistant",
      content: data.reply || "I have analyzed your project scenario and prepared a recommended delivery report structure.",
      template: data.proposed_template || null
    });
  } catch (err) {
    console.error("Assistant chat error:", err);
    _chatHistory.push({
      role: "assistant",
      content: `⚠️ **Error communicating with AI Assistant:** ${escapeHtml(err.message)}`
    });
  } finally {
    _isThinking = false;
    renderChatStream();
  }
}

/**
 * Prefill the template into the Report Studio and switch views.
 */
export function prefillInReportStudio(template) {
  const tpl = template || _lastProposedTemplate;
  if (!tpl) return;

  // Navigate to reports/new and prefill
  window.location.hash = "reports/new";
  setTimeout(() => {
    openReportDetail(null);
    
    // Fill fields
    const nameEl = $("pa-detail-name");
    if (nameEl && tpl.name) nameEl.value = tpl.name;

    const descEl = $("pa-detail-desc");
    if (descEl && tpl.description) descEl.value = tpl.description;

    const notesEl = $("pa-stakeholder-notes");
    if (notesEl && tpl.stakeholder_notes) notesEl.value = tpl.stakeholder_notes;

    const projSelect = $("pa-project-select");
    if (projSelect && (tpl.project_scope || tpl.project_key)) {
      projSelect.value = tpl.project_scope || tpl.project_key;
    }

    const defCheck = $("pa-detail-is-default");
    if (defCheck && tpl.is_default !== undefined) {
      defCheck.checked = Boolean(tpl.is_default);
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: "smooth" });

    // Show toast
    const subTitle = $("pa-detail-view-subtitle");
    if (subTitle) {
      const orig = subTitle.textContent;
      subTitle.innerHTML = `<span style="color: #10b981; font-weight: 600;">✨ Prefilled from AI Assistant!</span> Customize any sections below, then click Save or Generate.`;
      setTimeout(() => { if (subTitle) subTitle.textContent = orig; }, 6000);
    }
  }, 100);
}

/**
 * Instantly generate and render the report from assistant recommendation.
 */
export function generateReportFromAssistant(template) {
  const tpl = template || _lastProposedTemplate;
  if (!tpl) return;

  const payload = {
    template_id: "custom",
    name: tpl.name || "Custom AI Report",
    project_scope: tpl.project_scope || tpl.project_key || "ALL",
    stakeholder_ids: tpl.stakeholder_ids || ["exec-sponsor", "sec-lead", "eng-lead-core", "pm-default"],
    stakeholder_notes: tpl.stakeholder_notes || "",
    blocks: (tpl.blocks || []).map((b, i) => ({
      id: `${b.block_type || b}_${i + 1}`,
      block_type: b.block_type || b.id || b,
      title: b.title || b.block_type || "Section",
      enabled: true,
      order: i + 1,
      pm_commentary: "",
      chart_prompt: "",
      config: {}
    }))
  };

  // Switch to Reports page and execute generation
  window.location.hash = "reports";
  setTimeout(() => {
    executeReportGeneration(payload);
  }, 150);
}

/**
 * Clear current chat session.
 */
export function clearAssistantSession() {
  _chatHistory = [];
  _isThinking = false;
  _lastProposedTemplate = null;
  renderChatStream();
}

/**
 * Initialize the full-page Assistant View and event listeners.
 */
export function initAssistantPage() {
  renderChatStream();

  // Send button & input
  const sendBtn = $("assistant-send-btn");
  const input = $("assistant-chat-input");

  if (sendBtn && input) {
    sendBtn.onclick = () => sendAssistantMessage(input.value);
    input.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendAssistantMessage(input.value);
      }
    };
  }

  // Clear chat button
  const clearBtn = $("assistant-clear-btn");
  if (clearBtn) {
    clearBtn.onclick = clearAssistantSession;
  }

  // Back to reports button
  const backReportsBtn = $("assistant-btn-back-reports");
  if (backReportsBtn) {
    backReportsBtn.onclick = () => {
      window.location.hash = "reports";
    };
  }

  // Scenario chips
  document.querySelectorAll(".assistant-scenario-card").forEach(card => {
    card.onclick = () => {
      const prompt = card.dataset.prompt;
      if (prompt) sendAssistantMessage(prompt);
    };
  });
}
