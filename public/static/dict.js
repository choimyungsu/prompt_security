/* ==========================================================================
 * dict.js — 분석 사전(제외 단어 / 보안 키워드 / 정규식 / 패턴 유형) 관리 UI
 *  · 셀 인라인 편집 + 자동 저장(포커스 이탈 시)
 *  · 붙여넣기 일괄 등록 + 미리보기
 *  · CSV 가져오기/내보내기
 *  · 사용/미사용 토글(행 삭제 없이 끄기)
 *  · 정규식 실시간 검증
 *  · 로컬 ↔ DB 동기화(올리기/가져오기)
 * ========================================================================== */
import { $, $$, toast, escapeHtml, renderTable, RISK_LEVELS, downloadCSV } from "./ui.js";

const KIND_META = {
  stopword: {
    label: "제외 단어",
    help:
      "단어 빈도/재분석에서 <strong>제외</strong>할 단어입니다. 조사(<code>은</code>, <code>는</code>, <code>이</code>…)나 " +
      "의미 없는 일반명사(<code>정보</code>, <code>관리</code>…)를 넣어두면 결과가 깔끔해집니다. 값만 입력하면 됩니다.",
    placeholder: "예: 및, 또한, 관련",
    hasPattern: false,
  },
  security: {
    label: "보안 키워드",
    help:
      "텍스트 안에 <strong>부분 문자열</strong>로 등장하면 탐지합니다(대소문자 무시, 띄어쓰기 허용 옵션 적용). " +
      "분류와 위험도를 지정해 두면 보안 분석 표가 위험도 순으로 정렬됩니다.",
    placeholder: "예: 주민등록번호, API Key",
    hasPattern: false,
  },
  pattern: {
    label: "정규식 패턴",
    help:
      "셀 값 안의 <strong>형식</strong>을 정규식으로 탐지합니다(예: 주민번호 <code>\\d{6}-[1-4]\\d{6}</code>). " +
      "값 칸은 패턴 <strong>이름</strong>, 패턴 칸은 정규식입니다. 정규식은 입력 즉시 검증됩니다.",
    placeholder: "이름: 주민등록번호 형식 / 정규식: \\d{6}-[1-4]\\d{6}",
    hasPattern: true,
  },
  pattern_type: {
    label: "패턴 유형",
    help:
      "값은 달라도 <strong>형식이 같은 값</strong>을 하나의 유형으로 묶는 기준입니다. " +
      "예) <code>PJT-2026-12345</code>, <code>PJT-2025-11111</code> → 둘 다 같은 유형으로 집계. " +
      "구체적인 규칙을 위쪽에 두는 것이 좋습니다(첫 일치가 유형이 됨).",
    placeholder: "이름: 프로젝트 코드 / 정규식: [A-Z]{2,6}-\\d{4}-\\d{5}",
    hasPattern: true,
  },
};

export const initDictUI = {
  open(state) {
    this.state = state;
    this.dict = state.dict;
    this.kind = this.kind || "stopword";
    $("#dict-modal").hidden = false;
    this.renderTabs();
    this.renderHelp();
    this.renderTable();
    this.renderStorageBadge();
  },

  init(state, opts = {}) {
    this.state = state;
    this.dict = state.dict;
    this.kind = "stopword";
    this.opts = opts;
    this.bindOnce();
  },

  bindOnce() {
    if (this._bound) return;
    this._bound = true;

    /* 사전 종류 탭 */
    $$("#dict-tabs .dict-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.kind = btn.dataset.kind;
        this.renderTabs();
        this.renderHelp();
        this.renderTable();
        this.updateQuickPlaceholders();
      });
    });

    /* 빠른 추가 */
    $("#btn-quick-add").addEventListener("click", () => this.quickAdd());
    ["quick-value", "quick-category", "quick-risk", "quick-note"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") this.quickAdd();
        });
      }
    });

    /* 붙여넣기 일괄 */
    $("#btn-bulk-add").addEventListener("click", () => this.bulkAdd(false));
    $("#btn-bulk-append").addEventListener("click", () => this.bulkPreview());

    /* 검색 / 필터 */
    $("#dict-search").addEventListener("input", () => this.renderTable());
    $("#dict-enabled-only").addEventListener("change", () => this.renderTable());

    /* 기본값 / 삭제 / 내보내기 / 가져오기 */
    $("#btn-dict-seed").addEventListener("click", () => this.seedDefaults());
    $("#btn-dict-delete-sel").addEventListener("click", () => this.deleteSelected());
    $("#btn-dict-export").addEventListener("click", () => this.exportCSV());
    $("#dict-import").addEventListener("change", (e) => this.importCSV(e));

    /* DB 동기화 */
    $("#btn-dict-push").addEventListener("click", () => this.pushToDb());
    $("#btn-dict-pull").addEventListener("click", () => this.pullFromDb());
  },

  renderTabs() {
    $$("#dict-tabs .dict-tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.kind === this.kind)
    );
    for (const kind of Object.keys(KIND_META)) {
      const el = document.getElementById("cnt-" + kind);
      if (el) el.textContent = `(${(this.dict[kind] || []).length})`;
    }
  },

  renderHelp() {
    const meta = KIND_META[this.kind];
    const extra = meta.hasPattern
      ? `<br>형식: <strong>값(이름)</strong> · <strong>정규식</strong> · 분류 · 위험도`
      : `<br>형식: <strong>값</strong> · 분류 · 위험도`;
    $("#dict-help").innerHTML = meta.help + extra;
    this.updateQuickPlaceholders();
  },

  updateQuickPlaceholders() {
    const meta = KIND_META[this.kind];
    const v = $("#quick-value");
    if (v) v.placeholder = meta.placeholder || "값";
    const c = $("#quick-category");
    const r = $("#quick-risk");
    const isPat = meta.hasPattern;
    /* 패턴 종류는 정규식 입력이 필요하므로 분류/위험도 대신 안내 */
    if (c) c.placeholder = isPat ? "정규식 (예: [A-Z]{2,6}-\\d{4})" : "분류 (예: 개인정보)";
    if (r) r.style.display = isPat ? "none" : "";
    const note = $("#quick-note");
    if (note) note.placeholder = isPat ? "분류 (예: 업무식별자)" : "메모(선택)";
  },

  /* ------------------------------------------------------------------ */
  renderStorageBadge() {
    const el = $("#dict-storage-badge");
    const st = this.state.store;
    if (!el) return;
    if (st.mode === "db" && st.dbReady) {
      el.className = "status-chip status-ok";
      el.textContent = "DB 저장 중";
    } else {
      el.className = "status-chip status-local";
      el.textContent = st.dbReady ? "로컬(브라우저)" : "로컬(DB 미연결)";
    }
    const push = $("#btn-dict-push");
    const pull = $("#btn-dict-pull");
    const disabled = !st.dbReady;
    if (push) push.disabled = disabled;
    if (pull) pull.disabled = disabled;
  },

  /* ------------------------------------------------------------------ */
  filteredRows() {
    const q = ($("#dict-search").value || "").trim().toLowerCase();
    const onlyOn = $("#dict-enabled-only").checked;
    let rows = (this.dict[this.kind] || []).slice();
    if (onlyOn) rows = rows.filter((x) => Number(x.enabled) === 1);
    if (q) {
      rows = rows.filter(
        (x) =>
          String(x.value).toLowerCase().includes(q) ||
          String(x.pattern || "").toLowerCase().includes(q) ||
          String(x.category || "").toLowerCase().includes(q) ||
          String(x.note || "").toLowerCase().includes(q)
      );
    }
    return rows;
  },

  renderTable() {
    const meta = KIND_META[this.kind];
    const rows = this.filteredRows();
    const total = (this.dict[this.kind] || []).length;
    $("#dict-table-info").textContent = `${rows.length.toLocaleString()} / ${total.toLocaleString()}개`;

    const container = $("#dict-table");
    if (!rows.length) {
      container.innerHTML = `<p class="empty-note">항목이 없습니다. 위의 빠른 추가 또는 붙여넣기로 등록하세요.</p>`;
      return;
    }

    const isPat = meta.hasPattern;
    const cols = [
      { key: "_chk", label: "", width: 30 },
      { key: "enabled", label: "사용", width: 46 },
      { key: "value", label: isPat ? "이름" : "값", width: 170 },
      ...(isPat ? [{ key: "pattern", label: "정규식", width: 210 }] : []),
      { key: "category", label: "분류", width: 100 },
      { key: "risk", label: "위험도", width: 96 },
      { key: "note", label: "메모", width: 140 },
      { key: "source", label: "출처", width: 60 },
      { key: "_del", label: "", width: 40 },
    ];

    const head = cols
      .map(
        (c) =>
          `<th${c.width ? ` style="width:${c.width}px"` : ""}>${c.key === "_chk" ? `<input type="checkbox" id="dict-chk-all" />` : escapeHtml(c.label)}</th>`
      )
      .join("");

    const body = rows
      .map((row, i) => {
        const id = escapeHtml(String(row.id));
        const disabled = Number(row.enabled) === 0;
        const riskOpts = [`<option value="">-</option>`]
          .concat(
            RISK_LEVELS.map(
              (lv) => `<option value="${lv}"${row.risk === lv ? " selected" : ""}>${lv}</option>`
            )
          )
          .join("");
        const tds = [
          `<td><input type="checkbox" class="dict-chk" data-id="${id}" /></td>`,
          `<td><input type="checkbox" class="dict-enabled" data-id="${id}"${disabled ? "" : " checked"} /></td>`,
          `<td><input class="cell-edit" data-id="${id}" data-field="value" value="${escapeHtml(row.value || "")}" /></td>`,
          ...(isPat
            ? [
                `<td><input class="cell-edit mono" data-id="${id}" data-field="pattern" value="${escapeHtml(
                  row.pattern || ""
                )}" /></td>`,
              ]
            : []),
          `<td><input class="cell-edit" data-id="${id}" data-field="category" value="${escapeHtml(
            row.category || ""
          )}" /></td>`,
          `<td><select class="cell-edit" data-id="${id}" data-field="risk">${riskOpts}</select></td>`,
          `<td><input class="cell-edit" data-id="${id}" data-field="note" value="${escapeHtml(
            row.note || ""
          )}" /></td>`,
          `<td><span class="hint-inline">${row.source === "default" ? "기본" : "사용자"}</span></td>`,
          `<td><button class="btn btn-mini btn-danger dict-del" data-id="${id}">✕</button></td>`,
        ].join("");
        return `<tr class="${disabled ? "row-disabled" : ""}" data-id="${id}">${tds}</tr>`;
      })
      .join("");

    container.innerHTML = `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;

    /* 이벤트 바인딩 */
    const chkAll = container.querySelector("#dict-chk-all");
    if (chkAll) {
      chkAll.addEventListener("change", () => {
        container.querySelectorAll(".dict-chk").forEach((c) => (c.checked = chkAll.checked));
      });
    }

    container.querySelectorAll(".cell-edit").forEach((input) => {
      input.addEventListener("change", () => this.saveCell(input));
      if (input.dataset.field === "pattern") {
        input.addEventListener("input", () => this.validatePatternCell(input));
      }
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.blur();
        }
      });
    });

    container.querySelectorAll(".dict-enabled").forEach((chk) => {
      chk.addEventListener("change", () => this.toggleEnabled(chk));
    });

    container.querySelectorAll(".dict-del").forEach((btn) => {
      btn.addEventListener("click", () => this.deleteOne(btn.dataset.id));
    });
  },

  validatePatternCell(input) {
    const v = input.value;
    if (!v) {
      input.style.borderColor = "";
      input.title = "";
      return;
    }
    try {
      new RegExp(v);
      input.style.borderColor = "#86efac";
      input.title = "유효한 정규식입니다.";
    } catch (e) {
      input.style.borderColor = "#fca5a5";
      input.title = "정규식 오류: " + e.message;
    }
  },

  async saveCell(input) {
    const id = input.dataset.id;
    const field = input.dataset.field;
    const value = input.value;
    const row = (this.dict[this.kind] || []).find((x) => String(x.id) === String(id));
    if (!row || String(row[field] ?? "") === value) return;
    if (field === "pattern" && value) {
      try {
        new RegExp(value);
      } catch (e) {
        toast("정규식 오류: " + e.message, "err", 4000);
        input.value = row[field] || "";
        return;
      }
    }
    if (field === "value" && !value.trim()) {
      toast("값은 비울 수 없습니다.", "err");
      input.value = row[field] || "";
      return;
    }
    try {
      await this.state.store.updateItem(this.dict, this.kind, id, { [field]: value });
      input.style.borderColor = "";
      toast("저장했습니다.", "ok", 1200);
      this.renderTabs();
    } catch (e) {
      toast("저장 실패: " + e.message, "err", 4000);
      input.value = row[field] || "";
    }
  },

  async toggleEnabled(chk) {
    const id = chk.dataset.id;
    try {
      await this.state.store.updateItem(this.dict, this.kind, id, { enabled: chk.checked ? 1 : 0 });
      chk.closest("tr").classList.toggle("row-disabled", !chk.checked);
    } catch (e) {
      toast("변경 실패: " + e.message, "err");
      chk.checked = !chk.checked;
    }
  },

  async deleteOne(id) {
    try {
      await this.state.store.deleteItems(this.dict, this.kind, [id]);
      this.renderTable();
      this.renderTabs();
      toast("삭제했습니다.", "ok", 1200);
    } catch (e) {
      toast("삭제 실패: " + e.message, "err");
    }
  },

  async deleteSelected() {
    const ids = $$("#dict-table .dict-chk")
      .filter((c) => c.checked)
      .map((c) => c.dataset.id);
    if (!ids.length) return toast("삭제할 항목을 선택하세요.", "err");
    if (!confirm(`선택한 ${ids.length}개 항목을 삭제할까요?`)) return;
    try {
      await this.state.store.deleteItems(this.dict, this.kind, ids);
      this.renderTable();
      this.renderTabs();
      toast(`${ids.length}개 삭제 완료`, "ok");
    } catch (e) {
      toast("삭제 실패: " + e.message, "err", 4000);
    }
  },

  /* ------------------------------------------------------------------ */
  buildQuickItem() {
    const meta = KIND_META[this.kind];
    const value = ($("#quick-value").value || "").trim();
    if (!value) {
      toast("값을 입력하세요.", "err");
      return null;
    }
    if (meta.hasPattern) {
      /* 패턴/패턴유형: 값=이름, 분류칸=정규식, 메모칸=분류 */
      const pattern = ($("#quick-category").value || "").trim();
      const category = ($("#quick-note").value || "").trim();
      if (!pattern) {
        toast("정규식을 입력하세요.", "err");
        return null;
      }
      try {
        new RegExp(pattern);
      } catch (e) {
        toast("정규식 오류: " + e.message, "err", 4000);
        return null;
      }
      return { value, pattern, category, risk: "", note: "" };
    }
    return {
      value,
      pattern: "",
      category: ($("#quick-category").value || "").trim(),
      risk: $("#quick-risk").value || "",
      note: ($("#quick-note").value || "").trim(),
    };
  },

  async quickAdd() {
    const item = this.buildQuickItem();
    if (!item) return;
    try {
      await this.state.store.addItem(this.dict, this.kind, item);
      $("#quick-value").value = "";
      $("#quick-category").value = "";
      $("#quick-note").value = "";
      $("#quick-risk").value = "";
      $("#quick-msg").textContent = `"${item.value}" 추가됨`;
      setTimeout(() => ($("#quick-msg").textContent = ""), 2500);
      this.renderTable();
      this.renderTabs();
      $("#quick-value").focus();
    } catch (e) {
      toast("추가 실패: " + e.message, "err", 4000);
    }
  },

  /* ------------------------------------------------------------------ */
  parseBulk(text) {
    const meta = KIND_META[this.kind];
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    const items = [];
    const errors = [];
    for (const line of lines) {
      /* 탭 우선, 없으면 쉼표 (단, 정규식 안의 쉼표를 피하려면 탭 권장) */
      const parts = line.includes("\t")
        ? line.split("\t").map((s) => s.trim())
        : line.split(",").map((s) => s.trim());
      const value = parts[0] || "";
      if (!value) continue;
      if (meta.hasPattern) {
        const pattern = parts[1] || "";
        if (!pattern) {
          errors.push(`정규식 없음: ${value}`);
          continue;
        }
        try {
          new RegExp(pattern);
        } catch (e) {
          errors.push(`정규식 오류(${value}): ${e.message}`);
          continue;
        }
        items.push({ value, pattern, category: parts[2] || "", risk: parts[3] || "", note: parts[4] || "" });
      } else {
        items.push({ value, pattern: "", category: parts[1] || "", risk: parts[2] || "", note: parts[3] || "" });
      }
    }
    return { items, errors };
  },

  bulkPreview() {
    const { items, errors } = this.parseBulk($("#bulk-text").value);
    const pre = $("#bulk-preview");
    pre.hidden = false;
    const lines = [`총 ${items.length}개 인식 (오류 ${errors.length}건)`, ""];
    items.slice(0, 30).forEach((it, i) => {
      lines.push(
        `${i + 1}. ${it.value}` +
          (it.pattern ? `  ⟶  ${it.pattern}` : "") +
          (it.category ? `  [${it.category}]` : "") +
          (it.risk ? ` {${it.risk}}` : "")
      );
    });
    if (items.length > 30) lines.push(`… 외 ${items.length - 30}개`);
    if (errors.length) {
      lines.push("", "⚠ 오류:");
      errors.slice(0, 10).forEach((e) => lines.push("  - " + e));
    }
    pre.textContent = lines.join("\n");
  },

  async bulkAdd() {
    const { items, errors } = this.parseBulk($("#bulk-text").value);
    if (!items.length) return toast("등록할 항목이 없습니다. 형식을 확인하세요.", "err", 4000);
    const replace = $("#bulk-replace").checked;
    if (replace && !confirm(`기존 "${KIND_META[this.kind].label}" 항목을 모두 지우고 ${items.length}개로 교체할까요?`))
      return;
    try {
      const r = await this.state.store.bulkAdd(this.dict, this.kind, items, replace);
      const msg = `추가 ${r.inserted}개` + (r.skipped ? ` · 건너뜀 ${r.skipped}개` : "");
      $("#bulk-msg").textContent = msg;
      toast(msg + (errors.length ? ` (오류 ${errors.length}건)` : ""), "ok", 3500);
      if (errors.length) {
        $("#bulk-preview").hidden = false;
        $("#bulk-preview").textContent = "오류:\n" + errors.slice(0, 20).join("\n");
      }
      this.renderTable();
      this.renderTabs();
    } catch (e) {
      toast("일괄 등록 실패: " + e.message, "err", 5000);
    }
  },

  /* ------------------------------------------------------------------ */
  async seedDefaults() {
    const total = (this.dict[this.kind] || []).length;
    const label = KIND_META[this.kind].label;
    if (total > 0 && !confirm(`"${label}"에 기본값을 추가할까요? (이미 있는 항목은 건너뜁니다)`)) return;
    const st = this.state.store;
    try {
      if (st.mode === "db" && st.dbReady) {
        const r = await fetch("/api/db/seed", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kinds: [this.kind] }),
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.message || d.error || "기본값 채우기 실패");
        this.dict = await st.loadDictionary();
        this.state.dict = this.dict;
        toast(`기본값 ${d.inserted}개 추가`, "ok");
      } else {
        /* 서버 기본값은 {value,pattern,category,risk} 객체로 온다.
           (배열 인덱스로 읽으면 값이 전부 빈 문자열이 되어 탐지가 불가능해진다) */
        const defs = st.defaults?.[this.kind] || [];
        const isPat = KIND_META[this.kind].hasPattern;
        const items = defs
          .map((raw) => {
            const isArr = Array.isArray(raw);
            const value = String((isArr ? raw[0] : raw.value) ?? "").trim();
            if (!value) return null;
            return {
              value,
              pattern: isPat ? String((isArr ? raw[1] : raw.pattern) ?? "") : "",
              category: isPat
                ? String((isArr ? raw[2] : raw.category) ?? "")
                : String((isArr ? raw[1] : raw.category) ?? ""),
              risk: isPat
                ? String((isArr ? raw[3] : raw.risk) ?? "")
                : String((isArr ? raw[2] : raw.risk) ?? ""),
              note: "",
            };
          })
          .filter(Boolean);
        if (!items.length) return toast("기본값 데이터를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.", "err", 4000);
        const r = await st.bulkAdd(this.dict, this.kind, items, false);
        toast(`기본값 ${r.inserted}개 추가`, "ok");
      }
      this.renderTable();
      this.renderTabs();
    } catch (e) {
      toast("기본값 채우기 실패: " + e.message, "err", 4000);
    }
  },

  exportCSV() {
    const isPat = KIND_META[this.kind].hasPattern;
    const rows = (this.dict[this.kind] || []).map((x) => ({
      value: x.value,
      pattern: isPat ? x.pattern : "",
      category: x.category,
      risk: x.risk,
      note: x.note,
      enabled: Number(x.enabled) ? "Y" : "N",
    }));
    if (!rows.length) return toast("내보낼 항목이 없습니다.", "err");
    const cols = isPat
      ? [
          { key: "value", label: "이름" },
          { key: "pattern", label: "정규식" },
          { key: "category", label: "분류" },
          { key: "risk", label: "위험도" },
          { key: "note", label: "메모" },
          { key: "enabled", label: "사용" },
        ]
      : [
          { key: "value", label: "값" },
          { key: "category", label: "분류" },
          { key: "risk", label: "위험도" },
          { key: "note", label: "메모" },
          { key: "enabled", label: "사용" },
        ];
    downloadCSV(rows, cols, `dictionary_${this.kind}.csv`);
    toast("CSV 내보내기 완료", "ok");
  },

  async importCSV(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch {
        text = new TextDecoder("euc-kr").decode(buf);
      }
      text = text.replace(/^\ufeff/, "");
      /* 헤더가 있으면 건너뛴다 */
      const lines = text.split(/\r?\n/);
      const first = (lines[0] || "").toLowerCase();
      const start = /이름|정규식|값|단어|value|pattern/.test(first) ? 1 : 0;
      const { items, errors } = this.parseBulk(lines.slice(start).join("\n"));
      if (!items.length) return toast("가져올 항목이 없습니다.", "err", 4000);
      const r = await this.state.store.bulkAdd(this.dict, this.kind, items, false);
      this.renderTable();
      this.renderTabs();
      toast(`가져오기 완료 · 추가 ${r.inserted}개` + (errors.length ? ` (오류 ${errors.length})` : ""), "ok", 3500);
    } catch (err) {
      toast("CSV 가져오기 실패: " + err.message, "err", 4000);
    }
  },

  /* ------------------------------------------------------------------ */
  async pushToDb() {
    const st = this.state.store;
    if (!st.dbReady) return toast("DB가 준비되지 않았습니다.", "err");
    if (!confirm("현재 화면의 사전을 DB로 업로드할까요? (같은 항목은 갱신됩니다)")) return;
    try {
      const n = await st.pushDictToDb(this.dict);
      toast(`DB 업로드 완료 · ${n}개 반영`, "ok", 3500);
      this.renderStorageBadge();
    } catch (e) {
      toast("DB 업로드 실패: " + e.message, "err", 5000);
    }
  },

  async pullFromDb() {
    const st = this.state.store;
    if (!st.dbReady) return toast("DB가 준비되지 않았습니다.", "err");
    if (!confirm("DB 사전을 현재 화면으로 가져올까요? (화면 내용이 DB 기준으로 바뀝니다)")) return;
    try {
      this.dict = await st.pullDictFromDb(this.dict);
      this.state.dict = this.dict;
      this.renderTable();
      this.renderTabs();
      toast("DB 사전을 가져왔습니다.", "ok");
    } catch (e) {
      toast("DB 가져오기 실패: " + e.message, "err", 5000);
    }
  },
};
