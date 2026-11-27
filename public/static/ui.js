/* ==========================================================================
 * ui.js — 공통 UI 유틸 (토스트 / 표 렌더링 / 다운로드 / 모달 / 디바운스)
 * ========================================================================== */

export const RISK = { "매우 높음": 5, "높음": 4, "중간": 3, "주의": 2, "낮음": 1 };
export const RISK_LEVELS = ["매우 높음", "높음", "중간", "주의", "낮음"];

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function num(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "";
  if (typeof n === "number") return n.toLocaleString("ko-KR");
  return escapeHtml(n);
}

let toastTimer = null;
export function toast(msg, kind = "", ms = 2600) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast " + kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

export function riskBadge(risk) {
  const lv = RISK[risk] || 0;
  if (!lv) return `<span class="risk-badge risk-1">${escapeHtml(risk || "-")}</span>`;
  return `<span class="risk-badge risk-${lv}">${escapeHtml(risk)}</span>`;
}

export function debounce(fn, ms = 220) {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

/* --------------------------------------------------------------------------
 * 표 렌더링
 * columns: [{ key, label, type: 'num'|'text'|'risk'|'mono'|'clip'|'html', width }]
 * options: { onRowClick, rowClass, selectedIndex, maxRows, emptyText }
 * ------------------------------------------------------------------------ */
export function renderTable(container, rows, columns, options = {}) {
  if (!container) return;
  const {
    onRowClick = null,
    rowClass = null,
    maxRows = 3000,
    emptyText = "결과가 없습니다.",
    keepScroll = false,
  } = options;

  const prevScroll = keepScroll ? container.scrollTop : 0;
  const list = (rows || []).slice(0, maxRows);
  if (!list.length) {
    container.innerHTML = `<p class="empty-note">${escapeHtml(emptyText)}</p>`;
    return;
  }

  const head = columns
    .map(
      (c) =>
        `<th${c.width ? ` style="min-width:${c.width}px"` : ""} data-key="${escapeHtml(c.key)}">${escapeHtml(
          c.label ?? c.key
        )}</th>`
    )
    .join("");

  const body = list
    .map((row, i) => {
      const cls = rowClass ? rowClass(row, i) : "";
      const tds = columns
        .map((c) => {
          const v = row[c.key];
          if (c.type === "risk") return `<td>${riskBadge(v)}</td>`;
          if (c.type === "num") return `<td class="num">${num(v)}</td>`;
          if (c.type === "mono") return `<td class="mono">${escapeHtml(v ?? "")}</td>`;
          if (c.type === "html") return `<td>${v ?? ""}</td>`;
          if (c.type === "clip") return `<td><div class="cell-clip">${escapeHtml(v ?? "")}</div></td>`;
          return `<td>${escapeHtml(v ?? "")}</td>`;
        })
        .join("");
      return `<tr class="${cls}" data-idx="${i}">${tds}</tr>`;
    })
    .join("");

  container.innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

  if (list.length >= maxRows) {
    const note = document.createElement("p");
    note.className = "empty-note";
    note.textContent = `표시 상한 ${maxRows.toLocaleString()}행까지 표시했습니다. (전체 ${rows.length.toLocaleString()}행 · CSV 저장 시 전체 포함)`;
    container.appendChild(note);
  }

  if (onRowClick) {
    container.querySelectorAll("tbody tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        container.querySelectorAll("tbody tr.selected").forEach((x) => x.classList.remove("selected"));
        tr.classList.add("selected");
        onRowClick(list[Number(tr.dataset.idx)], Number(tr.dataset.idx));
      });
    });
  }
  if (keepScroll) container.scrollTop = prevScroll;
}

export function tableToCSV(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = columns.map((c) => esc(c.label ?? c.key)).join(",");
  const body = rows
    .map((r) => columns.map((c) => esc(r[c.key])).join(","))
    .join("\r\n");
  return "\ufeff" + head + "\r\n" + body;
}

export function downloadBlob(content, filename, mime = "application/octet-stream") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadCSV(rows, columns, filename) {
  downloadBlob(tableToCSV(rows, columns), filename, "text/csv;charset=utf-8");
}

/* 모달 제어 */
export function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}
export function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}
export function bindModals() {
  $$(".modal-backdrop").forEach((bd) => {
    bd.addEventListener("mousedown", (e) => {
      if (e.target === bd) bd.hidden = true;
    });
  });
  $$("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $$(".modal-backdrop").forEach((bd) => (bd.hidden = true));
    }
  });
}

/** 원문 마스킹: 중간을 * 로 가린다(미리보기 공유용). */
export function maskText(s) {
  const t = String(s ?? "");
  if (t.length <= 6) return "*".repeat(t.length);
  const head = Math.max(2, Math.floor(t.length * 0.2));
  const tail = Math.max(2, Math.floor(t.length * 0.15));
  return t.slice(0, head) + "＊".repeat(Math.max(1, t.length - head - tail)) + t.slice(t.length - tail);
}

export function fmtDate(s) {
  if (!s) return "";
  /* D1 datetime('now') 는 UTC */
  const iso = String(s).replace(" ", "T") + (String(s).includes("Z") ? "" : "Z");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(s);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}`;
}
