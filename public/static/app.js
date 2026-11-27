/* ==========================================================================
 * app.js — Security Word Analyzer Web (메인 컨트롤러)
 * ========================================================================== */
import {
  analyze,
  reanalyze as runReanalysis,
  analyzePatternTypes,
  buildExportSheets,
  decodeBytes,
  detectSeparator,
  parseCSV,
  RISK,
} from "./engine.js";
import { Store, api } from "./api.js";
import * as UI from "./ui.js";
import { exportExcel, exportCSVFile } from "./export.js";
import { initDictUI } from "./dict.js";
import { initDbUI } from "./dbsettings.js";

const { $, $$, toast, escapeHtml, renderTable, fmtDate } = UI;

/* --------------------------------------------------------------------------
 * 전역 상태
 * ------------------------------------------------------------------------ */
export const state = {
  store: null,
  fileName: "",
  fileType: "", // 'xlsx' | 'csv'
  sheets: {}, // name -> table(2D array)
  sheetNames: [],
  activeSheet: "",
  columns: [],
  columnsAll: [],
  rows: [], // 필터 적용 후
  rowNumbers: [],
  rowsRaw: [], // 필터 전
  rowNumbersRaw: [],
  result: null,
  reResult: null,
  ptResult: null,
  ptTypesData: [],
  dict: { stopword: [], security: [], pattern: [], pattern_type: [] },
  running: false,
};

const els = {};
function cacheEls() {
  [
    "dropzone", "file-input", "file-info", "sheet-select", "filter-col", "filter-value",
    "filter-preview", "column-list", "col-count", "col-search", "opt-minlen", "opt-minfreq",
    "opt-space", "opt-ptype", "opt-persist", "persist-wrap", "btn-analyze", "btn-export",
    "btn-export-csv", "btn-save-db", "progress-bar", "status-text", "summary-cards",
    "summary-table", "risk-bars", "words-search", "words-sort", "words-info", "words-table",
    "security-search", "security-risk", "security-info", "security-table", "findings-search",
    "findings-method", "findings-mask", "findings-info", "findings-table", "re-minfreq",
    "re-minlen", "re-phrasefreq", "re-particles", "re-num", "re-eng", "btn-reanalyze",
    "re-info", "re-words-table", "re-phrases-table", "pt-mincount", "pt-minvalues",
    "pt-maxvariants", "pt-auto", "btn-ptype", "pt-info", "ptype-table", "ptype-values-table",
    "history-info", "history-table", "history-detail", "db-status", "db-status-text",
  ].forEach((id) => (els[id] = document.getElementById(id)));
}

/* --------------------------------------------------------------------------
 * 유틸
 * ------------------------------------------------------------------------ */
function setStatus(msg, pct) {
  if (els["status-text"]) els["status-text"].textContent = msg;
  if (pct !== undefined && els["progress-bar"]) els["progress-bar"].style.width = pct + "%";
}

function selectedColumns() {
  return $$("#column-list input[type=checkbox]")
    .filter((c) => c.checked)
    .map((c) => c.dataset.col);
}

function storageMode() {
  const r = document.querySelector('input[name="storage-mode"]:checked');
  return r ? r.value : "local";
}

/** 엔진에 넘길 사전(활성 항목만) */
function dictForEngine() {
  const d = state.dict;
  const on = (x) => Number(x.enabled) === 1;
  return {
    stopwords: new Set(d.stopword.filter(on).map((x) => x.value)),
    securityWords: d.security.filter(on).map((x) => [x.value, x.category, x.risk]),
    patterns: d.pattern.filter(on).map((x) => [x.value, x.pattern, x.category, x.risk]),
    patternTypes: d.pattern_type.filter(on).map((x) => [x.value, x.pattern, x.category, x.risk]),
  };
}

/* --------------------------------------------------------------------------
 * 파일 로드
 * ------------------------------------------------------------------------ */
function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("Excel 라이브러리 로드 실패")));
    s.onerror = () => reject(new Error("Excel 라이브러리를 불러오지 못했습니다."));
    document.head.appendChild(s);
  });
}

async function handleFile(file) {
  if (!file) return;
  setStatus("파일 읽는 중…", 5);
  try {
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    state.fileName = file.name;
    state.sheets = {};
    state.sheetNames = [];

    if (ext === "csv" || ext === "txt") {
      const buf = await file.arrayBuffer();
      const { text, encoding } = decodeBytes(buf);
      const sep = detectSeparator(text);
      const table = parseCSV(text, sep);
      state.sheets = { "CSV 데이터": table };
      state.sheetNames = ["CSV 데이터"];
      state.fileType = "csv";
      state.encodingInfo = `${encoding.toUpperCase()} · 구분자 '${sep === "\t" ? "TAB" : sep}'`;
      els["file-info"].textContent = `${file.name} · ${state.encodingInfo}`;
    } else {
      const XLSX = await loadSheetJS();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false, raw: true });
      for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const table = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          blankrows: true,
          defval: "",
          raw: true,
        });
        state.sheets[name] = table;
      }
      state.sheetNames = wb.SheetNames.slice();
      state.fileType = "xlsx";
      state.encodingInfo = `${wb.SheetNames.length}개 시트`;
      els["file-info"].textContent = `${file.name} · ${state.encodingInfo}`;
    }

    /* 시트 셀렉트 채우기 */
    els["sheet-select"].innerHTML = state.sheetNames
      .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
      .join("");
    /* 이전 결과 초기화 */
    resetResults();
    activateSheet(state.sheetNames[0]);
    setStatus("파일 로드 완료", 0);
  } catch (e) {
    console.error(e);
    toast("파일을 읽지 못했습니다: " + e.message, "err", 5000);
    setStatus("파일 오류", 0);
  }
}

function resetResults() {
  state.result = null;
  state.reResult = null;
  state.ptResult = null;
  state.ptTypesData = [];
  els["btn-export"].disabled = true;
  els["btn-export-csv"].disabled = true;
  els["btn-save-db"].disabled = true;
  els["btn-reanalyze"].disabled = true;
  els["btn-ptype"].disabled = true;
  renderSummary();
  renderWords();
  renderSecurity();
  renderFindings();
  renderReanalysis();
  renderPatternTypes();
}

/** 2D 테이블 → {columns, rows, rowNumbers} (빈 행은 건너뛰되 원본 행번호는 유지) */
function buildDataset(table) {
  if (!table || !table.length) return { columns: [], rows: [], rowNumbers: [] };
  const header = table[0].map((h, i) => {
    const s = String(h === null || h === undefined ? "" : h).replace(/\s+/g, " ").trim();
    return s || `컬럼_${i + 1}`;
  });
  const seen = new Map();
  const columns = header.map((h) => {
    const n = seen.get(h) || 0;
    seen.set(h, n + 1);
    return n === 0 ? h : `${h}.${n}`;
  });
  const rows = [];
  const rowNumbers = [];
  for (let t = 1; t < table.length; t++) {
    const arr = table[t] || [];
    let hasAny = false;
    for (const v of arr) {
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        hasAny = true;
        break;
      }
    }
    if (!hasAny) continue;
    const rec = {};
    for (let c = 0; c < columns.length; c++) {
      const v = arr[c];
      rec[columns[c]] = v === undefined || v === null ? "" : v;
    }
    rows.push(rec);
    rowNumbers.push(t + 1); /* 엑셀 행번호(헤더=1) */
  }
  return { columns, rows, rowNumbers };
}

function activateSheet(name) {
  state.activeSheet = name;
  if (els["sheet-select"]) els["sheet-select"].value = name;
  const table = state.sheets[name] || [];
  const ds = buildDataset(table);
  state.columnsAll = ds.columns;
  state.rowsRaw = ds.rows;
  state.rowNumbersRaw = ds.rowNumbers;

  /* 컬럼 목록 */
  els["column-list"].innerHTML = ds.columns.length
    ? ds.columns
        .map(
          (c, i) =>
            `<label class="col-item"><input type="checkbox" data-col="${escapeHtml(
              c
            )}" checked /><span title="${escapeHtml(c)}">${escapeHtml(c)}</span></label>`
        )
        .join("")
    : `<p class="empty-note">컬럼이 없습니다.</p>`;

  /* 필터 컬럼 */
  els["filter-col"].innerHTML =
    `<option value="">(사용 안 함)</option>` +
    ds.columns.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

  updateColCount();
  applyFilter();
  els["btn-analyze"].disabled = ds.columns.length === 0;
  els["filter-preview"].textContent = `전체 ${ds.rows.length.toLocaleString()}행 · ${ds.columns.length}개 열`;
}

function updateColCount() {
  const total = $$("#column-list input[type=checkbox]").length;
  const sel = selectedColumns().length;
  els["col-count"].textContent = `(${sel}/${total})`;
  els["btn-analyze"].disabled = sel === 0 || !state.rowsRaw.length;
}

/** 조건 필터 적용 */
function applyFilter() {
  const col = els["filter-col"].value;
  const val = (els["filter-value"].value || "").trim();
  if (!col) {
    state.rows = state.rowsRaw;
    state.rowNumbers = state.rowNumbersRaw;
    els["filter-preview"].textContent = `필터 없음 · ${state.rowsRaw.length.toLocaleString()}행 대상`;
    return;
  }
  const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  const target = norm(val);
  const rows = [];
  const nums = [];
  state.rowsRaw.forEach((r, i) => {
    if (norm(r[col]) === target) {
      rows.push(r);
      nums.push(state.rowNumbersRaw[i]);
    }
  });
  state.rows = rows;
  state.rowNumbers = nums;
  els["filter-preview"].textContent = val
    ? `"${col}" = "${val}" → ${rows.length.toLocaleString()}행 일치 (전체 ${state.rowsRaw.length.toLocaleString()}행)`
    : "일치값을 입력하세요.";
}

/* --------------------------------------------------------------------------
 * 분석 실행
 * ------------------------------------------------------------------------ */
async function runAnalysis() {
  if (state.running) return;
  const cols = selectedColumns();
  if (!cols.length) return toast("분석할 열을 선택하세요.", "err");

  state.running = true;
  els["btn-analyze"].disabled = true;
  els["btn-export"].disabled = true;
  setStatus("분석 준비 중…", 0);

  const t0 = performance.now();
  try {
    const dict = dictForEngine();
    const allowSpace = els["opt-space"].checked;
    const minLen = Number(els["opt-minlen"].value) || 2;
    const doPt = els["opt-ptype"].checked;

    const result = await analyze({
      rows: state.rows,
      rowNumbers: state.rowNumbers,
      columns: cols,
      dict,
      allowSpace,
      minLen,
      patternTypes: doPt,
      onProgress: (p, msg) => setStatus(msg, p),
    });

    /* 메타 정보 병합 */
    const meta = {
      파일: state.fileName,
      시트: state.activeSheet,
      전체행수: state.rowsRaw.length,
      조건필터: els["filter-col"].value
        ? `${els["filter-col"].value} = ${els["filter-value"].value}`
        : "없음",
      조건일치행수: state.rows.length,
      분석시각: new Date().toLocaleString("ko-KR"),
      저장모드: storageMode() === "db" ? "DB" : "로컬",
    };
    result.summary = { ...meta, ...result.summary };
    result.findings = result.findings.map((f) => ({ ...f, Sheet: state.activeSheet }));

    state.result = result;
    state.reResult = null;
    state.ptResult = doPt
      ? { types: result.pt_types, variants: result.pt_variants, stats: result.pt_stats }
      : null;

    renderSummary();
    renderWords();
    renderSecurity();
    renderFindings();
    renderReanalysis();
    renderPatternTypes();

    els["btn-export"].disabled = false;
    els["btn-export-csv"].disabled = false;
    els["btn-save-db"].disabled = !state.store.dbReady;
    els["btn-reanalyze"].disabled = false;
    els["btn-ptype"].disabled = false;

    const sec = Math.round((performance.now() - t0) / 1000);
    setStatus(`분석 완료 (${sec}초 · 탐지 ${result.security.length}종)`, 100);

    /* 이력 저장 */
    await persistRun(result, false);
  } catch (e) {
    console.error(e);
    toast("분석 실패: " + e.message, "err", 6000);
    setStatus("분석 오류", 0);
  } finally {
    state.running = false;
    els["btn-analyze"].disabled = false;
    updateColCount();
  }
}

/** 이력 저장(요약 + 선택 시 결과 표까지) */
async function persistRun(result, forceResults) {
  const store = state.store;
  const mode = storageMode();
  if (mode !== "db" && !forceResults) {
    /* 로컬 모드에서도 브라우저 이력은 남긴다 */
  }
  try {
    const keep = store.settings.keep_history === "1";
    if (!keep) return;
    const persistResults = forceResults || store.settings.persist_results === "1";
    const results = persistResults
      ? [
          { kind: "words", payload: result.words, rowTotal: result.words.length },
          { kind: "security", payload: result.security, rowTotal: result.security.length },
          { kind: "findings", payload: result.findings.slice(0, 20000), rowTotal: result.findings.length },
          { kind: "ptype", payload: state.ptResult || {}, rowTotal: state.ptResult?.types?.length || 0 },
        ]
      : [];
    const r = await store.saveHistory({
      run: {
        fileName: state.fileName,
        sheet: state.activeSheet,
        storageMode: mode,
        rowCount: result.summary.분석행수 || 0,
        columnCount: result.summary.분석열수 || 0,
        columns: selectedColumns(),
        summary: result.summary,
        label: `${result.summary.보안탐지건수 || 0}건 탐지`,
      },
      results,
    });
    if (r && r.skipped) return;
  } catch (e) {
    console.warn("이력 저장 실패", e);
  }
}

/* --------------------------------------------------------------------------
 * 렌더링: 요약
 * ------------------------------------------------------------------------ */
const SUMMARY_LABELS = [
  ["전체행수", "전체 행수"],
  ["분석행수", "분석 행수"],
  ["분석열수", "분석 열수"],
  ["고유단어수", "고유 단어"],
  ["총단어수", "총 단어"],
  ["보안탐지건수", "보안 탐지"],
  ["고위험탐지건수", "고위험 탐지"],
  ["패턴유형수", "패턴 유형"],
];

function renderSummary() {
  const r = state.result;
  if (!r) {
    els["summary-cards"].innerHTML = `<p class="empty-note">분석을 실행하면 요약이 표시됩니다.</p>`;
    els["summary-table"].innerHTML = "";
    els["risk-bars"].innerHTML = "";
    return;
  }
  const s = r.summary || {};
  els["summary-cards"].innerHTML = SUMMARY_LABELS.map(([k, label]) => {
    const v = s[k];
    const danger = (k === "고위험탐지건수" && Number(v) > 0) ? " danger" : "";
    return `<div class="card"><div class="card-label">${label}</div>
      <div class="card-value${danger}">${v === undefined ? "-" : UI.num(v)}</div></div>`;
  }).join("");

  const rows = Object.entries(s).map(([k, v]) => ({ 항목: k, 값: v }));
  renderTable(els["summary-table"], rows, [
    { key: "항목", label: "항목", width: 160 },
    { key: "값", label: "값" },
  ]);

  /* 위험도 분포 */
  const counts = {};
  for (const lv of UI.RISK_LEVELS) counts[lv] = 0;
  for (const it of r.security || []) counts[it.위험도] = (counts[it.위험도] || 0) + 1;
  const max = Math.max(1, ...Object.values(counts));
  const colors = { "매우 높음": "#dc2626", 높음: "#ea580c", 중간: "#ca8a04", 주의: "#2563eb", 낮음: "#64748b" };
  els["risk-bars"].innerHTML =
    `<p class="hint-inline" style="margin-bottom:6px">보안 탐지 항목의 위험도 분포</p>` +
    UI.RISK_LEVELS.map((lv) => {
      const n = counts[lv] || 0;
      return `<div class="risk-row"><span class="risk-name">${lv}</span>
        <span class="risk-track"><span class="risk-fill" style="width:${(n / max) * 100}%;background:${
        colors[lv]
      }"></span></span>
        <span class="risk-num">${n.toLocaleString()}종</span></div>`;
    }).join("");
}

/* --------------------------------------------------------------------------
 * 렌더링: 단어 빈도
 * ------------------------------------------------------------------------ */
function renderWords() {
  const r = state.result;
  if (!r) {
    els["words-table"].innerHTML = `<p class="empty-note">분석 결과가 없습니다.</p>`;
    els["words-info"].textContent = "";
    return;
  }
  const q = (els["words-search"].value || "").trim().toLowerCase();
  const sort = els["words-sort"].value;
  const minFreq = Number(els["opt-minfreq"].value) || 1;

  let rows = r.words.filter((w) => w.빈도 >= minFreq);
  if (q) rows = rows.filter((w) => String(w.단어).toLowerCase().includes(q));
  if (sort === "freq") rows.sort((a, b) => b.빈도 - a.빈도 || String(a.단어).localeCompare(String(b.단어)));
  else if (sort === "row") rows.sort((a, b) => b.행수 - a.행수 || b.빈도 - a.빈도);
  else rows.sort((a, b) => String(a.단어).localeCompare(String(b.단어), "ko"));

  els["words-info"].textContent = `${rows.length.toLocaleString()}개 단어`;
  renderTable(els["words-table"], rows, [
    { key: "순위", label: "#", type: "num", width: 50 },
    { key: "단어", label: "단어", width: 160 },
    { key: "빈도", label: "빈도", type: "num", width: 70 },
    { key: "행수", label: "행수", type: "num", width: 70 },
    { key: "포함열", label: "포함 열", type: "clip" },
    { key: "행", label: "행 번호", type: "clip" },
  ]);
}

/* --------------------------------------------------------------------------
 * 렌더링: 보안 분석
 * ------------------------------------------------------------------------ */
function renderSecurity() {
  const r = state.result;
  if (!r) {
    els["security-table"].innerHTML = `<p class="empty-note">분석 결과가 없습니다.</p>`;
    els["security-info"].textContent = "";
    return;
  }
  const q = (els["security-search"].value || "").trim().toLowerCase();
  const riskSel = Number(els["security-risk"].value) || 0;
  let rows = r.security || [];
  if (q) {
    rows = rows.filter(
      (x) =>
        String(x["단어/패턴"]).toLowerCase().includes(q) ||
        String(x.분류).toLowerCase().includes(q)
    );
  }
  if (riskSel) rows = rows.filter((x) => (RISK[x.위험도] || 0) === riskSel);

  els["security-info"].textContent = `${rows.length.toLocaleString()}개 항목`;
  renderTable(
    els["security-table"],
    rows,
    [
      { key: "단어/패턴", label: "단어/패턴", width: 150 },
      { key: "분류", label: "분류", width: 90 },
      { key: "위험도", label: "위험도", type: "risk", width: 80 },
      { key: "빈도", label: "빈도", type: "num", width: 70 },
      { key: "행수", label: "행수", type: "num", width: 70 },
      { key: "포함열", label: "포함 열", type: "clip" },
      { key: "행", label: "행 번호", type: "clip" },
    ],
    {
      rowClass: (row) => {
        const lv = RISK[row.위험도] || 0;
        return lv >= 4 ? `row-risk-${lv}` : lv === 3 ? "row-risk-3" : "";
      },
    }
  );
}

/* --------------------------------------------------------------------------
 * 렌더링: 상세 findings
 * ------------------------------------------------------------------------ */
function renderFindings() {
  const r = state.result;
  if (!r) {
    els["findings-table"].innerHTML = `<p class="empty-note">분석 결과가 없습니다.</p>`;
    els["findings-info"].textContent = "";
    return;
  }
  const q = (els["findings-search"].value || "").trim().toLowerCase();
  const method = els["findings-method"].value;
  const mask = els["findings-mask"].checked;

  let rows = r.findings || [];
  if (q) {
    rows = rows.filter(
      (f) =>
        String(f.원문).toLowerCase().includes(q) ||
        String(f.탐지항목).toLowerCase().includes(q)
    );
  }
  if (method) rows = rows.filter((f) => f.탐지방식 === method);

  els["findings-info"].textContent = `${rows.length.toLocaleString()}건`;
  const view = rows.slice(0, 3000).map((f) => ({
    ...f,
    원문: mask ? UI.maskText(f.원문) : f.원문,
  }));

  renderTable(
    els["findings-table"],
    view,
    [
      { key: "행", label: "행", type: "num", width: 60 },
      { key: "열", label: "열", width: 110 },
      { key: "탐지방식", label: "방식", width: 70 },
      { key: "탐지항목", label: "탐지 항목", width: 130 },
      { key: "분류", label: "분류", width: 85 },
      { key: "위험도", label: "위험도", type: "risk", width: 78 },
      { key: "발견횟수", label: "횟수", type: "num", width: 55 },
      { key: "원문", label: "원문", type: "clip", width: 260 },
    ],
    {
      maxRows: 3000,
      rowClass: (row) => {
        const lv = RISK[row.위험도] || 0;
        return lv >= 4 ? `row-risk-${lv}` : "";
      },
    }
  );
}

/* --------------------------------------------------------------------------
 * 렌더링: 2차 재분석
 * ------------------------------------------------------------------------ */
function renderReanalysis() {
  const r = state.reResult;
  if (!r) {
    els["re-words-table"].innerHTML = `<p class="empty-note">1차 분석 후 "빈도수 기반 재분석"을 실행하세요.</p>`;
    els["re-phrases-table"].innerHTML = "";
    els["re-info"].textContent = "1차 분석 결과를 기반으로 보안문구 후보를 재분석합니다.";
    return;
  }
  els["re-info"].textContent = `원본 고유단어 ${UI.num(
    r.stats.원본고유단어
  )}개 → 표시 ${UI.num(r.stats.재분석표시단어)}개 / 보안연관행 ${UI.num(r.stats.보안연관행)}개`;

  renderTable(
    els["re-words-table"],
    r.rows,
    [
      { key: "순위", label: "#", type: "num", width: 50 },
      { key: "정규화단어", label: "정규화 단어", width: 150 },
      { key: "빈도", label: "빈도", type: "num", width: 70 },
      { key: "행수", label: "행수", type: "num", width: 70 },
      { key: "보안연관행수", label: "보안연관 행", type: "num", width: 90 },
      { key: "판정", label: "판정", width: 70 },
      { key: "분류", label: "분류", width: 100 },
      { key: "위험도", label: "위험도", type: "risk", width: 78 },
      { key: "포함열", label: "포함 열", type: "clip" },
    ],
    {
      maxRows: 2000,
      rowClass: (row) =>
        row.판정 === "높음" || row.분류 === "보안 키워드"
          ? "row-secure"
          : row.판정 === "관심"
          ? "row-interest"
          : "",
    }
  );

  renderTable(els["re-phrases-table"], r.phrases, [
    { key: "순위", label: "#", type: "num", width: 50 },
    { key: "보안문구 후보", label: "보안문구 후보", width: 260 },
    { key: "빈도", label: "빈도", type: "num", width: 70 },
    { key: "행수", label: "행수", type: "num", width: 70 },
    { key: "근거", label: "근거", type: "clip" },
  ], { emptyText: "보안문구 후보가 없습니다. (문구 최소 빈도를 낮춰보세요)" });
}

async function doReanalysis() {
  if (!state.result) return toast("먼저 1차 분석을 실행하세요.", "err");
  const cols = selectedColumns();
  if (!cols.length) return toast("분석할 열을 선택하세요.", "err");
  els["btn-reanalyze"].disabled = true;
  setStatus("2차 재분석 중…", 0);
  try {
    const r = await runReanalysis({
      rows: state.rows,
      rowNumbers: state.rowNumbers,
      columns: cols,
      dict: dictForEngine(),
      minFreq: Number(els["re-minfreq"].value) || 2,
      minLen: Number(els["re-minlen"].value) || 2,
      phraseMinFreq: Number(els["re-phrasefreq"].value) || 2,
      removeParticles: els["re-particles"].checked,
      excludeTwoDigit: els["re-num"].checked,
      excludeTwoLetter: els["re-eng"].checked,
      onProgress: (p, msg) => setStatus(msg, p),
    });
    state.reResult = r;
    renderReanalysis();
    setStatus("2차 재분석 완료", 100);
  } catch (e) {
    console.error(e);
    toast("재분석 실패: " + e.message, "err", 5000);
    setStatus("재분석 오류", 0);
  } finally {
    els["btn-reanalyze"].disabled = false;
  }
}

/* --------------------------------------------------------------------------
 * 렌더링: 패턴 유형
 * ------------------------------------------------------------------------ */
function renderPatternTypes() {
  const r = state.ptResult;
  if (!r || !r.types) {
    els["ptype-table"].innerHTML = `<p class="empty-note">패턴 유형 분석 결과가 없습니다.</p>`;
    els["ptype-values-table"].innerHTML = "";
    return;
  }
  const autoOn = els["pt-auto"].checked;
  const types = autoOn ? r.types : r.types.filter((t) => t.탐지방식 !== "자동형태");
  state.ptTypesData = types;
  const st = r.stats || {};
  els["pt-info"].textContent =
    `유형 ${UI.num(st.유형수)}개 (자동형태 ${UI.num(st.자동형태유형수)}개)${autoOn ? "" : " · 자동형태 제외됨"} / ` +
    `보관된 서로 다른 값 ${UI.num(st.보관값수)}개`;

  const display = types.map((t) => {
    const o = { ...t };
    delete o._key;
    return o;
  });

  renderTable(
    els["ptype-table"],
    display,
    [
      { key: "유형", label: "유형", width: 150 },
      { key: "분류", label: "분류", width: 90 },
      { key: "위험도", label: "위험도", type: "risk", width: 78 },
      { key: "탐지방식", label: "탐지", width: 80 },
      { key: "고유값수", label: "고유값", type: "num", width: 70 },
      { key: "총출현", label: "총출현", type: "num", width: 70 },
      { key: "행수", label: "행수", type: "num", width: 65 },
      { key: "대표값", label: "대표값", type: "clip" },
    ],
    {
      maxRows: 2000,
      rowClass: (row) => {
        const lv = RISK[row.위험도] || 0;
        return lv >= 4 ? `row-risk-${lv}` : lv === 3 ? "row-risk-3" : "";
      },
      onRowClick: (row, idx) => showPtVariants(types[idx]),
    }
  );

  if (types.length) showPtVariants(types[0]);
}

function showPtVariants(type) {
  if (!type || !state.ptResult) return;
  const variants = state.ptResult.variants[type._key] || [];
  renderTable(
    els["ptype-values-table"],
    variants,
    [
      { key: "값", label: "값", type: "clip", width: 220 },
      { key: "빈도", label: "빈도", type: "num", width: 65 },
      { key: "행수", label: "행수", type: "num", width: 65 },
    ],
    { maxRows: 1000, emptyText: "이 유형의 변형 값이 없습니다." }
  );
}

async function doPatternTypes() {
  if (!state.result) return toast("먼저 1차 분석을 실행하세요.", "err");
  const cols = selectedColumns();
  els["btn-ptype"].disabled = true;
  setStatus("패턴 유형 분석 중…", 0);
  try {
    const r = await analyzePatternTypes({
      rows: state.rows,
      rowNumbers: state.rowNumbers,
      columns: cols,
      dict: dictForEngine(),
      minCount: Number(els["pt-mincount"].value) || 2,
      minValues: Number(els["pt-minvalues"].value) || 1,
      maxVariants: Number(els["pt-maxvariants"].value) || 200,
      onProgress: (p, msg) => setStatus(msg, p),
    });
    state.ptResult = r;
    renderPatternTypes();
    setStatus("패턴 유형 분석 완료", 100);
  } catch (e) {
    console.error(e);
    toast("패턴 유형 분석 실패: " + e.message, "err", 5000);
    setStatus("패턴 유형 오류", 0);
  } finally {
    els["btn-ptype"].disabled = false;
  }
}

/* --------------------------------------------------------------------------
 * 내보내기
 * ------------------------------------------------------------------------ */
function baseName() {
  const n = state.fileName ? state.fileName.replace(/\.[^.]+$/, "") : "analysis";
  const stamp = new Date().toISOString().slice(0, 10);
  return `${n}_Security_Analysis_${stamp}`;
}

async function doExportExcel() {
  if (!state.result) return toast("분석 결과가 없습니다.", "err");
  const sheets = buildExportSheets(
    {
      result: state.result,
      reResult: state.reResult,
      ptResult: state.ptResult,
      summaryMeta: {},
    },
    dictForEngine()
  );
  /* 사전 시트는 화면 순서(값/분류/위험도) 유지 */
  const fixed = sheets.map((s) => {
    if (s.name === "Pattern_Dictionary" || s.name === "Pattern_Type_Dictionary") {
      return { ...s, rows: s.rows };
    }
    return s;
  });
  await exportExcel(fixed, baseName() + ".xlsx");
}

function doExportCSV() {
  if (!state.result) return toast("분석 결과가 없습니다.", "err");
  const r = state.result;
  exportCSVFile(
    r.words,
    [
      { key: "순위", label: "순위" },
      { key: "단어", label: "단어" },
      { key: "빈도", label: "빈도" },
      { key: "행수", label: "행수" },
      { key: "포함열", label: "포함열" },
      { key: "행", label: "행" },
    ],
    baseName() + "_Word_Frequency.csv"
  );
}

async function doSaveDbNow() {
  if (!state.result) return;
  if (!state.store.dbReady) return toast("DB가 준비되지 않았습니다.", "err");
  try {
    await persistRun(state.result, true);
    toast("DB에 저장했습니다.", "ok");
    const s = state.store.settings;
    if (s.keep_history === "1") loadHistory();
  } catch (e) {
    toast("DB 저장 실패: " + e.message, "err", 5000);
  }
}

/* --------------------------------------------------------------------------
 * 이력
 * ------------------------------------------------------------------------ */
async function loadHistory() {
  try {
    const items = await state.store.loadHistory();
    els["history-info"].textContent = `${items.length.toLocaleString()}건 (${state.store.mode === "db" ? "D1" : "브라우저"})`;
    renderTable(
      els["history-table"],
      items,
      [
        { key: "created_at", label: "시각", type: "html", width: 130 },
        { key: "file_name", label: "파일", type: "clip", width: 200 },
        { key: "sheet", label: "시트", width: 100 },
        { key: "row_count", label: "행수", type: "num", width: 70 },
        { key: "label", label: "메모", type: "clip" },
        { key: "storage_mode", label: "모드", width: 60 },
      ].map((c) => (c.key === "created_at" ? { ...c, type: "text" } : c)).map((c) => c),
      {
        maxRows: 500,
        emptyText: "저장된 이력이 없습니다.",
        onRowClick: (row) => showHistoryDetail(row.id),
      }
    );
    /* 시각 포맷팅 */
    const trs = els["history-table"].querySelectorAll("tbody tr");
    trs.forEach((tr, i) => {
      const td = tr.children[0];
      if (td) td.textContent = fmtDate(items[i]?.created_at);
    });
  } catch (e) {
    els["history-info"].textContent = "이력 조회 실패";
    els["history-table"].innerHTML = `<p class="empty-note">${escapeHtml(e.message)}</p>`;
  }
}

async function showHistoryDetail(id) {
  try {
    const d = await state.store.loadHistoryDetail(id);
    const run = d.run || {};
    const s = run.summary || (run.summary_json ? JSON.parse(run.summary_json) : {}) || {};
    const payloads = (d.results || []).filter((x) => x.payload);
    let html = `<div class="hd-head">📄 ${escapeHtml(run.file_name || "")} · ${escapeHtml(
      run.sheet || ""
    )} · ${fmtDate(run.created_at || run.createdAt || "")}</div>`;
    html += `<div class="cards">${Object.entries(s)
      .slice(0, 8)
      .map(
        ([k, v]) =>
          `<div class="card"><div class="card-label">${escapeHtml(k)}</div><div class="card-value" style="font-size:16px">${escapeHtml(
            v
          )}</div></div>`
      )
      .join("")}</div>`;
    if (payloads.length) {
      html += `<p class="hint-inline">저장된 결과 표 ${payloads.length}종 — 아래 버튼으로 내려받을 수 있습니다.</p>`;
      html += `<div class="action-row mt-sm">` +
        payloads
          .map(
            (p) =>
              `<button class="btn btn-mini" data-dl-kind="${escapeHtml(p.kind)}" data-run="${escapeHtml(
                String(id)
              )}">⬇ ${escapeHtml(p.kind)} CSV</button>`
          )
          .join("") +
        `</div>`;
    } else {
      html += `<p class="hint-inline">이 이력은 요약만 저장되었습니다. (DB 설정에서 "결과 표까지 저장"을 켜면 표도 보관됩니다)</p>`;
    }
    els["history-detail"].innerHTML = html;

    els["history-detail"].querySelectorAll("[data-dl-kind]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const kind = btn.dataset.dlKind;
        const detail = await state.store.loadHistoryDetail(btn.dataset.run);
        const target = (detail.results || []).find((x) => x.kind === kind);
        const payload = target?.payload;
        if (!payload) return toast("데이터가 없습니다.", "err");
        const list = Array.isArray(payload) ? payload : payload.types || [];
        if (!list.length) return toast("데이터가 없습니다.", "err");
        const cols = Object.keys(list[0]).map((k) => ({ key: k, label: k }));
        exportCSVFile(list, cols, `history_${id}_${kind}.csv`);
      });
    });
  } catch (e) {
    els["history-detail"].innerHTML = `<p class="empty-note">${escapeHtml(e.message)}</p>`;
  }
}

/* --------------------------------------------------------------------------
 * 탭 전환
 * ------------------------------------------------------------------------ */
function initTabs() {
  $$("#tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$("#tabs .tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      $$(".tab-pane").forEach((p) => p.classList.remove("active"));
      const pane = document.querySelector(`.tab-pane[data-pane="${tab.dataset.tab}"]`);
      if (pane) pane.classList.add("active");
      if (tab.dataset.tab === "history") loadHistory();
    });
  });
}

/* --------------------------------------------------------------------------
 * 이벤트 바인딩
 * ------------------------------------------------------------------------ */
function bindEvents() {
  /* 파일 */
  els["dropzone"].addEventListener("click", () => els["file-input"].click());
  els["file-input"].addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) handleFile(f);
    e.target.value = "";
  });
  ["dragenter", "dragover"].forEach((ev) =>
    els["dropzone"].addEventListener(ev, (e) => {
      e.preventDefault();
      els["dropzone"].classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    els["dropzone"].addEventListener(ev, (e) => {
      e.preventDefault();
      els["dropzone"].classList.remove("dragover");
    })
  );
  els["dropzone"].addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });

  els["sheet-select"].addEventListener("change", (e) => {
    resetResults();
    activateSheet(e.target.value);
  });

  els["filter-col"].addEventListener("change", applyFilter);
  const debFilter = UI.debounce(applyFilter, 300);
  els["filter-value"].addEventListener("input", debFilter);

  /* 컬럼 */
  els["column-list"].addEventListener("change", updateColCount);
  $("#btn-col-all").addEventListener("click", () => {
    $$("#column-list input[type=checkbox]").forEach((c) => (c.checked = true));
    updateColCount();
  });
  $("#btn-col-none").addEventListener("click", () => {
    $$("#column-list input[type=checkbox]").forEach((c) => (c.checked = false));
    updateColCount();
  });
  const debColSearch = UI.debounce(() => {
    const q = (els["col-search"].value || "").trim().toLowerCase();
    $$("#column-list .col-item").forEach((lab) => {
      const name = lab.querySelector("span").textContent.toLowerCase();
      lab.style.display = !q || name.includes(q) ? "" : "none";
    });
  }, 200);
  els["col-search"].addEventListener("input", debColSearch);

  /* 분석 / 저장 */
  els["btn-analyze"].addEventListener("click", runAnalysis);
  els["btn-export"].addEventListener("click", doExportExcel);
  els["btn-export-csv"].addEventListener("click", doExportCSV);
  els["btn-save-db"].addEventListener("click", doSaveDbNow);
  els["btn-reanalyze"].addEventListener("click", doReanalysis);
  els["btn-ptype"].addEventListener("click", doPatternTypes);
  els["pt-auto"].addEventListener("change", renderPatternTypes);

  /* 검색/정렬 */
  els["words-search"].addEventListener("input", UI.debounce(renderWords, 200));
  els["words-sort"].addEventListener("change", renderWords);
  els["security-search"].addEventListener("input", UI.debounce(renderSecurity, 200));
  els["security-risk"].addEventListener("change", renderSecurity);
  els["findings-search"].addEventListener("input", UI.debounce(renderFindings, 250));
  els["findings-method"].addEventListener("change", renderFindings);
  els["findings-mask"].addEventListener("change", renderFindings);

  $("#btn-words-csv").addEventListener("click", () => {
    if (!state.result) return;
    exportCSVFile(
      state.result.words,
      [
        { key: "순위", label: "순위" },
        { key: "단어", label: "단어" },
        { key: "빈도", label: "빈도" },
        { key: "행수", label: "행수" },
        { key: "포함열", label: "포함열" },
        { key: "행", label: "행" },
      ],
      "Word_Frequency.csv"
    );
  });
  $("#btn-security-csv").addEventListener("click", () => {
    if (!state.result) return;
    exportCSVFile(
      state.result.security,
      [
        { key: "단어/패턴", label: "단어/패턴" },
        { key: "분류", label: "분류" },
        { key: "위험도", label: "위험도" },
        { key: "빈도", label: "빈도" },
        { key: "행수", label: "행수" },
        { key: "포함열", label: "포함열" },
        { key: "행", label: "행" },
      ],
      "Security_Analysis.csv"
    );
  });
  $("#btn-findings-csv").addEventListener("click", () => {
    if (!state.result) return;
    exportCSVFile(
      state.result.findings,
      [
        { key: "Sheet", label: "Sheet" },
        { key: "행", label: "행" },
        { key: "열", label: "열" },
        { key: "탐지방식", label: "탐지방식" },
        { key: "탐지항목", label: "탐지항목" },
        { key: "분류", label: "분류" },
        { key: "위험도", label: "위험도" },
        { key: "발견횟수", label: "발견횟수" },
        { key: "원문", label: "원문" },
      ],
      "Findings.csv"
    );
  });

  /* 저장 모드 */
  $$('input[name="storage-mode"]').forEach((r) => {
    r.addEventListener("change", async () => {
      const mode = storageMode();
      syncPersistWrap();
      if (mode === "db" && !state.store.dbReady) {
        toast("DB가 준비되지 않아 로컬 모드를 유지합니다. DB 설정을 확인하세요.", "err", 4200);
        const local = document.querySelector('input[name="storage-mode"][value="local"]');
        if (local) local.checked = true;
        return;
      }
      await state.store.saveSettings({ storage_mode: mode });
      /* 저장소 라우팅(this.mode)을 반드시 함께 갱신해야
         이후 분석 이력이 올바른 저장소(로컬/DB)로 들어간다. */
      state.store.mode = mode;
      toast(mode === "db" ? "DB 저장 모드로 전환했습니다." : "로컬 모드로 전환했습니다.", "ok");
      els["btn-save-db"].disabled = !(state.store.dbReady && state.result);
      updateDbBadge();
      if (mode === "db") loadHistory();
    });
  });
  els["opt-persist"].addEventListener("change", async () => {
    await state.store.saveSettings({ persist_results: els["opt-persist"].checked ? "1" : "0" });
    toast("결과 보관 설정을 저장했습니다.", "ok");
  });

  /* 이력 */
  $("#btn-history-refresh").addEventListener("click", loadHistory);
  $("#btn-history-clear").addEventListener("click", async () => {
    if (!confirm("저장된 분석 이력을 모두 삭제할까요?")) return;
    await state.store.clearHistory();
    els["history-detail"].innerHTML = "";
    loadHistory();
    toast("이력을 삭제했습니다.", "ok");
  });

  /* 모달 열기 */
  $("#btn-dict").addEventListener("click", () => initDictUI.open(state));
  $("#btn-dbsettings").addEventListener("click", () => initDbUI.open(state));
  $("#btn-help").addEventListener("click", () => UI.openModal("help-modal"));
}

function syncPersistWrap() {
  const db = storageMode() === "db";
  els["persist-wrap"].classList.toggle("disabled", !db);
  els["opt-persist"].checked = db && state.store?.settings?.persist_results === "1";
}

function updateDbBadge() {
  const el = els["db-status"];
  const t = els["db-status-text"];
  if (!el) return;
  const h = state.store.healthInfo || {};
  if (!h.dbBound) {
    el.className = "status-chip status-off";
    t.textContent = "DB 미연결 · 로컬";
  } else if (h.dbOk && h.schemaOk) {
    el.className = "status-chip status-ok";
    t.textContent = `DB 연결됨 · ${state.store.mode === "db" ? "저장 사용" : "로컬 모드"}`;
  } else if (h.dbOk) {
    el.className = "status-chip status-warn";
    t.textContent = "DB 연결됨 · 스키마 필요";
  } else {
    el.className = "status-chip status-off";
    t.textContent = "DB 오류";
  }
}

/* --------------------------------------------------------------------------
 * 부트
 * ------------------------------------------------------------------------ */
async function boot() {
  cacheEls();
  UI.bindModals();
  initTabs();
  bindEvents();

  const store = new Store();
  await store.init();
  state.store = store;

  /* 사전 로드 */
  try {
    state.dict = await store.loadDictionary();
  } catch (e) {
    console.warn("사전 로드 실패", e);
  }

  /* 저장 모드 UI 반영 */
  const mode = store.mode;
  const radio = document.querySelector(`input[name="storage-mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  els["opt-persist"].checked = store.settings.persist_results === "1";
  syncPersistWrap();
  updateDbBadge();

  /* 기본 옵션 */
  if (store.settings.default_min_len) els["opt-minlen"].value = store.settings.default_min_len;
  els["opt-space"].checked = store.settings.default_allow_space !== "0";

  initDictUI.init(state, { onChange: () => {} });
  initDbUI.init(state, {
    onStorageModeChange: (m) => {
      const r = document.querySelector(`input[name="storage-mode"][value="${m}"]`);
      if (r) r.checked = true;
      syncPersistWrap();
      updateDbBadge();
    },
    onRefresh: () => {
      updateDbBadge();
      els["btn-save-db"].disabled = !(store.dbReady && state.result);
    },
  });

  renderSummary();
  renderWords();
  renderSecurity();
  renderFindings();
  renderReanalysis();
  renderPatternTypes();
  setStatus("대기 중", 0);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
