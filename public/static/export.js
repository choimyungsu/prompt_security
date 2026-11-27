/* ==========================================================================
 * export.js — Excel(다중 시트) / CSV 내보내기
 *  원본 main.py 의 save_excel 과 동일한 12개 시트 구성을 재현한다.
 * ========================================================================== */
import { downloadBlob, downloadCSV, toast } from "./ui.js";

const XLSX_CDN = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

/** SheetJS 를 필요할 때만 로드 (초기 로딩 속도 유지) */
let xlsxPromise = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = XLSX_CDN;
    s.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error("XLSX 로드 실패")));
    s.onerror = () => reject(new Error("Excel 라이브러리를 불러오지 못했습니다. 네트워크를 확인하세요."));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

/* Excel 셀 제약: 32,767자 / 시트명 31자 / 금지문자 []:*?/\ */
const EXCEL_CELL_LIMIT = 32767;

function safeSheetName(name, used) {
  let base = String(name).replace(/[[\]:*?/\\]/g, "_").slice(0, 31) || "Sheet";
  let out = base;
  let n = 2;
  while (used.has(out)) {
    const suffix = `_${n}`;
    out = base.slice(0, 31 - suffix.length) + suffix;
    n++;
  }
  used.add(out);
  return out;
}

/** 문자열 셀이 32,767자를 넘으면 `_2`, `_3` 열로 분할한다(내용 손실 없음). */
function splitLongColumns(rows) {
  if (!rows.length) return { rows: [], columns: [] };
  const keys = Object.keys(rows[0]);
  const parts = keys.map((k) => {
    let max = 1;
    for (const r of rows) {
      const v = r[k];
      if (typeof v === "string" && v.length > EXCEL_CELL_LIMIT) {
        max = Math.max(max, Math.ceil(v.length / EXCEL_CELL_LIMIT));
      }
    }
    return max;
  });
  if (parts.every((p) => p === 1)) return { rows, columns: keys };
  const columns = [];
  keys.forEach((k, i) => {
    columns.push(k);
    for (let j = 1; j < parts[i]; j++) columns.push(`${k.slice(0, 250)}_${j + 1}`);
  });
  const outRows = rows.map((r) => {
    const o = {};
    keys.forEach((k, i) => {
      const v = r[k];
      if (parts[i] === 1) {
        o[k] = v;
        return;
      }
      const s = typeof v === "string" ? v : v == null ? "" : String(v);
      for (let j = 0; j < parts[i]; j++) {
        o[j === 0 ? k : `${k.slice(0, 250)}_${j + 1}`] = s.slice(
          j * EXCEL_CELL_LIMIT,
          (j + 1) * EXCEL_CELL_LIMIT
        );
      }
    });
    return o;
  });
  return { rows: outRows, columns };
}

/** XML/Excel 이 거부하는 제어문자 제거 */
function scrub(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  let s = String(v);
  /* eslint-disable-next-line no-control-regex */
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/.test(s)) {
    /* eslint-disable-next-line no-control-regex */
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g, "");
  }
  return s;
}

function rowsToAOA(sheets) {
  /* 시트별로 독립 처리하므로 시트마다 헤더 산출.
     주의: 빈 배열도 truthy 이므로 반드시 길이로 판정해야 한다.
     (그렇지 않으면 데이터가 없는 시트에서 헤더가 사라진다) */
  return sheets.map((s) => {
    let cols = Array.isArray(s.columns) && s.columns.length ? s.columns : null;
    if (!cols && s.rows.length) cols = Object.keys(s.rows[0]);
    if (!cols || !cols.length) cols = ["결과"];
    const body = s.rows.length
      ? s.rows.map((r) => cols.map((c) => scrub(r[c])))
      : [["데이터 없음"]];
    return { name: s.name, aoa: [cols.slice(), ...body] };
  });
}

/**
 * 시트 배열 → xlsx 바이트. DOM 없이도 동작하므로 단위 테스트가 가능하다.
 * @param {any} XLSX SheetJS 모듈
 * @param {Array<{name:string, rows:Array<object>}>} sheets
 * @returns {Uint8Array}
 */
export function buildWorkbook(XLSX, sheets) {
  const wb = XLSX.utils.book_new();
  const used = new Set();
  for (const s of sheets) {
    const { rows, columns } = splitLongColumns(s.rows || []);
    const prepared = { ...s, rows, columns };
    const [{ aoa }] = rowsToAOA([prepared]);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    /* 열 너비 자동(앞 200행 기준) */
    ws["!cols"] = (columns.length ? columns : ["결과"]).map((c, ci) => {
      let w = String(c).length;
      for (let r = 0; r < Math.min(rows.length, 200); r++) {
        const v = rows[r][c];
        w = Math.max(w, String(v ?? "").length);
      }
      return { wch: Math.min(Math.max(w + 2, 10), 60) };
    });
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(s.name, used));
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

export async function exportExcel(sheets, filename) {
  try {
    const XLSX = await loadXLSX();
    const out = buildWorkbook(XLSX, sheets);
    downloadBlob(
      new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      filename
    );
    toast("Excel 저장 완료 (" + sheets.length + "개 시트)", "ok");
  } catch (e) {
    toast("Excel 저장 실패: " + e.message, "err", 4000);
  }
}

export function exportCSVFile(rows, columns, filename) {
  if (!rows || !rows.length) {
    toast("내보낼 데이터가 없습니다.", "err");
    return;
  }
  downloadCSV(rows, columns, filename);
  toast("CSV 저장 완료", "ok");
}

export { splitLongColumns, scrub };
