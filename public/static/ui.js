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
 * 표 렌더링 (페이지네이션 + 컬럼 정렬)
 *
 * columns: [{ key, label, type:'num'|'text'|'risk'|'mono'|'clip'|'html',
 *             width, noSort, render(row) }
 *           ]
 * options: { onRowClick, rowClass, rowKey, selectedKey, emptyText,
 *            pageSize, keepScroll }
 *
 * · 행 수 상한으로 데이터를 잘라내지 않는다. 화면에 한 번에 그리는 양만
 *   페이지 단위로 나눠 브라우저가 멈추지 않게 한다(끝까지 넘겨 볼 수 있음).
 * ------------------------------------------------------------------------ */
const tableStates = new WeakMap();
export const PAGE_SIZE_CHOICES = [100, 500, 1000, 5000, 20000, 0]; // 0 = 전체

function sortValue(row, key, type) {
  const v = row[key];
  if (type === "risk") return RISK[v] || 0;
  if (type === "num") {
    const n = Number(v);
    return Number.isFinite(n) ? n : -Infinity;
  }
  return String(v ?? "");
}

function compareRows(a, b, key, type) {
  const va = sortValue(a, key, type);
  const vb = sortValue(b, key, type);
  if (type === "num" || type === "risk") return va - vb;
  if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb, "ko");
  return va < vb ? -1 : va > vb ? 1 : 0;
}

function cellHtml(row, c) {
  if (typeof c.render === "function") {
    return `<td${c.cls ? ` class="${c.cls}"` : ""}>${c.render(row)}</td>`;
  }
  const v = row[c.key];
  if (c.type === "risk") return `<td>${riskBadge(v)}</td>`;
  if (c.type === "num") return `<td class="num">${num(v)}</td>`;
  if (c.type === "mono") return `<td class="mono">${escapeHtml(v ?? "")}</td>`;
  if (c.type === "html") return `<td>${v ?? ""}</td>`;
  if (c.type === "clip") return `<td><div class="cell-clip">${escapeHtml(v ?? "")}</div></td>`;
  return `<td>${escapeHtml(v ?? "")}</td>`;
}

function keyOf(row, rowKey, idx) {
  if (rowKey == null) return String(idx);
  if (typeof rowKey === "function") return String(rowKey(row));
  return String(row[rowKey]);
}

export function renderTable(container, rows, columns, options = {}) {
  if (!container) return;
  const {
    onRowClick = null,
    rowClass = null,
    emptyText = "결과가 없습니다.",
    keepScroll = false,
    rowKey = null,
    selectedKey = null,
  } = options;

  const src = rows || [];
  let st = tableStates.get(container);
  if (!st) {
    st = {
      page: 1,
      sortKey: null,
      sortDir: 1,
      pageSize: options.pageSize ?? 500,
      lastLen: -1,
    };
    tableStates.set(container, st);
  }
  /* 필터/검색으로 행 집합이 바뀌면 첫 페이지로 돌아간다 */
  if (st.lastLen !== src.length) {
    st.page = 1;
    st.lastLen = src.length;
  }

  if (!src.length) {
    container.innerHTML = `<p class="empty-note">${escapeHtml(emptyText)}</p>`;
    return;
  }

  const prevScroll = keepScroll ? container.scrollTop : 0;
  /* selectedKey 는 함수일 수 있다(정렬 재렌더 시 최신 선택을 반영하기 위함) */
  const curSelected = typeof selectedKey === "function" ? selectedKey() : selectedKey;

  /* ---- 정렬 ---- */
  const sorted = src.slice();
  if (st.sortKey) {
    const col = columns.find((c) => c.key === st.sortKey);
    const type = col ? col.type : "text";
    sorted.sort((a, b) => compareRows(a, b, st.sortKey, type) * st.sortDir);
  }

  /* ---- 페이지 계산 ---- */
  const total = sorted.length;
  const size = st.pageSize;
  const pages = size > 0 ? Math.max(1, Math.ceil(total / size)) : 1;
  if (st.page > pages) st.page = pages;
  if (st.page < 1) st.page = 1;
  const start = size > 0 ? (st.page - 1) * size : 0;
  const list = size > 0 ? sorted.slice(start, start + size) : sorted;

  /* ---- 헤더 ---- */
  const head = columns
    .map((c) => {
      const width = c.width ? ` style="min-width:${c.width}px"` : "";
      const label = escapeHtml(c.label ?? c.key);
      if (c.noSort) return `<th${width} data-key="${escapeHtml(c.key)}">${label}</th>`;
      const active = st.sortKey === c.key;
      const arrow = active ? (st.sortDir > 0 ? " ▲" : " ▼") : "";
      return `<th class="sortable${active ? " sorted" : ""}"${width} data-skey="${escapeHtml(
        c.key
      )}" title="클릭하여 정렬">${label}${arrow}</th>`;
    })
    .join("");

  /* ---- 본문 ---- */
  const body = list
    .map((row, i) => {
      const absIdx = start + i;
      const cls = rowClass ? rowClass(row, absIdx) : "";
      const sel = curSelected != null && keyOf(row, rowKey, absIdx) === String(curSelected);
      const tds = columns.map((c) => cellHtml(row, c)).join("");
      return `<tr class="${cls}${sel ? " selected" : ""}" data-idx="${absIdx}" data-key="${escapeHtml(
        keyOf(row, rowKey, absIdx)
      )}">${tds}</tr>`;
    })
    .join("");

  const sizeOptions = PAGE_SIZE_CHOICES.map(
    (n) =>
      `<option value="${n}"${n === size ? " selected" : ""}>${
        n === 0 ? "전체" : `${n.toLocaleString()}행`
      }</option>`
  ).join("");

  const pager =
    `<div class="table-pager">` +
    `<span class="pager-info">전체 <b>${total.toLocaleString()}</b>행` +
    (pages > 1
      ? ` · <b>${st.page.toLocaleString()}</b>/${pages.toLocaleString()}쪽`
      : "") +
    `</span>` +
    `<span class="pager-actions">` +
    `<button class="btn btn-mini" data-pg="first" type="button"${st.page <= 1 ? " disabled" : ""}>«</button>` +
    `<button class="btn btn-mini" data-pg="prev" type="button"${st.page <= 1 ? " disabled" : ""}>‹</button>` +
    `<button class="btn btn-mini" data-pg="next" type="button"${
      st.page >= pages ? " disabled" : ""
    }>›</button>` +
    `<button class="btn btn-mini" data-pg="last" type="button"${
      st.page >= pages ? " disabled" : ""
    }>»</button>` +
    `<select class="mini-input" data-pg-size title="한 쪽에 표시할 행 수">${sizeOptions}</select>` +
    `</span>` +
    `</div>`;

  container.innerHTML =
    `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` + pager;

  /* ---- 정렬 클릭 ---- */
  container.querySelectorAll("thead th[data-skey]").forEach((th) => {
    th.addEventListener("click", () => {
      const k = th.dataset.skey;
      if (st.sortKey === k) {
        /* 오름 → 내림 → 정렬해제 */
        st.sortDir = st.sortDir > 0 ? -1 : 0;
        if (st.sortDir === 0) st.sortKey = null;
      } else {
        st.sortKey = k;
        st.sortDir = 1;
      }
      renderTable(container, rows, columns, { ...options, keepScroll: true });
    });
  });

  /* ---- 페이지 이동 ---- */
  container.querySelectorAll("[data-pg]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const act = btn.dataset.pg;
      const target =
        act === "first"
          ? 1
          : act === "prev"
          ? st.page - 1
          : act === "next"
          ? st.page + 1
          : pages;
      const next = Math.min(Math.max(1, target), pages);
      if (next === st.page) return;
      st.page = next;
      renderTable(container, rows, columns, options);
      container.scrollTop = 0;
    });
  });
  const sizeSel = container.querySelector("[data-pg-size]");
  if (sizeSel) {
    sizeSel.addEventListener("change", () => {
      st.pageSize = Number(sizeSel.value);
      st.page = 1;
      renderTable(container, rows, columns, options);
      container.scrollTop = 0;
    });
  }

  /* ---- 행 클릭 ---- */
  if (onRowClick) {
    container.querySelectorAll("tbody tr").forEach((tr) => {
      tr.addEventListener("click", (e) => {
        /* 행 안의 버튼/체크박스 클릭은 행 선택으로 처리하지 않는다 */
        if (e.target.closest("button, input, select, a, label")) return;
        const idx = Number(tr.dataset.idx);
        container.querySelectorAll("tbody tr.selected").forEach((x) => x.classList.remove("selected"));
        tr.classList.add("selected");
        onRowClick(sorted[idx], idx);
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
