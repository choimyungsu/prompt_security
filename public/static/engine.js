/* ==========================================================================
 * Security Word Analyzer - Analysis Engine (Web Edition)
 * --------------------------------------------------------------------------
 * 원본 데스크톱 앱(main.py v1.2.0)의 분석 로직을 브라우저에서 그대로 재현한다.
 *
 *  - 1차 분석      : 단어 빈도 + 보안 키워드/정규식 탐지 + 패턴 유형 집계
 *  - 2차 재분석    : 조사/어미 제거 후 단어 통합 + 보안문구(n-gram) 후보 추출
 *  - 패턴 유형 분석: 값은 달라도 형식이 같은 값들을 유형별로 묶어서 집계
 *
 * 민감 데이터(개인정보 포함 가능)를 서버로 보내지 않기 위해 모든 분석은
 * 브라우저 안에서 수행한다. 서버(D1)는 사전/설정/이력만 보관한다.
 * ========================================================================== */

export const APP_VERSION = "2.0.0";

export const RISK = { "매우 높음": 5, "높음": 4, "중간": 3, "주의": 2, "낮음": 1 };

/* 주의: 원본과 동일하게 '숫자 2자리 이상', '한글 2자 이상', '영문 2자 이상' 토큰을 뽑는다. */
const TOKEN_RE = /[가-힣]{2,}|[A-Za-z][A-Za-z0-9_.+#/@:-]{1,}|(?<!\d)\d{2,}(?!\d)/g;

/* 패턴 유형 후보 토큰: 코드형 값만 대상 */
const TYPE_TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9._:/@+\-]{2,}/g;
const TYPE_TRIM_CHARS = "._:/@+-";
const TYPE_SPLIT_RE = /[A-Z]+|[a-z]+|\d+|[^A-Za-z0-9]/g;
const TYPE_SHAPE_RE = /([Aad])\{(\d+)(\+?)\}/y;

/* 조사/어미(원본 KOREAN_PARTICLES / KOREAN_ENDINGS) */
export const KOREAN_PARTICLES = [...new Set([
  "으로부터", "로부터", "에서부터", "까지는", "까지도", "에서는", "에게서", "한테서",
  "으로는", "로는", "으로도", "로도", "으로서", "로서", "으로써", "로써", "이라면", "라면",
  "이라고", "라고", "이라서", "라서", "이라도", "라도", "이란", "란", "에는", "에서", "에게",
  "한테", "께서", "께", "보다", "처럼", "만큼", "마저", "조차", "부터", "까지", "마다",
  "으로", "로", "와", "과", "의", "에", "이", "가", "은", "는", "을", "를", "도", "만", "뿐",
  "이나", "나", "든지", "든", "이며", "며", "이고", "고", "이랑", "랑", "하고", "서",
])].sort((a, b) => b.length - a.length);

export const KOREAN_ENDINGS = [...new Set([
  "했습니다", "하였다", "한다", "하는", "하며", "했고", "하여", "해서", "해진", "해지는",
  "되는", "되어", "됐다", "되었다", "이었다", "였다", "이다", "인", "일", "할", "한", "함",
  "하기", "하며", "하게", "하도록", "해서는",
])].sort((a, b) => b.length - a.length);

/* -------------------------------------------------------------------------- */
/* 텍스트 유틸                                                                  */
/* -------------------------------------------------------------------------- */
export function cleanText(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.replace(/\s+/g, " ").trim();
}

export function compact(v, allowSpace) {
  const s = cleanText(v).toLowerCase();
  return allowSpace ? s : s.replace(/\s+/g, "");
}

export function tokens(text, minLen, stopwords) {
  const out = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const t = m[0];
    if (t.length < minLen) continue;
    if (stopwords.has(t) || stopwords.has(t.toLowerCase())) continue;
    out.push(t);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 보안 키워드 / 정규식 탐지                                                    */
/* -------------------------------------------------------------------------- */
export function compilePatterns(list) {
  const out = [];
  for (const row of list || []) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const name = String(row[0] ?? "").trim();
    const pattern = String(row[1] ?? "").trim();
    if (!name || !pattern) continue;
    try {
      out.push({
        name, pattern, category: String(row[2] ?? "").trim(),
        risk: String(row[3] ?? "").trim(),
        rx: new RegExp(pattern, "gi"),
        rxFull: new RegExp("^(?:" + pattern + ")$", "i"),
      });
    } catch (_e) { /* 잘못된 정규식은 조용히 건너뛴다(원본과 동일) */ }
  }
  return out;
}

/* Python re.findall 와 동일하게 '매치 개수'를 센다. */
export function countMatches(rx, text) {
  try {
    rx.lastIndex = 0;
    let n = 0;
    while (rx.exec(text) !== null) {
      n++;
      if (rx.lastIndex === 0) break; /* 빈 매치 무한루프 방지 */
    }
    return n;
  } catch (_e) { return 0; }
}

/**
 * 한 셀에서 보안 키워드/패턴을 찾는다.
 * @returns {Array<{method:string, matched:string, category:string, risk:string, count:number}>}
 */
export function securityFindings(text, opts) {
  const { securityWords, patterns, allowSpace } = opts;
  const raw = cleanText(text);
  const c = compact(raw, allowSpace);
  const out = [];
  for (const [word, category, risk] of securityWords || []) {
    const w = compact(word, allowSpace);
    if (!w) continue;
    let n = 0;
    let idx = c.indexOf(w);
    while (idx !== -1) { n++; idx = c.indexOf(w, idx + w.length); }
    if (n) out.push({ method: "키워드", matched: word, category, risk, count: n });
  }
  for (const p of patterns || []) {
    const n = countMatches(p.rx, raw);
    if (n) out.push({ method: "패턴", matched: p.name, category: p.category, risk: p.risk, count: n });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* 패턴 유형(형식) 분석                                                        */
/* -------------------------------------------------------------------------- */
function stripLabelPrefix(tok) {
  if (tok.includes("//")) return tok;
  for (;;) {
    const pos = tok.indexOf(":");
    if (pos < 0) return tok;
    const left = tok.slice(0, pos);
    const right = tok.slice(pos + 1);
    if (left && right && left.length <= 8 && /^[A-Za-z가-힣]+$/.test(left) && /\d/.test(right)) {
      tok = right;
    } else {
      return tok;
    }
  }
}

export function matchPatternType(tok, typePatterns, cache) {
  const hit = cache.get(tok);
  if (hit !== undefined) return hit;
  let result = null;
  for (const tp of typePatterns) {
    try {
      if (tp.rxFull.test(tok)) {
        result = { 유형: tp.name, 패턴: tp.pattern, 분류: tp.category, 위험도: tp.risk };
        break;
      }
    } catch (_e) { /* noop */ }
  }
  if (cache.size < 200000) cache.set(tok, result);
  return result;
}

export function typeTokens(text, typePatterns, cache) {
  const out = [];
  TYPE_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TYPE_TOKEN_RE.exec(String(text))) !== null) {
    let tok = m[0].replace(/^[._:/@+-]+/, "").replace(/[._:/@+\-]+$/, "");
    tok = stripLabelPrefix(tok).replace(/^[._:/@+-]+/, "").replace(/[._:/@+\-]+$/, "");
    if (tok.length < 4) continue;
    if (tok.length > 200) tok = tok.slice(0, 200);
    if (matchPatternType(tok, typePatterns, cache)) { out.push(tok); continue; }
    let digits = 0, seps = 0;
    for (const ch of tok) {
      if (/\d/.test(ch)) digits++;
      else if ("-_./:@".includes(ch)) seps++;
    }
    if (digits < 2 && !(digits >= 1 && seps >= 1)) continue;
    if (digits === tok.length && tok.length < 6) continue;
    out.push(tok);
  }
  return out;
}

export function coarseShape(tok) {
  const s = String(tok);
  const pureNumber = /^\d+$/.test(s);
  const parts = [];
  TYPE_SPLIT_RE.lastIndex = 0;
  let m;
  while ((m = TYPE_SPLIT_RE.exec(s)) !== null) {
    const seg = m[0];
    if (/^\d+$/.test(seg)) parts.push(pureNumber || seg.length < 3 ? `d{${seg.length}}` : "d{3+}");
    else if (seg === seg.toUpperCase() && /[A-Z]/.test(seg)) parts.push(`A{${seg.length}}`);
    else if (seg === seg.toLowerCase() && /[a-z]/.test(seg)) parts.push(`a{${seg.length}}`);
    else parts.push(seg);
  }
  return parts.join("");
}

export function shapeToRegex(shape) {
  let out = "";
  let i = 0;
  while (i < shape.length) {
    TYPE_SHAPE_RE.lastIndex = i;
    const m = TYPE_SHAPE_RE.exec(shape);
    if (m && m.index === i) {
      const base = { A: "[A-Z]", a: "[a-z]", d: "\\d" }[m[1]];
      out += `${base}{${m[2]}${m[3] ? "," : ""}}`;
      i = TYPE_SHAPE_RE.lastIndex;
    } else {
      const ch = shape[i];
      out += /[A-Za-z0-9]/.test(ch) ? ch : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return out;
}

export function guessShapeMeta(tok) {
  if (tok.includes("@")) return ["개인정보", "중간"];
  if (/^(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?$/.test(tok)) return ["인프라", "높음"];
  let digits = 0;
  for (const ch of tok) if (/\d/.test(ch)) digits++;
  if (digits >= 6) return ["식별번호", "중간"];
  if (digits >= 4 && /[._/:]/.test(tok)) return ["식별번호", "중간"];
  return ["일반정보", "낮음"];
}

export class PatternTypeIndex {
  constructor() {
    this.groups = new Map();
    /* 값·행·열을 더 이상 잘라내지 않는다.
       (예전에는 유형당 값 1000개 / 값당 행 500개 / 값당 열 200개에서 잘려
        고유값·행수·포함열이 실제보다 작게 집계되었다) */
  }
  _group(key, name, cat, risk, source, pattern) {
    let g = this.groups.get(key);
    if (!g) {
      g = {
        key, 유형: name, 분류: cat, 위험도: risk, 탐지방식: source, 패턴: pattern,
        총출현: 0, rows: new Set(), cols: new Set(),
        values: new Map(), valueRows: new Map(), valueCols: new Map(), overflow: 0,
      };
      this.groups.set(key, g);
    }
    return g;
  }
  add(tok, rownum, col, typePatterns, cache) {
    const info = matchPatternType(tok, typePatterns, cache);
    let g;
    if (info) {
      g = this._group("T:" + info.유형, info.유형, info.분류, info.위험도, "사전패턴", info.패턴);
    } else {
      const shape = coarseShape(tok);
      const [cat, risk] = guessShapeMeta(tok);
      g = this._group("S:" + shape, "자동형태 " + shape, cat, risk, "자동형태", shapeToRegex(shape));
    }
    g.총출현++;
    g.rows.add(rownum);
    g.cols.add(String(col));
    g.values.set(tok, (g.values.get(tok) || 0) + 1);
    let rs = g.valueRows.get(tok);
    if (!rs) { rs = new Set(); g.valueRows.set(tok, rs); }
    rs.add(rownum);
    let cs = g.valueCols.get(tok);
    if (!cs) { cs = new Set(); g.valueCols.set(tok, cs); }
    cs.add(String(col));
  }
  /** @param {number} maxVariants 0 이하이면 유형당 모든 변형 값을 반환한다 */
  result(minCount = 2, minValues = 1, maxVariants = 0) {
    const types = [];
    const variants = {};
    const stats = { 유형수: 0, 자동형태유형수: 0, 보관값수: 0, 누락값수: 0, 총일치건수: 0 };
    const limit = Number(maxVariants) > 0 ? Number(maxVariants) : Infinity;
    for (const [key, g] of this.groups) {
      const uniq = g.values.size;
      if (g.총출현 < minCount || uniq < minValues) continue;
      const all = [...g.values.entries()].sort((a, b) => b[1] - a[1]
        || a[0].localeCompare(b[0], "ko"));
      const top = limit === Infinity ? all : all.slice(0, limit);
      const sampleTop = all.slice(0, 3).map((v) => v[0]);
      types.push({
        유형: g.유형, 분류: g.분류, 위험도: g.위험도, 탐지방식: g.탐지방식,
        패턴: g.패턴, 고유값수: uniq, 총출현: g.총출현,
        /* 요약 표에는 정규식 대신 실제 검출된 샘플 값을 노출한다 */
        샘플: sampleTop[0] || "",
        샘플들: sampleTop.join(" | "),
        일치건수: g.총출현,
        행수: g.rows.size, 포함열: [...g.cols].sort().join(", "),
        대표값: sampleTop.join(" | "),
        _key: key,
      });
      variants[key] = top.map(([v, c]) => ({
        유형: g.유형, 사례값: v, 값: v, 빈도: c,
        행수: (g.valueRows.get(v) || new Set()).size,
        포함열: [...(g.valueCols.get(v) || g.cols)].sort().join(", "),
      }));
      stats.유형수++;
      stats.보관값수 += uniq;
      stats.누락값수 += g.overflow;
      stats.총일치건수 += g.총출현;
      if (g.탐지방식 === "자동형태") stats.자동형태유형수++;
    }
    types.sort((a, b) => (RISK[b.위험도] || 0) - (RISK[a.위험도] || 0)
      || b.고유값수 - a.고유값수 || b.총출현 - a.총출현 || a.유형.localeCompare(b.유형));
    return { types, variants, stats };
  }
}

/* -------------------------------------------------------------------------- */
/* 2차 재분석 유틸                                                             */
/* -------------------------------------------------------------------------- */
export function normalizeReanalysisToken(token, removeParticles = true) {
  let t = String(token).trim();
  if (!t) return "";
  if (removeParticles && /^[가-힣]{2,}$/.test(t)) {
    for (let round = 0; round < 2; round++) {
      let changed = false;
      for (const suf of KOREAN_PARTICLES) {
        if (t.endsWith(suf) && t.length - suf.length >= 2) {
          t = t.slice(0, t.length - suf.length);
          changed = true;
          break;
        }
      }
      if (!changed) break;
    }
  }
  return t;
}

export function reanalysisTokenize(text, opts) {
  const { minLen = 2, removeParticles = true, excludeTwoDigit = true, excludeTwoLetter = true, stopwords } = opts;
  const result = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(String(text))) !== null) {
    const t = normalizeReanalysisToken(m[0], removeParticles);
    if (!t) continue;
    if (stopwords.has(t) || stopwords.has(t.toLowerCase())) continue;
    if (t.length < minLen) continue;
    if (excludeTwoDigit && /^\d{2}$/.test(t)) continue;
    if (excludeTwoLetter && /^[A-Za-z]{2}$/.test(t)) continue;
    if (/^\d+$/.test(t)) continue;
    result.push(t);
  }
  return result;
}

export function reanalysisClassify(word, securityWords) {
  const w = compact(word, true);
  for (const [sec, cat, risk] of securityWords || []) {
    if (w && w === compact(sec, true)) return ["보안 키워드", cat, risk];
  }
  if (/^[가-힣]{2,}$/.test(word)) return ["일반 명사/한글", "일반", ""];
  if (/^[A-Za-z][A-Za-z0-9_.+#/@:-]{2,}$/.test(word)) return ["영문 기술용어", "기술", ""];
  return ["기타", "기타", ""];
}

/* -------------------------------------------------------------------------- */
/* 진행률을 UI에 반영하기 위한 양보(yield) 헬퍼                                  */
/* -------------------------------------------------------------------------- */
const tick = () => new Promise((res) => setTimeout(res, 0));

/* -------------------------------------------------------------------------- */
/* 1차 분석                                                                    */
/* -------------------------------------------------------------------------- */
/**
 * @param {object} input
 * @param {Array<object>} input.rows       행 객체 배열(헤더=키)
 * @param {string[]} input.columns         분석 대상 열
 * @param {object} input.dict              {stopwords:Set, securityWords:Array, patterns:Array, patternTypes:Array}
 * @param {boolean} input.allowSpace       띄어쓰기 허용(키워드 매칭 시 공백 유지)
 * @param {number} input.minLen            최소 단어 길이
 * @param {boolean} input.patternTypes     패턴 유형 집계 여부
 * @param {function} [input.onProgress]    (percent, message) => void
 */
export async function analyze(input) {
  const {
    rows, columns, dict, allowSpace = true, minLen = 2,
    patternTypes: doPatternTypes = true, rowNumbers = null, onProgress = () => {},
  } = input;

  const stopwords = dict.stopwords;
  const securityWords = dict.securityWords;
  const patterns = compilePatterns(dict.patterns);
  const typePatterns = compilePatterns([...(dict.patternTypes || []), ...(dict.patterns || [])]);
  const typeCache = new Map();

  const counter = new Map();
  const loc = new Map(); /* token -> {cols:Set, rows:Set} */
  const index = doPatternTypes ? new PatternTypeIndex() : null;
  const findings = [];

  const total = rows.length;
  const step = Math.max(1, Math.floor(total / 60));

  for (let i = 0; i < total; i++) {
    const row = rows[i] || {};
    /* 헤더 포함 실제 파일 행 번호 (필터로 걸러져도 원본 행 번호 유지) */
    const rownum = rowNumbers ? Number(rowNumbers[i]) : i + 2;
    for (const col of columns) {
      const value = row[col];
      const rawText = value === null || value === undefined ? "" : String(value);
      const text = cleanText(rawText);
      if (!text) continue;

      for (const t of tokens(text, minLen, stopwords)) {
        counter.set(t, (counter.get(t) || 0) + 1);
        let L = loc.get(t);
        if (!L) { L = { cols: new Set(), rows: new Set() }; loc.set(t, L); }
        L.cols.add(String(col));
        L.rows.add(rownum);
      }
      if (index) {
        for (const tok of typeTokens(text, typePatterns, typeCache)) {
          index.add(tok, rownum, col, typePatterns, typeCache);
        }
      }
      for (const f of securityFindings(text, { securityWords, patterns, allowSpace })) {
        findings.push({
          Sheet: "", 행: rownum, 열: String(col), 탐지방식: f.method,
          탐지항목: f.matched, 분류: f.category, 위험도: f.risk,
          발견횟수: f.count, 원문: rawText,
        });
      }
    }
    if (i % step === 0) {
      onProgress(Math.round((i / Math.max(1, total)) * 100), `${(i + 1).toLocaleString()} / ${total.toLocaleString()}행`);
      await tick();
    }
  }

  /* 단어 빈도 */
  const words = [...counter.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([w, cnt], i) => {
      const L = loc.get(w);
      return {
        순위: i + 1, 단어: w, 빈도: cnt,
        포함열: [...L.cols].sort().join(", "),
        행수: L.rows.size,
        행: [...L.rows].sort((a, b) => a - b).join(", "),
      };
    });

  /* 보안 탐지 집계 */
  const agg = new Map();
  for (const f of findings) {
    let a = agg.get(f.탐지항목);
    if (!a) { a = { count: 0, rows: new Set(), cols: new Set(), cat: "", risk: "" }; agg.set(f.탐지항목, a); }
    a.count += f.발견횟수; a.rows.add(f.행); a.cols.add(f.열);
    a.cat = f.분류; a.risk = f.위험도;
  }
  const security = [...agg.entries()]
    .sort((x, y) => (RISK[y[1].risk] || 0) - (RISK[x[1].risk] || 0)
      || y[1].count - x[1].count || x[0].localeCompare(y[0]))
    .map(([k, v]) => ({
      "단어/패턴": k, 빈도: v.count, 포함열: [...v.cols].sort().join(", "),
      행수: v.rows.size, 분류: v.cat, 위험도: v.risk,
      행: [...v.rows].sort((a, b) => a - b).join(", "),
    }));

  const highRisk = findings.filter((x) => (RISK[x.위험도] || 0) >= 4).length;
  const summary = {
    전체행수: total,
    분석행수: total,
    분석열수: columns.length,
    고유단어수: counter.size,
    총단어수: [...counter.values()].reduce((a, b) => a + b, 0),
    보안탐지건수: findings.length,
    고위험탐지건수: highRisk,
  };

  let pt = { types: [], variants: {}, stats: { 유형수: 0, 자동형태유형수: 0, 보관값수: 0, 누락값수: 0 } };
  if (index) {
    /* 1차 분석에서는 값을 잘라내지 않고 전부 보관한다 */
    pt = index.result(1, 1, 0);
    summary.패턴유형수 = pt.stats.유형수;
    summary.패턴유형_서로다른값수 = pt.stats.보관값수;
  }

  onProgress(100, "분석 완료");
  return { summary, words, security, findings, pt_types: pt.types, pt_variants: pt.variants, pt_stats: pt.stats };
}

/* -------------------------------------------------------------------------- */
/* 2차 재분석                                                                  */
/* -------------------------------------------------------------------------- */
export async function reanalyze(input) {
  const {
    rows, columns, dict, minFreq = 2, minLen = 2, removeParticles = true,
    excludeTwoDigit = true, excludeTwoLetter = true, phraseMinFreq = 2, rowNumbers = null,
    onProgress = () => {},
  } = input;

  const stopwords = dict.stopwords;
  const securityWords = dict.securityWords;
  const patterns = compilePatterns(dict.patterns);

  const counter = new Map();
  const loc = new Map();
  const rowTokens = new Map();
  const securityRows = new Set();
  const securityTerms = new Set();

  const total = rows.length;
  const step = Math.max(1, Math.floor(total / 60));

  for (let i = 0; i < total; i++) {
    const row = rows[i] || {};
    const rownum = rowNumbers ? Number(rowNumbers[i]) : i + 2;
    const rt = [];
    let hasSec = false;
    for (const col of columns) {
      const raw = row[col];
      const text = raw === null || raw === undefined ? "" : String(raw);
      if (!text.trim()) continue;
      for (const t of reanalysisTokenize(text, { minLen, removeParticles, excludeTwoDigit, excludeTwoLetter, stopwords })) {
        counter.set(t, (counter.get(t) || 0) + 1);
        let L = loc.get(t);
        if (!L) { L = { rows: new Set(), cols: new Set() }; loc.set(t, L); }
        L.rows.add(rownum); L.cols.add(String(col));
        rt.push(t);
      }
      const fs = securityFindings(text, { securityWords, patterns, allowSpace: true });
      if (fs.length) {
        hasSec = true;
        for (const f of fs) securityTerms.add(normalizeReanalysisToken(f.matched, true));
      }
    }
    rowTokens.set(rownum, rt);
    if (hasSec) securityRows.add(rownum);
    if (i % step === 0) {
      onProgress(Math.round((i / Math.max(1, total)) * 100), `2차 재분석 ${(i + 1).toLocaleString()} / ${total.toLocaleString()}행`);
      await tick();
    }
  }

  const ranked = [...counter.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const outRows = [];
  for (let i = 0; i < ranked.length; i++) {
    const [w, cnt] = ranked[i];
    if (cnt < minFreq) continue;
    const [typ, cat, risk] = reanalysisClassify(w, securityWords);
    let related = 0;
    for (const rr of loc.get(w).rows) if (securityRows.has(rr)) related++;
    outRows.push({
      순위: outRows.length + 1, 정규화단어: w, 빈도: cnt, 행수: loc.get(w).rows.size,
      포함열: [...loc.get(w).cols].sort().join(", "), 보안연관행수: related,
      판정: typ === "보안 키워드" ? "높음" : (related ? "관심" : ""),
      분류: cat, 위험도: risk,
    });
  }

  /* 보안 키워드/패턴이 등장한 행에서 2~4-gram 보안문구 후보 추출 */
  const ngrams = new Map();
  const ngRows = new Map();
  for (const [rr, ts] of rowTokens) {
    if (!securityRows.has(rr)) continue;
    const seq = [];
    for (const t of ts) if (!seq.length || seq[seq.length - 1] !== t) seq.push(t);
    for (const n of [2, 3, 4]) {
      for (let i = 0; i <= seq.length - n; i++) {
        const part = seq.slice(i, i + n);
        if (!part.some((x) => securityTerms.has(x))) continue;
        const gram = part.join(" ");
        ngrams.set(gram, (ngrams.get(gram) || 0) + 1);
        let s = ngRows.get(gram);
        if (!s) { s = new Set(); ngRows.set(gram, s); }
        s.add(rr);
      }
    }
  }
  const phrases = [...ngrams.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .filter(([, c]) => c >= phraseMinFreq)
    .map(([g, c], i) => ({
      순위: i + 1, "보안문구 후보": g, 빈도: c, 행수: ngRows.get(g).size,
      근거: "보안 키워드/패턴 포함 행의 연속 단어",
    }));

  onProgress(100, "재분석 완료");
  return {
    rows: outRows, phrases,
    stats: { 원본고유단어: counter.size, 재분석표시단어: outRows.length, 보안연관행: securityRows.size },
  };
}

/* -------------------------------------------------------------------------- */
/* 패턴 유형 재분석                                                            */
/* -------------------------------------------------------------------------- */
export async function analyzePatternTypes(input) {
  const {
    /* maxVariants 0 = 유형당 모든 변형 값을 반환(절단 없음) */
    rows, columns, dict, minCount = 2, minValues = 1, maxVariants = 0, rowNumbers = null,
    onProgress = () => {},
  } = input;

  const typePatterns = compilePatterns([...(dict.patternTypes || []), ...(dict.patterns || [])]);
  const cache = new Map();
  const index = new PatternTypeIndex();
  const total = rows.length;
  const step = Math.max(1, Math.floor(total / 60));

  for (let i = 0; i < total; i++) {
    const row = rows[i] || {};
    const rownum = rowNumbers ? Number(rowNumbers[i]) : i + 2;
    for (const col of columns) {
      const raw = row[col];
      const text = raw === null || raw === undefined ? "" : String(raw);
      if (!text.trim()) continue;
      for (const tok of typeTokens(text, typePatterns, cache)) {
        index.add(tok, rownum, col, typePatterns, cache);
      }
    }
    if (i % step === 0) {
      onProgress(Math.round((i / Math.max(1, total)) * 100), `패턴 유형 분석 ${(i + 1).toLocaleString()} / ${total.toLocaleString()}행`);
      await tick();
    }
  }
  onProgress(100, "패턴 유형 분석 완료");
  return index.result(minCount, minValues, maxVariants);
}

/* -------------------------------------------------------------------------- */
/* 파일 파싱 (CSV / Excel)                                                      */
/* -------------------------------------------------------------------------- */
const CSV_DELIMS = [",", "\t", ";", "|", "^"];

/** 바이트 → 문자열. UTF-8 우선, 실패하면 EUC-KR/CP949 로 재시도(원본과 동일 순서). */
export function decodeBytes(buffer, forced) {
  const bytes = new Uint8Array(buffer);
  const candidates = forced ? [forced] : ["utf-8", "euc-kr"];
  for (const enc of candidates) {
    try {
      const text = new TextDecoder(enc, { fatal: enc === "utf-8" }).decode(bytes);
      return { text, encoding: enc };
    } catch (_e) { /* 다음 인코딩 */ }
  }
  return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8" };
}

/** CSV 구분자 자동 판별(따옴표 고려, 원본 Sniffer 대체). */
export function detectSeparator(sample) {
  const head = sample.slice(0, 50000);
  const firstLines = head.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  if (!firstLines.length) return ",";
  let best = ",", bestScore = 0;
  for (const d of CSV_DELIMS) {
    const counts = firstLines.map((line) => countOutsideQuotes(line, d));
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    /* 모든 줄에서 동일하게 나타나는 구분자를 선호 */
    const score = min > 0 && min === max ? min * 1000 + d.charCodeAt(0) : min;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return bestScore > 0 ? best : ",";
}

function countOutsideQuotes(line, delim) {
  let n = 0, inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delim && !inQuotes) n++;
  }
  return n;
}

/** RFC4180 호환 CSV 파서(개행 포함 셀, 이중 따옴표 이스케이프 지원). */
export function parseCSV(text, delim) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); field = ""; rows.push(row); row = [];
    } else if (ch === "\r") {
      /* \r\n 은 \n 에서 처리, 단독 \r 은 개행으로 */
      if (text[i + 1] !== "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** 2차원 배열(첫 행=헤더) → 행 객체 배열. 빈 헤더는 원본과 동일하게 컬럼_N 으로 보정. */
export function tableToRows(table) {
  if (!table.length) return { columns: [], rows: [] };
  const header = table[0].map((h, i) => {
    const s = cleanText(h);
    return s || `컬럼_${i + 1}`;
  });
  /* 중복 헤더 처리: pandas가 .1 을 붙이는 것과 유사하게 유니크화 */
  const seen = new Map();
  const columns = header.map((h) => {
    const n = seen.get(h) || 0;
    seen.set(h, n + 1);
    return n === 0 ? h : `${h}.${n}`;
  });
  const rows = [];
  for (let i = 1; i < table.length; i++) {
    const rec = {};
    const t = table[i];
    for (let c = 0; c < columns.length; c++) {
      const v = t[c];
      rec[columns[c]] = v === undefined ? "" : v;
    }
    rows.push(rec);
  }
  return { columns, rows };
}

/* -------------------------------------------------------------------------- */
/* 내보내기용 시트 구성 (원본 save_excel 과 동일한 12개 시트)                    */
/* -------------------------------------------------------------------------- */
export function buildExportSheets(state, dict) {
  const { result, reResult, ptResult, summaryMeta } = state;
  const sheets = [];
  const s = { ...(result?.summary || {}), ...(summaryMeta || {}) };
  sheets.push({ name: "Summary", rows: Object.entries(s).map(([k, v]) => ({ 항목: k, 값: v })) });
  sheets.push({ name: "Word_Frequency", rows: result?.words || [] });
  sheets.push({ name: "Security_Analysis", rows: result?.security || [] });
  sheets.push({ name: "Findings", rows: (result?.findings || []).slice(0, 200000) });
  sheets.push({ name: "Excluded_Words", rows: [...dict.stopwords].sort().map((w) => ({ 제외단어: w })) });
  sheets.push({
    name: "Security_Dictionary",
    rows: dict.securityWords.map(([w, c, r]) => ({ 단어: w, 분류: c, 위험도: r })),
  });
  sheets.push({
    name: "Pattern_Dictionary",
    rows: dict.patterns.map(([n, p, c, r]) => ({ 이름: n, 정규식: p, 분류: c, 위험도: r })),
  });
  sheets.push({ name: "Reanalysis_Words", rows: reResult?.rows || [] });
  sheets.push({ name: "Security_Phrases", rows: reResult?.phrases || [] });
  sheets.push({
    name: "Pattern_Types",
    rows: (ptResult?.types || []).map((t) => {
      const o = { ...t };
      delete o._key;
      delete o.샘플들;
      return o;
    }),
  });
  const variantRows = [];
  for (const t of ptResult?.types || []) {
    for (const v of (ptResult.variants?.[t._key] || [])) {
      variantRows.push({
        유형: v.유형, 분류: t.분류, 위험도: t.위험도,
        "실제 검출된 사례값": v.사례값 ?? v.값,
        빈도: v.빈도, 행수: v.행수, 포함열: v.포함열,
        "정규식/형태": t.패턴, 샘플: t.샘플,
      });
    }
  }
  sheets.push({ name: "Pattern_Type_Values", rows: variantRows });
  sheets.push({
    name: "Pattern_Type_Dictionary",
    rows: dict.patternTypes.map(([n, p, c, r]) => ({ 이름: n, 정규식: p, 분류: c, 위험도: r })),
  });
  return sheets;
}
