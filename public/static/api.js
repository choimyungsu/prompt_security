/* ==========================================================================
 * api.js — 서버 API 래퍼 + 저장소 추상화(로컬 / DB)
 * ========================================================================== */

const LS_KEY = "swa.dict.v2";
const LS_SETTINGS = "swa.settings.v2";
const LS_HISTORY = "swa.history.v2";

/* ------------------------------- HTTP ----------------------------------- */
async function request(path, options = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`서버 응답을 해석할 수 없습니다. (${res.status})`);
  }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.message || data.error || `요청 실패 (${res.status})`);
    err.status = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request("/health"),
  defaults: () => request("/dict-defaults"),
  getSettings: () => request("/settings"),
  saveSettings: (body) => request("/settings", { method: "POST", body: JSON.stringify(body) }),
  dbInit: () => request("/db/init", { method: "POST" }),
  dbSeed: (kinds) => request("/db/seed", { method: "POST", body: JSON.stringify({ kinds }) }),
  dbReset: (target) => request("/db/reset", { method: "POST", body: JSON.stringify({ target }) }),
  dbExport: () => request("/db/export"),

  listDict: (kind, q = "") =>
    request(`/dict?kind=${encodeURIComponent(kind)}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  listAllDict: () => request("/dict"),
  addDict: (item) => request("/dict", { method: "POST", body: JSON.stringify(item) }),
  bulkDict: (kind, items, replace = false) =>
    request("/dict/bulk", { method: "POST", body: JSON.stringify({ kind, items, replace }) }),
  updateDict: (id, patch) => request(`/dict/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteDict: (id) => request(`/dict/${id}`, { method: "DELETE" }),
  deleteDictMany: (ids) => request("/dict/delete", { method: "POST", body: JSON.stringify({ ids }) }),

  saveRun: (run, results) =>
    request("/runs", { method: "POST", body: JSON.stringify({ run, results }) }),
  listRuns: (limit = 100) => request(`/runs?limit=${limit}`),
  getRun: (id) => request(`/runs/${id}`),
  deleteRun: (id) => request(`/runs/${id}`, { method: "DELETE" }),
};

/* ---------------------------- 로컬 저장소 -------------------------------- */
function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 저장소 추상화.
 * mode = 'local' → localStorage 만 사용 (서버 전송 없음)
 * mode = 'db'    → Cloudflare D1 REST API 사용
 */
export class Store {
  constructor() {
    this.mode = "local";
    this.settings = { ...DEFAULT_SETTINGS_UI };
    this.defaults = null;
    this.dbReady = false;
    this.dbBound = false;
  }

  async init() {
    /* DB 기본값/설정 동시 조회 */
    let health = null;
    try {
      health = await api.health();
    } catch {
      health = { dbBound: false, dbOk: false, schemaOk: false };
    }
    this.healthInfo = health;
    this.dbBound = Boolean(health?.dbBound);
    this.dbReady = Boolean(health?.dbOk && health?.schemaOk);

    try {
      const d = await api.defaults();
      this.defaults = d.defaults;
    } catch {
      this.defaults = null;
    }

    const localSettings = lsGet(LS_SETTINGS, null);
    if (this.dbReady) {
      try {
        const s = await api.getSettings();
        this.settings = { ...DEFAULT_SETTINGS_UI, ...s.settings };
        /* 로컬에 마지막으로 쓰던 모드가 있으면 그쪽을 우선 */
        if (localSettings?.storage_mode) this.mode = localSettings.storage_mode;
        else this.mode = this.settings.storage_mode || "local";
      } catch {
        this.mode = localSettings?.storage_mode || "local";
      }
    } else {
      this.mode = localSettings?.storage_mode || "local";
      this.settings = { ...DEFAULT_SETTINGS_UI, ...(localSettings || {}) };
    }
    if (this.mode === "db" && !this.dbReady) this.mode = "local";
    return this;
  }

  /* ---- 사전 읽기: 화면 표시용 전체 목록 ---- */
  async loadDictionary() {
    const out = { stopword: [], security: [], pattern: [], pattern_type: [] };
    if (this.mode === "db" && this.dbReady) {
      try {
        const r = await api.listAllDict();
        for (const it of r.items || []) {
          if (!out[it.kind]) continue;
          out[it.kind].push({
            id: it.id,
            value: it.value,
            pattern: it.pattern || "",
            category: it.category || "",
            risk: it.risk || "",
            note: it.note || "",
            enabled: it.enabled ? 1 : 0,
            source: it.source || "user",
          });
        }
        return out;
      } catch (e) {
        console.warn("DB 사전 로드 실패, 로컬로 대체", e);
      }
    }
    /* 로컬 */
    const saved = lsGet(LS_KEY, null);
    if (saved && saved.stopword) {
      /* 과거 버그로 값이 빈 항목이 캐시되어 있으면 기본값으로 재생성한다.
         (빈 값은 보안 탐지가 불가능하므로 반드시 복구해야 한다) */
      if (Store.isCacheBroken(saved)) {
        console.warn("[dict] 손상된 로컬 사전 캐시를 감지 → 기본값으로 복구합니다.");
        return this.localFromDefaults();
      }
      return saved;
    }
    return this.localFromDefaults();
  }

  localFromDefaults() {
    const d = this.defaults || {};
    const out = { stopword: [], security: [], pattern: [], pattern_type: [] };
    for (const kind of Object.keys(out)) {
      for (const raw of d[kind] || []) {
        /* 서버 기본값은 {kind,value,pattern,category,risk,...} 객체로 온다.
           (과거 배열 형식도 방어적으로 지원) */
        const isArr = Array.isArray(raw);
        const isPat = kind === "pattern" || kind === "pattern_type";
        const value = isArr ? raw[0] : raw.value;
        const pattern = isPat ? (isArr ? raw[1] : raw.pattern) : "";
        const category = isPat
          ? isArr ? raw[2] : raw.category
          : isArr ? raw[1] : raw.category;
        const risk = isPat ? (isArr ? raw[3] : raw.risk) : isArr ? raw[2] : raw.risk;
        const v = String(value ?? "").trim();
        if (!v) continue; /* 값이 비면 탐지가 불가능하므로 제외 */
        out[kind].push({
          id: `L${kind}-${out[kind].length}`,
          value: v,
          pattern: String(pattern ?? ""),
          category: String(category ?? ""),
          risk: String(risk ?? ""),
          note: "",
          enabled: 1,
          source: "default",
        });
      }
    }
    lsSet(LS_KEY, out);
    return out;
  }

  /** localStorage 캐시가 손상(값이 빈 항목)되었는지 검사한다. */
  static isCacheBroken(dict) {
    if (!dict || !dict.stopword) return true;
    const kinds = ["stopword", "security", "pattern", "pattern_type"];
    for (const k of kinds) {
      const list = dict[k];
      if (!Array.isArray(list)) return true;
      if (!list.length) return true; /* 비어 있으면 손상으로 간주 */
      if (list.some((x) => !String(x?.value ?? "").trim())) return true;
    }
    return false;
  }

  /* ---- 사전 쓰기 ---- */
  async saveLocal(dict) {
    const ok = lsSet(LS_KEY, dict);
    if (!ok) throw new Error("브라우저 저장 공간이 부족합니다. DB 모드를 사용하세요.");
    return dict;
  }

  async addItem(dict, kind, item) {
    if (this.mode === "db" && this.dbReady) {
      const r = await api.addDict({ kind, ...item });
      const it = r.item;
      dict[kind].push({
        id: it.id,
        value: it.value,
        pattern: it.pattern || "",
        category: it.category || "",
        risk: it.risk || "",
        note: it.note || "",
        enabled: it.enabled ? 1 : 0,
        source: "user",
      });
      return dict;
    }
    const dup = dict[kind].some(
      (x) => x.value === item.value && (x.pattern || "") === (item.pattern || "")
    );
    if (dup) throw new Error("같은 항목이 이미 있습니다.");
    dict[kind].push({
      id: `L${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      value: item.value,
      pattern: item.pattern || "",
      category: item.category || "",
      risk: item.risk || "",
      note: item.note || "",
      enabled: 1,
      source: "user",
    });
    return this.saveLocal(dict);
  }

  async updateItem(dict, kind, id, patch) {
    if (this.mode === "db" && this.dbReady) {
      await api.updateDict(id, patch);
    }
    const row = dict[kind].find((x) => String(x.id) === String(id));
    if (!row) return dict;
    Object.assign(row, patch);
    row.source = "user";
    if (this.mode !== "db" || !this.dbReady) await this.saveLocal(dict);
    return dict;
  }

  async deleteItems(dict, kind, ids) {
    const set = new Set(ids.map(String));
    if (this.mode === "db" && this.dbReady) {
      const numeric = ids.map(Number).filter((n) => Number.isFinite(n));
      if (numeric.length) await api.deleteDictMany(numeric);
    }
    dict[kind] = dict[kind].filter((x) => !set.has(String(x.id)));
    if (this.mode !== "db" || !this.dbReady) await this.saveLocal(dict);
    return dict;
  }

  async bulkAdd(dict, kind, items, replace) {
    if (this.mode === "db" && this.dbReady) {
      const r = await api.bulkDict(kind, items, replace);
      const fresh = await this.loadDictionary();
      for (const k of Object.keys(dict)) dict[k] = fresh[k];
      return { dict, inserted: r.inserted, skipped: r.skipped, errors: r.errors || [] };
    }
    if (replace) dict[kind] = [];
    const seen = new Set(dict[kind].map((x) => x.value + "\u0000" + (x.pattern || "")));
    let inserted = 0,
      skipped = 0;
    for (const it of items) {
      const key = (it.value || "") + "\u0000" + (it.pattern || "");
      if (!it.value || seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      dict[kind].push({
        id: `L${kind}-${Date.now()}-${inserted}`,
        value: it.value,
        pattern: it.pattern || "",
        category: it.category || "",
        risk: it.risk || "",
        note: it.note || "",
        enabled: 1,
        source: "user",
      });
      inserted++;
    }
    await this.saveLocal(dict);
    return { dict, inserted, skipped, errors: [] };
  }

  /** 현재 화면 사전을 DB에 업로드(로컬→DB 마이그레이션) */
  async pushDictToDb(dict) {
    if (!this.dbReady) throw new Error("DB가 준비되지 않았습니다.");
    let total = 0;
    for (const kind of Object.keys(dict)) {
      const items = dict[kind]
        .filter((x) => x.enabled)
        .map((x) => ({
          value: x.value,
          pattern: x.pattern || "",
          category: x.category || "",
          risk: x.risk || "",
          note: x.note || "",
        }));
      if (!items.length) continue;
      const r = await api.bulkDict(kind, items, false);
      total += r.inserted || 0;
    }
    return total;
  }

  /** DB 사전을 현재 화면으로 가져오기 */
  async pullDictFromDb(dict) {
    if (!this.dbReady) throw new Error("DB가 준비되지 않았습니다.");
    const fresh = await api.listAllDict();
    for (const k of Object.keys(dict)) dict[k] = [];
    for (const it of fresh.items || []) {
      if (!dict[it.kind]) continue;
      dict[it.kind].push({
        id: it.id,
        value: it.value,
        pattern: it.pattern || "",
        category: it.category || "",
        risk: it.risk || "",
        note: it.note || "",
        enabled: it.enabled ? 1 : 0,
        source: it.source || "user",
      });
    }
    return dict;
  }

  async saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    lsSet(LS_SETTINGS, this.settings);
    if (this.dbReady) {
      try {
        const r = await api.saveSettings(patch);
        this.settings = { ...this.settings, ...r.settings };
      } catch (e) {
        console.warn("설정 DB 저장 실패(로컬만 반영)", e);
      }
    }
    return this.settings;
  }

  /* ---- 이력 ---- */
  async saveHistory(entry) {
    if (this.settings.keep_history !== "1") return { skipped: true };
    if (this.mode === "db" && this.dbReady) {
      return api.saveRun(entry.run, entry.results || []);
    }
    const list = lsGet(LS_HISTORY, []);
    list.unshift({ id: "L" + Date.now(), ...entry.run, results: entry.results || [] });
    const max = Number(this.settings.retention_limit || 50);
    lsSet(LS_HISTORY, list.slice(0, max));
    return { ok: true, runId: "local" };
  }

  async loadHistory() {
    if (this.mode === "db" && this.dbReady) {
      const r = await api.listRuns(200);
      return r.items || [];
    }
    return lsGet(LS_HISTORY, []);
  }

  async loadHistoryDetail(id) {
    if (this.mode === "db" && this.dbReady && !String(id).startsWith("L")) {
      return api.getRun(id);
    }
    const list = lsGet(LS_HISTORY, []);
    const row = list.find((x) => String(x.id) === String(id));
    if (!row) throw new Error("이력을 찾을 수 없습니다.");
    return { run: row, results: (row.results || []).map((r) => ({ kind: r.kind, payload: r.payload })) };
  }

  async clearHistory() {
    if (this.mode === "db" && this.dbReady) {
      await api.dbReset("history");
    }
    lsSet(LS_HISTORY, []);
    return true;
  }

  async deleteHistory(id) {
    if (this.mode === "db" && this.dbReady && !String(id).startsWith("L")) {
      await api.deleteRun(id);
      return;
    }
    const list = lsGet(LS_HISTORY, []).filter((x) => String(x.id) !== String(id));
    lsSet(LS_HISTORY, list);
  }
}

export const DEFAULT_SETTINGS_UI = {
  storage_mode: "local",
  persist_results: "0",
  retention_limit: "50",
  keep_history: "1",
  default_allow_space: "1",
  default_min_len: "2",
};
