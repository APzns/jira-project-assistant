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
  "#eab308"  // Security Guild - Bright Yellow
];

const _teamColorCache = {};
let _teamColorCounter = 0;

export function teamColor(team) {
  if (_teamColorCache[team] === undefined) {
    _teamColorCache[team] = TEAM_PALETTE[_teamColorCounter % TEAM_PALETTE.length];
    _teamColorCounter++;
  }
  return _teamColorCache[team];
}
