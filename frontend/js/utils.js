/* ---------- DOM & Formatting Utilities ---------- */

export function $(id) {
  return document.getElementById(id);
}

export function setText(id, txt) {
  const el = $(id);
  if (el) el.textContent = txt;
}

export function show(id, disp = "block") {
  const el = $(id);
  if (el) el.style.display = disp;
}

export function hide(id) {
  const el = $(id);
  if (el) el.style.display = "none";
}

export function hexToRgba(hex, a) {
  let c = String(hex).trim().replace("#", "");
  if (c.length === 3) c = c.split("").map(ch => ch + ch).join("");
  const r = parseInt(c.slice(0, 2), 16),
        g = parseInt(c.slice(2, 4), 16),
        b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function fmtDate(iso) {
  if (!iso) return "–";
  let s = String(iso);
  if (s.includes("T") && !s.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(s)) s += "Z";
  let d = new Date(s);
  if (isNaN(d.getTime())) d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

export function fmtDay(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? String(iso)
    : d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatForecastDelay(delay) {
  if (delay === undefined || delay === null) {
    return { text: "–", className: "" };
  }
  const text = delay > 0 ? `+${delay}d` : `${delay}d`;
  let className = "delta-red";
  if (delay <= 5) {
    className = "delta-green";
  } else if (delay <= 10) {
    className = "delta-yellow";
  }
  return { text, className };
}

export const TEAM_PALETTE = [
  "#4c8dff", // Checkout Squad - Electric Cyan
  "#a855f7", // Data Insights - Vivid Violet
  "#d946ef", // Growth Squad - Fuchsia
  "#2563eb", // Mobile Team - Royal Blue
  "#10b981", // Platform Core - Mint Green
  "#eab308", // Security Guild - Bright Yellow
  "#f97316", // Payments Squad - Orange
  "#06b6d4", // AI Engine Squad - Cyan
];

const _knownTeamColors = {
  "Checkout Squad": "#4c8dff",
  "Data Insights": "#a855f7",
  "Growth Squad": "#d946ef",
  "Mobile Team": "#2563eb",
  "Platform Core": "#10b981",
  "Security Guild": "#eab308",
  "Payments Squad": "#f97316",
  "AI Engine Squad": "#06b6d4",
  "Unassigned": "#8b949e",
  "(none)": "#8b949e"
};

const _teamColorCache = { ..._knownTeamColors };
let _teamColorCounter = 0;

export function teamColor(team) {
  if (!team || team === "Unassigned" || team === "(none)") return "#8b949e";
  if (_teamColorCache[team] === undefined) {
    _teamColorCache[team] = TEAM_PALETTE[_teamColorCounter % TEAM_PALETTE.length];
    _teamColorCounter++;
  }
  return _teamColorCache[team];
}

/**
 * Inline formatting for markdown text (bold, italic, code, links, strikethrough).
 */
function _inlineMarkdown(str) {
  let s = escapeHtml(str);
  // Inline code `code`
  s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>');
  // Bold **text** or __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic *text* or _text_
  s = s.replace(/(^|[^\*])\*([^*]+)\*([^\*]|$)/g, '$1<em>$2</em>$3');
  s = s.replace(/(^|[^_])_([^_]+)_([^_]|$)/g, '$1<em>$2</em>$3');
  // Strikethrough ~~text~~
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // Markdown links [text](url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)\"']+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return s;
}

/**
 * Fallback block-level Markdown parser with full GFM table, list, code block, and header support.
 */
export function parseMarkdownFallback(text) {
  if (!text) return "";
  const lines = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const output = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // 1. Fenced Code Block
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(escapeHtml(lines[i]));
        i++;
      }
      i++; // skip closing ```
      output.push(`<pre><code class="${lang ? `language-${escapeHtml(lang)}` : ''}">${codeLines.join("\n")}</code></pre>`);
      continue;
    }

    // 2. Horizontal Rule (---, ***, ___)
    if (/^\s*([-*_]){3,}\s*$/.test(rawLine)) {
      output.push('<hr class="markdown-hr" />');
      i++;
      continue;
    }

    // 3. Headers (# to ######)
    const hMatch = rawLine.match(/^(#{1,6})\s+(.*)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      output.push(`<h${level} class="md-heading md-h${level}">${_inlineMarkdown(hMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // 4. Blockquotes (> ...)
    if (trimmed.startsWith(">")) {
      const bqLines = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        bqLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      output.push(`<blockquote>${parseMarkdownFallback(bqLines.join("\n"))}</blockquote>`);
      continue;
    }

    // 5. GFM Markdown Tables
    // Matches: | col1 | col2 | or col1 | col2
    // Followed by separator: | --- | :---: | ---: |
    const isPipeLine = trimmed.includes("|");
    const nextLine = (i + 1 < lines.length) ? lines[i + 1].trim() : "";
    const isSepLine = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(nextLine);

    if (isPipeLine && isSepLine && trimmed.split("|").filter(Boolean).length >= 1) {
      const headerRow = trimmed;
      const sepRow = nextLine;
      i += 2;

      const parseRowCells = (r) => {
        let cleaned = r.trim();
        if (cleaned.startsWith("|")) cleaned = cleaned.slice(1);
        if (cleaned.endsWith("|")) cleaned = cleaned.slice(0, -1);
        return cleaned.split("|").map(c => c.trim());
      };

      const headers = parseRowCells(headerRow);
      const seps = parseRowCells(sepRow);
      const alignments = seps.map(s => {
        const left = s.startsWith(":");
        const right = s.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        return "left";
      });

      const bodyRows = [];
      while (i < lines.length) {
        const rowTrim = lines[i].trim();
        if (!rowTrim || !rowTrim.includes("|")) break;
        bodyRows.push(parseRowCells(rowTrim));
        i++;
      }

      let tblHtml = '<div class="table-container markdown-table-wrap"><table class="markdown-table"><thead><tr>';
      headers.forEach((h, idx) => {
        const align = alignments[idx] || "left";
        tblHtml += `<th style="text-align: ${align};">${_inlineMarkdown(h)}</th>`;
      });
      tblHtml += '</tr></thead><tbody>';

      bodyRows.forEach(row => {
        tblHtml += '<tr>';
        row.forEach((cell, idx) => {
          const align = alignments[idx] || "left";
          tblHtml += `<td style="text-align: ${align};">${_inlineMarkdown(cell)}</td>`;
        });
        tblHtml += '</tr>';
      });
      tblHtml += '</tbody></table></div>';
      output.push(tblHtml);
      continue;
    }

    // 6. Unordered Lists (*, -, +)
    if (/^\s*[-*+]\s+(.*)$/.test(rawLine)) {
      const listItems = [];
      while (i < lines.length && /^\s*[-*+]\s+(.*)$/.test(lines[i])) {
        const m = lines[i].match(/^\s*[-*+]\s+(.*)$/);
        listItems.push(`<li>${_inlineMarkdown(m[1])}</li>`);
        i++;
      }
      output.push(`<ul>${listItems.join("")}</ul>`);
      continue;
    }

    // 7. Ordered Lists (1., 2., etc.)
    if (/^\s*\d+\.\s+(.*)$/.test(rawLine)) {
      const listItems = [];
      while (i < lines.length && /^\s*\d+\.\s+(.*)$/.test(lines[i])) {
        const m = lines[i].match(/^\s*\d+\.\s+(.*)$/);
        listItems.push(`<li>${_inlineMarkdown(m[1])}</li>`);
        i++;
      }
      output.push(`<ol>${listItems.join("")}</ol>`);
      continue;
    }

    // 8. Blank Line
    if (!trimmed) {
      i++;
      continue;
    }

    // 9. Paragraph Block
    const pLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !lines[i].match(/^(#{1,6})\s+/) &&
      !/^\s*([-*_]){3,}\s*$/.test(lines[i]) &&
      !lines[i].trim().startsWith(">") &&
      !(lines[i].trim().includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/.test(lines[i + 1].trim())) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      pLines.push(_inlineMarkdown(lines[i].trim()));
      i++;
    }
    if (pLines.length) {
      output.push(`<p>${pLines.join("<br />")}</p>`);
    }
  }

  return output.join("\n");
}

/**
 * Universal markdown renderer with marked.js acceleration + robust fallback parser.
 */
export function renderMarkdown(text) {
  if (!text) return "";
  
  if (typeof window !== "undefined" && window.marked && typeof window.marked.parse === "function") {
    try {
      if (typeof window.marked.setOptions === "function") {
        window.marked.setOptions({ gfm: true, breaks: true });
      }
      let html = window.marked.parse(text);
      // Ensure tables generated by marked are wrapped for smooth horizontal scrolling in drawer
      if (html.includes("<table") && !html.includes("markdown-table-wrap")) {
        html = html.replace(/<table(?:\s+[^>]*)?>[\s\S]*?<\/table>/gi, (tbl) => {
          return `<div class="table-container markdown-table-wrap">${tbl}</div>`;
        });
      }
      return html;
    } catch (e) {
      console.warn("Marked parse error, using fallback parser:", e);
    }
  }

  return parseMarkdownFallback(text);
}

