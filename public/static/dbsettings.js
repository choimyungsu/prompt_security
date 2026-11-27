/* ==========================================================================
 * dbsettings.js — DB 설정 화면
 *  · 연결 상태 진단(바인딩/스키마/테이블별 건수)
 *  · 저장 모드 선택(로컬 / DB)
 *  · 보관 정책(이력 저장, 결과 표 저장, 보관 건수)
 *  · 데이터 관리(스키마 생성, 기본 사전, 백업, 초기화)
 * ========================================================================== */
import { $, toast, escapeHtml } from "./ui.js";
import { api } from "./api.js";

export const initDbUI = {
  init(state, hooks = {}) {
    this.state = state;
    this.hooks = hooks;
    this.bindOnce();
  },

  bindOnce() {
    if (this._bound) return;
    this._bound = true;

    /* 저장 모드 */
    this.$$mode = () => Array.from(document.querySelectorAll('input[name="db-storage-mode"]'));
    this.$$mode().forEach((r) => {
      r.addEventListener("change", async () => {
        const mode = r.value;
        if (mode === "db" && !this.state.store.dbReady) {
          toast("DB가 준비되지 않았습니다. 먼저 '스키마 생성/점검'을 실행하세요.", "err", 4500);
          this.renderHealth();
          return;
        }
        await this.state.store.saveSettings({ storage_mode: mode });
        this.state.store.mode = mode;
        toast(mode === "db" ? "DB 저장 모드로 전환" : "로컬 모드로 전환", "ok");
        if (this.hooks.onStorageModeChange) this.hooks.onStorageModeChange(mode);
        this.render();
      });
    });

    $("#btn-db-save").addEventListener("click", () => this.savePolicy());
    $("#btn-db-init").addEventListener("click", () => this.dbInit());
    $("#btn-db-seed").addEventListener("click", () => this.dbSeed());
    $("#btn-db-health").addEventListener("click", () => this.renderHealth(true));
    $("#btn-db-export").addEventListener("click", () => this.exportBackup());
    $("#btn-reset-history").addEventListener("click", () => this.reset("history"));
    $("#btn-reset-dict").addEventListener("click", () => this.reset("dictionaries"));
    $("#btn-reset-all").addEventListener("click", () => this.reset("all"));
  },

  open(state) {
    this.state = state;
    $("#db-modal").hidden = false;
    this.render();
    this.renderHealth(true);
  },

  render() {
    const st = this.state.store;
    /* 저장 모드 라디오 */
    const mode = st.settings.storage_mode || "local";
    this.$$mode().forEach((r) => (r.checked = r.value === mode));
    /* 보관 정책 */
    $("#db-keep-history").checked = st.settings.keep_history === "1";
    $("#db-persist-results").checked = st.settings.persist_results === "1";
    $("#db-retention").value = st.settings.retention_limit || "50";
    /* 연결 정보 */
    const h = st.healthInfo || {};
    const isMysql = h.dbKind === "mysql";
    const rows = [
      [isMysql ? "DB 종류" : "D1 바인딩(DB)", h.dbBound ? (isMysql ? "MySQL (로컬)" : "연결됨") : "없음"],
      ["DB 응답", h.dbOk ? "정상" : "실패"],
      ["스키마", h.schemaOk ? "준비됨" : "필요"],
      [isMysql ? "DB 버전" : "SQLite 버전", h.dbVersion || h.sqliteVersion || "-"],
      ["접속 대상", h.dbLabel || "-"],
      ["현재 저장 모드", mode === "db" ? "DB 저장" : "로컬(브라우저)"],
      ["이력 보관 한도", (st.settings.retention_limit || "50") + "건"],
      ["사전 건수", this.countsText(h.counts)],
      ["저장된 분석 이력", (h.counts?._runs ?? 0) + "건"],
    ];
    $("#db-info-table").innerHTML =
      `<tbody>` +
      rows
        .map(
          ([k, v]) =>
            `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`
        )
        .join("") +
      `</tbody>`;

    /* DB 미연결이면 DB 라디오 비활성 */
    this.$$mode().forEach((r) => {
      if (r.value === "db") r.disabled = !h.dbBound;
    });
  },

  countsText(counts) {
    if (!counts) return "-";
    const labels = {
      stopword: "제외",
      security: "키워드",
      pattern: "정규식",
      pattern_type: "유형",
    };
    return Object.entries(labels)
      .map(([k, label]) => `${label} ${counts[k] ?? 0}`)
      .join(" · ");
  },

  async renderHealth(force = false) {
    const box = $("#db-health");
    box.innerHTML = `<div class="hitem"><div class="hlabel">확인 중…</div><div class="hvalue warn">…</div></div>`;
    let h;
    try {
      h = await api.health();
    } catch (e) {
      box.innerHTML = `<div class="hitem"><div class="hlabel">서버 연결</div><div class="hvalue bad">실패</div></div>`;
      return;
    }
    this.state.store.healthInfo = h;
    this.state.store.dbBound = Boolean(h.dbBound);
    this.state.store.dbReady = Boolean(h.dbOk && h.schemaOk);

    const item = (label, value, state) =>
      `<div class="hitem"><div class="hlabel">${label}</div><div class="hvalue ${state}">${value}</div></div>`;

    const isMysql = h.dbKind === "mysql";
    box.innerHTML = [
      item(isMysql ? "MySQL 연결" : "D1 바인딩", h.dbBound ? "연결됨" : "없음", h.dbBound ? "ok" : "bad"),
      item("DB 응답", h.dbOk ? "정상" : "실패", h.dbOk ? "ok" : "bad"),
      item("스키마", h.schemaOk ? "준비됨" : "필요", h.schemaOk ? "ok" : "warn"),
      item("사전", this.countsText(h.counts), "ok"),
      item("분석 이력", `${h.counts?._runs ?? 0}건`, "ok"),
    ].join("");

    this.render();
    this.renderStorageBadgeInHeader();
    if (this.hooks.onRefresh) this.hooks.onRefresh();
  },

  renderStorageBadgeInHeader() {
    const st = this.state.store;
    /* app.js 의 배지 갱신은 훅으로 위임 */
  },

  async savePolicy() {
    const st = this.state.store;
    const body = {
      keep_history: $("#db-keep-history").checked ? "1" : "0",
      persist_results: $("#db-persist-results").checked ? "1" : "0",
      retention_limit: $("#db-retention").value || "50",
    };
    try {
      const r = await st.saveSettings(body);
      $("#db-save-msg").textContent = "저장됨";
      setTimeout(() => ($("#db-save-msg").textContent = ""), 2200);
      toast("보관 정책을 저장했습니다.", "ok");
      this.state.store.settings = { ...st.settings, ...r };
      this.render();
    } catch (e) {
      toast("설정 저장 실패: " + e.message, "err", 4000);
    }
  },

  async dbInit() {
    try {
      setBusy($("#btn-db-init"), true);
      const r = await api.dbInit();
      toast(r.message || "스키마 준비 완료", "ok", 3200);
      await this.renderHealth(true);
    } catch (e) {
      toast("스키마 생성 실패: " + e.message, "err", 5000);
    } finally {
      setBusy($("#btn-db-init"), false);
    }
  },

  async dbSeed() {
    if (!this.state.store.dbReady) return toast("DB가 준비되지 않았습니다.", "err");
    if (!confirm("DB에 기본 사전을 추가할까요? (이미 있는 항목은 건너뜁니다)")) return;
    try {
      setBusy($("#btn-db-seed"), true);
      const r = await api.dbSeed();
      toast(`기본 사전 ${r.inserted}개 추가`, "ok", 3200);
      this.state.dict = await this.state.store.loadDictionary();
      await this.renderHealth(true);
    } catch (e) {
      toast("기본 사전 추가 실패: " + e.message, "err", 5000);
    } finally {
      setBusy($("#btn-db-seed"), false);
    }
  },

  async exportBackup() {
    if (!this.state.store.dbReady) return toast("DB가 준비되지 않았습니다.", "err");
    try {
      const data = await api.dbExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `swa_db_backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast("백업 파일을 내려받았습니다.", "ok");
    } catch (e) {
      toast("백업 실패: " + e.message, "err", 5000);
    }
  },

  async reset(target) {
    if (!this.state.store.dbReady) return toast("DB가 준비되지 않았습니다.", "err");
    const msgs = {
      history: "저장된 분석 이력을 모두 삭제할까요? 되돌릴 수 없습니다.",
      dictionaries: "사용자가 추가/수정한 사전 항목을 지우고 기본값으로 되돌릴까요?",
      all: "모든 데이터(사전 + 이력 + 설정)를 초기 상태로 되돌릴까요? 되돌릴 수 없습니다.",
    };
    if (!confirm(msgs[target])) return;
    if (target === "all") {
      if (prompt('확인을 위해 "초기화" 를 입력하세요.') !== "초기화") {
        return toast("취소했습니다.", "");
      }
    }
    try {
      const r = await api.dbReset(target);
      toast(r.message || "완료", "ok", 3500);
      this.state.dict = await this.state.store.loadDictionary();
      await this.renderHealth(true);
    } catch (e) {
      toast("초기화 실패: " + e.message, "err", 5000);
    }
  },
};

function setBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = busy;
  if (busy) {
    btn.dataset.old = btn.textContent;
    btn.textContent = "처리 중…";
  } else if (btn.dataset.old) {
    btn.textContent = btn.dataset.old;
  }
}
