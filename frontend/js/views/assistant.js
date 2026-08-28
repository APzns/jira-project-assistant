/**
 * assistant.js — Dedicated Full-Page Conversational AI Assistant View
 * Interacts with backend LLM services, ingesting Jira data, Horizon charter,
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
Hello! I am your **Smart Project & Delivery Assistant** for **Horizon** and assigned portfolio initiatives.

I synthesize live Jira metrics, Project Charters (Milestones M0–M3), Decision Logs (D1–D3), Risk Registers (R1–R4), and team velocity to give you instant answers, strategic advice, actionable next steps, and delivery reports.

### 💡 How can I help you today?
* **Ask factual & diagnostic questions** (e.g. *"What blockers exist in MOB project?"*, *"Which squad is behind schedule?"*).
* **Get strategic TPM advice** (e.g. *"How can we mitigate M2 compliance risks without slowing Checkout?"*).
* **Propose prioritized next steps** (e.g. *"What are the P1/P2/P3 action items for this week?"*).
* **Evaluate delivery trade-offs** (e.g. *"Analyze scope cut on APS-1 vs delaying M3 launch"*).
* **Design custom stakeholder reports** (e.g. *"Create an executive sponsor 1-pager for SteerCo"*).

*Click any scenario on the left or type your request below!*
`;

/**
 * Format markdown text into clean HTML.
 */
function formatMarkdown(text) {
  if (!text) return "";
  if (window.marked && typeof window.marked.parse === "function") {
    try {
      return window.marked.parse(text);
    } catch (e) {
      console.warn("Marked parse error:", e);
    }
  }
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
const AVAILABLE_STAKEHOLDERS = [
  { id: "exec-sponsor", name: "👑 Executive Sponsor", role: "executive" },
  { id: "eng-lead-core", name: "⚙️ Engineering Lead", role: "engineering_lead" },
  { id: "sec-lead", name: "🔒 Security Lead", role: "security_lead" },
  { id: "qa-lead", name: "🧪 QA & Release Lead", role: "qa_lead" },
  { id: "po-commerce", name: "🛒 Product Owner", role: "product_owner" },
  { id: "pm-default", name: "🎯 Program Manager", role: "project_manager" }
];

/**
 * Render structured proposed template card.
 */
function renderProposedCard(tpl, messageIndex) {
  if (!tpl) return "";
  const blocksCount = (tpl.blocks || []).length;
  const activeStkIds = tpl.stakeholder_ids || ["exec-sponsor", "sec-lead", "eng-lead-core", "pm-default"];
  const scope = tpl.project_scope || tpl.project_key || "ALL";
  const format = (tpl.export_format || "html").toUpperCase();

  const activePills = AVAILABLE_STAKEHOLDERS
    .filter(s => activeStkIds.includes(s.id))
    .map(s => `<span class="context-pill" style="background: rgba(99, 102, 241, 0.2); border: 1px solid rgba(99, 102, 241, 0.4); font-size: 11px; padding: 2px 8px; border-radius: 12px; color: #a5b4fc;">${escapeHtml(s.name)}</span>`)
    .join(" ");

  const toggleChips = AVAILABLE_STAKEHOLDERS.map(s => {
    const isSelected = activeStkIds.includes(s.id);
    return `
      <button type="button" class="stk-toggle-chip" data-msg-idx="${messageIndex}" data-stk-id="${s.id}"
              style="padding: 4px 10px; border-radius: 14px; font-size: 11px; cursor: pointer; transition: all 0.2s;
                     background: ${isSelected ? 'rgba(99, 102, 241, 0.35)' : 'rgba(30, 41, 59, 0.8)'};
                     color: ${isSelected ? '#e0e7ff' : '#94a3b8'};
                     border: 1px solid ${isSelected ? '#818cf8' : 'rgba(255,255,255,0.1)'};">
        ${isSelected ? '✓ ' : '+ '}${escapeHtml(s.name)}
      </button>
    `;
  }).join(" ");

  return `
    <div class="assistant-proposal-card" data-index="${messageIndex}">
      <div class="proposal-card-header">
        <div class="proposal-card-title">
          <span>📋</span>
          <strong>${escapeHtml(tpl.name || "Stakeholders-Adjusted Report")}</strong>
        </div>
        <span class="proposal-card-badge">✨ AI Recommended</span>
      </div>
      
      <div class="proposal-card-grid">
        <div class="proposal-grid-item">
          <span class="grid-lbl">Scope</span>
          <span class="grid-val" id="card-scope-val-${messageIndex}">${escapeHtml(scope)}</span>
        </div>
        <div class="proposal-grid-item">
          <span class="grid-lbl">Audience</span>
          <span class="grid-val" id="card-stk-count-${messageIndex}">${activeStkIds.length} Personas</span>
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
        ${escapeHtml(tpl.description || "Delivery status report dynamically adjusted for selected stakeholder priorities and project scope.")}
      </div>

      <!-- Interactive Project & Stakeholder Customizer -->
      <div class="proposal-customizer-box" style="margin-top: 12px; padding: 12px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 8px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <span style="font-weight: 600; font-size: 12px; color: #a5b4fc; display: flex; align-items: center; gap: 6px;">
            <span>👥 Target Stakeholders</span>
          </span>
          <button type="button" class="btn-toggle-add-stk" data-index="${messageIndex}" style="background: none; border: none; color: #38bdf8; font-size: 11px; cursor: pointer; text-decoration: underline; font-weight: 500;">
            ➕ Add / Change Stakeholders
          </button>
        </div>
        
        <div id="stk-pills-container-${messageIndex}" style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 8px;">
          ${activePills || '<span style="font-size: 11px; color: #94a3b8;">No stakeholders assigned</span>'}
        </div>

        <div id="add-stk-panel-${messageIndex}" style="display: none; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(99, 102, 241, 0.25);">
          <div style="font-size: 11px; color: #94a3b8; margin-bottom: 6px;">Click to add or remove stakeholder perspectives:</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;">
            ${toggleChips}
          </div>

          <div style="display: flex; align-items: center; gap: 8px; background: rgba(30, 41, 59, 0.5); padding: 6px 10px; border-radius: 6px;">
            <label style="font-size: 11px; color: #94a3b8; font-weight: 600;">Project Scope:</label>
            <select class="card-proj-scope-select" data-msg-idx="${messageIndex}" style="background: #1e293b; color: #f8fafc; border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 4px; padding: 3px 8px; font-size: 11px;">
              <option value="ALL" ${scope === "ALL" ? "selected" : ""}>ALL — All Portfolio Projects</option>
              <option value="CHK" ${scope === "CHK" ? "selected" : ""}>CHK — Checkout & Commerce Flow</option>
              <option value="CORE" ${scope === "CORE" ? "selected" : ""}>CORE — Platform Core & Analytics</option>
              <option value="MOB" ${scope === "MOB" ? "selected" : ""}>MOB — Mobile Parity & Security</option>
              <option value="HRZ" ${scope === "HRZ" ? "selected" : ""}>HRZ — Horizon</option>
            </select>
          </div>
        </div>
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
    const skillBadge = (!isUser && msg.skill_used)
      ? `<div style="margin-bottom: 6px;"><span class="skill-used-tag" style="font-size: 11px; padding: 2px 8px; border-radius: 12px; background: rgba(99, 102, 241, 0.18); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.3); display: inline-block;">✨ Applied Skill: <strong>${escapeHtml(msg.skill_used)}</strong></span></div>`
      : "";

    html += `
      <div class="assistant-message ${isUser ? 'user-message' : 'bot-message'}">
        <div class="msg-avatar">${avatar}</div>
        <div class="msg-content">
          <div class="msg-sender">${senderName}</div>
          ${skillBadge}
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
            <span>Synthesizing live Jira metrics, decisions, and project intelligence...</span>
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

  // Bind stakeholder customizer toggle buttons
  container.querySelectorAll(".btn-toggle-add-stk").forEach(btn => {
    btn.onclick = () => {
      const idx = btn.dataset.index;
      const panel = $(`add-stk-panel-${idx}`);
      if (panel) {
        panel.style.display = panel.style.display === "none" ? "block" : "none";
      }
    };
  });

  // Bind stakeholder toggle chips
  container.querySelectorAll(".stk-toggle-chip").forEach(chip => {
    chip.onclick = () => {
      const msgIdx = parseInt(chip.dataset.msgIdx, 10);
      const stkId = chip.dataset.stkId;
      const msg = _chatHistory[msgIdx];
      if (!msg || !msg.template) return;
      
      let stks = msg.template.stakeholder_ids || [];
      if (stks.includes(stkId)) {
        stks = stks.filter(id => id !== stkId);
      } else {
        stks.push(stkId);
      }
      msg.template.stakeholder_ids = stks;
      renderChatStream();
    };
  });

  // Bind project scope selector inside proposal cards
  container.querySelectorAll(".card-proj-scope-select").forEach(sel => {
    sel.onchange = () => {
      const msgIdx = parseInt(sel.dataset.msgIdx, 10);
      const msg = _chatHistory[msgIdx];
      if (msg && msg.template) {
        msg.template.project_scope = sel.value;
        const scopeValEl = $(`card-scope-val-${msgIdx}`);
        if (scopeValEl) scopeValEl.textContent = sel.value;
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
    const currentProj = window.state?.currentProject;
    const payload = {
      message: text,
      user_prompt: text,
      project_key: (currentProj && currentProj !== "ALL") ? currentProj : null,
      stakeholder_ids: ["exec-sponsor", "sec-lead", "eng-lead-core", "pm-default"],
      chat_history: _chatHistory.slice(0, -1),
      context: "assistant"
    };

    const res = await fetchWithTimeout(`${API_BASE}/assistant/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "include"
    }, 90000);

    if (!res.ok) {
      throw new Error(`Failed to get assistant response (HTTP ${res.status})`);
    }

    const data = await res.json();
    _lastProposedTemplate = data.proposed_template || null;

    _chatHistory.push({
      role: "assistant",
      content: data.reply || "I have analyzed your request.",
      template: data.proposed_template || null,
      skill_used: data.skill_used || null
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

  // Scenario cards: populate prompt suggestion into input box for user review/editing
  document.querySelectorAll(".assistant-scenario-card").forEach(card => {
    card.onclick = () => {
      const prompt = card.dataset.prompt;
      const input = $("assistant-chat-input");
      if (prompt && input) {
        input.value = prompt;
        input.focus({ preventScroll: true });
        input.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    };
  });
}
