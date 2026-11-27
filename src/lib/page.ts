import { APP_VERSION } from '../lib/defaults'

export function renderPage(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Security Word Analyzer · Web v${APP_VERSION}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%94%90%3C/text%3E%3C/svg%3E" />
<!-- 외부 CDN 미사용: 모든 스타일은 /static/style.css 에 직접 정의되어 있습니다 (오프라인 동작) -->
<link rel="stylesheet" href="/static/style.css" />
<script src="/static/app.js" type="module"></script>
</head>
<body>
<header class="app-header">
  <div class="header-inner">
    <div class="brand">
      <span class="brand-icon">🔐</span>
      <div>
        <h1>SECURITY WORD ANALYZER</h1>
        <p class="brand-sub">웹 기반 데이터 보안 단어·패턴 분석 시스템 · v${APP_VERSION}</p>
      </div>
    </div>
    <div class="header-actions">
      <div id="db-status" class="status-chip status-unknown" title="데이터베이스 연결 상태">
        <span class="dot"></span><span id="db-status-text">DB 확인 중…</span>
      </div>
      <button id="btn-dict" class="btn btn-ghost" type="button">⚙ 분석 사전</button>
      <button id="btn-dbsettings" class="btn btn-ghost" type="button">🗄 DB 설정</button>
      <button id="btn-help" class="btn btn-ghost" type="button">? 사용법</button>
    </div>
  </div>
</header>

<main class="layout">
  <!-- ===================== 분석 조건 패널 ===================== -->
  <section class="panel" id="panel-input">
    <h2 class="panel-title">1. 데이터 업로드</h2>

    <div id="dropzone" class="dropzone">
      <input id="file-input" type="file" accept=".xlsx,.xls,.csv,.txt" hidden />
      <div class="dz-icon">📂</div>
      <p class="dz-main">Excel(.xlsx/.xls) 또는 CSV 파일을 끌어다 놓거나 클릭하세요</p>
      <p class="dz-sub">모든 분석은 브라우저 안에서 수행됩니다 · 원본 데이터는 서버로 전송되지 않습니다</p>
      <p id="file-info" class="dz-file"></p>
    </div>

    <div class="grid grid-2 mt">
      <div class="field">
        <label for="sheet-select">시트</label>
        <select id="sheet-select"><option value="">파일을 먼저 선택하세요</option></select>
      </div>
      <div class="field">
        <label for="filter-col">조건 필터 필드 <span class="hint-inline">(선택)</span></label>
        <select id="filter-col"><option value="">(사용 안 함)</option></select>
      </div>
      <div class="field">
        <label for="filter-value">정확한 일치값</label>
        <input id="filter-value" type="text" placeholder="예: 보안팀" />
      </div>
      <div class="field">
        <label for="filter-preview">필터 미리보기</label>
        <div id="filter-preview" class="filter-preview">필터를 사용하면 일치하는 행만 분석합니다.</div>
      </div>
    </div>

    <div class="field mt">
      <div class="row-between">
        <label>분석 대상 열 <span id="col-count" class="hint-inline"></span></label>
        <div class="mini-actions">
          <button id="btn-col-all" class="btn btn-mini" type="button">전체 선택</button>
          <button id="btn-col-none" class="btn btn-mini" type="button">전체 해제</button>
          <input id="col-search" class="mini-input" type="text" placeholder="열 검색" />
        </div>
      </div>
      <div id="column-list" class="column-list"><p class="empty-note">파일을 선택하면 컬럼이 표시됩니다.</p></div>
    </div>

    <h2 class="panel-title mt">2. 분석 옵션</h2>
    <div class="grid grid-2">
      <div class="field">
        <label for="opt-minlen">최소 단어 길이</label>
        <input id="opt-minlen" type="number" min="1" max="20" value="2" />
      </div>
      <div class="field">
        <label for="opt-minfreq">표시 최소 빈도</label>
        <input id="opt-minfreq" type="number" min="1" value="1" />
      </div>
    </div>
    <div class="check-row mt-sm">
      <label class="check"><input id="opt-space" type="checkbox" checked /> 띄어쓰기 1회 허용</label>
      <label class="check"><input id="opt-ptype" type="checkbox" checked /> 패턴 유형 동시 집계</label>
    </div>

    <div class="save-mode-box mt">
      <div class="save-mode-head">
        <strong>결과 저장 방식</strong>
        <span class="hint-inline">분석할 때마다 이 선택이 기본값이 됩니다</span>
      </div>
      <label class="radio-card">
        <input type="radio" name="storage-mode" value="local" checked />
        <div>
          <span class="radio-title">로컬 모드 (DB 미사용)</span>
          <span class="radio-desc">결과를 브라우저에만 보관합니다. 원본·결과 모두 서버에 저장되지 않아 개인정보 포함 데이터에 안전합니다.</span>
        </div>
      </label>
      <label class="radio-card">
        <input type="radio" name="storage-mode" value="db" />
        <div>
          <span class="radio-title">DB 저장 모드</span>
          <span class="radio-desc">분석 요약/이력을 DB에 남겨 나중에 다시 조회할 수 있습니다. 원본 셀 값은 저장하지 않습니다.</span>
        </div>
      </label>
      <label class="check mt-sm" id="persist-wrap">
        <input id="opt-persist" type="checkbox" /> 결과 표(단어·탐지·재분석)까지 DB에 보관
      </label>
    </div>

    <div class="action-row mt">
      <button id="btn-analyze" class="btn btn-primary" type="button" disabled>▶ 분석 시작</button>
      <button id="btn-export" class="btn btn-secondary" type="button" disabled>📊 Excel 저장</button>
      <button id="btn-export-csv" class="btn btn-ghost" type="button" disabled>CSV 저장</button>
      <button id="btn-save-db" class="btn btn-ghost" type="button" disabled>🗄 지금 DB에 저장</button>
    </div>
    <div class="progress-wrap mt-sm">
      <div class="progress"><div id="progress-bar" class="progress-bar" style="width:0%"></div></div>
      <p id="status-text" class="status-text">대기 중</p>
    </div>
  </section>

  <!-- ===================== 결과 패널 ===================== -->
  <section class="panel panel-results">
    <div class="tabs" id="tabs">
      <button class="tab active" data-tab="summary" type="button">📌 요약</button>
      <button class="tab" data-tab="words" type="button">🔤 단어 빈도</button>
      <button class="tab" data-tab="security" type="button">🛡 보안 분석</button>
      <button class="tab" data-tab="findings" type="button">🔎 상세 Findings</button>
      <button class="tab" data-tab="reanalysis" type="button">🧠 2차 재분석</button>
      <button class="tab" data-tab="ptype" type="button">🧩 패턴 유형</button>
      <button class="tab" data-tab="history" type="button">🗄 분석 이력</button>
    </div>

    <div class="tab-body">
      <!-- 요약 -->
      <div class="tab-pane active" data-pane="summary">
        <div id="summary-cards" class="cards"></div>
        <div id="summary-table" class="table-wrap"></div>
        <div id="risk-bars" class="risk-bars mt"></div>
      </div>

      <!-- 단어 빈도 -->
      <div class="tab-pane" data-pane="words">
        <div class="toolbar">
          <input id="words-search" class="mini-input wide" type="text" placeholder="단어 검색" />
          <select id="words-sort" class="mini-input">
            <option value="freq">빈도순</option>
            <option value="row">행수순</option>
            <option value="alpha">가나다순</option>
          </select>
          <span id="words-info" class="hint-inline"></span>
          <button id="btn-words-csv" class="btn btn-mini" type="button">CSV</button>
        </div>
        <div id="words-table" class="table-wrap"></div>
      </div>

      <!-- 보안 분석 -->
      <div class="tab-pane" data-pane="security">
        <div class="toolbar">
          <input id="security-search" class="mini-input wide" type="text" placeholder="항목 검색" />
          <select id="security-risk" class="mini-input">
            <option value="">전체 위험도</option>
            <option value="5">매우 높음</option>
            <option value="4">높음</option>
            <option value="3">중간</option>
            <option value="2">주의</option>
            <option value="1">낮음</option>
          </select>
          <span id="security-info" class="hint-inline"></span>
          <button id="btn-security-csv" class="btn btn-mini" type="button">CSV</button>
        </div>
        <div id="security-table" class="table-wrap"></div>
      </div>

      <!-- 상세 findings -->
      <div class="tab-pane" data-pane="findings">
        <div class="toolbar">
          <input id="findings-search" class="mini-input wide" type="text" placeholder="원문/항목 검색" />
          <select id="findings-method" class="mini-input">
            <option value="">전체 방식</option>
            <option value="키워드">키워드</option>
            <option value="패턴">패턴</option>
          </select>
          <label class="check"><input id="findings-mask" type="checkbox" /> 원문 마스킹</label>
          <span id="findings-info" class="hint-inline"></span>
          <button id="btn-findings-csv" class="btn btn-mini" type="button">CSV</button>
        </div>
        <div id="findings-table" class="table-wrap"></div>
      </div>

      <!-- 2차 재분석 -->
      <div class="tab-pane" data-pane="reanalysis">
        <div class="toolbar wrap">
          <label class="mini-field">최소 빈도 <input id="re-minfreq" type="number" min="1" value="2" /></label>
          <label class="mini-field">최소 길이 <input id="re-minlen" type="number" min="1" max="20" value="2" /></label>
          <label class="mini-field">문구 최소 빈도 <input id="re-phrasefreq" type="number" min="1" value="2" /></label>
          <label class="check"><input id="re-particles" type="checkbox" checked /> 조사 제거/단어 통합</label>
          <label class="check"><input id="re-num" type="checkbox" checked /> 숫자 2자리 제외</label>
          <label class="check"><input id="re-eng" type="checkbox" checked /> 영어 2자리 제외</label>
          <button id="btn-reanalyze" class="btn btn-secondary btn-mini" type="button" disabled>🔍 빈도수 기반 재분석</button>
        </div>
        <p id="re-info" class="hint-block">1차 분석 결과를 기반으로 보안문구 후보를 재분석합니다.</p>
        <h3 class="sub-title">정규화 단어 <span class="legend">🔴 보안 키워드 · 🟡 보안 연관 후보</span></h3>
        <div id="re-words-table" class="table-wrap"></div>
        <h3 class="sub-title">고객 보안문구 후보</h3>
        <div id="re-phrases-table" class="table-wrap"></div>
      </div>

      <!-- 패턴 유형 -->
      <div class="tab-pane" data-pane="ptype">
        <div class="toolbar wrap">
          <label class="mini-field">유형 최소 총출현 <input id="pt-mincount" type="number" min="1" value="2" /></label>
          <label class="mini-field">유형 최소 고유값 <input id="pt-minvalues" type="number" min="1" value="1" /></label>
          <label class="mini-field">유형당 표시 변형 <input id="pt-maxvariants" type="number" min="1" value="200" /></label>
          <label class="check"><input id="pt-auto" type="checkbox" checked /> 사전에 없는 값도 자동형태로 묶기</label>
          <button id="btn-ptype" class="btn btn-secondary btn-mini" type="button" disabled>🧩 패턴 유형 분석</button>
        </div>
        <p id="pt-info" class="hint-block">PJT-2026-12345 / PJT-2025-11111 처럼 문구는 달라도 형식이 같으면 하나의 유형으로 집계합니다.</p>
        <div class="split">
          <div class="split-left">
            <h3 class="sub-title">패턴 유형 요약</h3>
            <div id="ptype-table" class="table-wrap"></div>
          </div>
          <div class="split-right">
            <h3 class="sub-title">선택한 유형의 변형 값</h3>
            <div id="ptype-values-table" class="table-wrap"></div>
          </div>
        </div>
      </div>

      <!-- 이력 -->
      <div class="tab-pane" data-pane="history">
        <div class="toolbar">
          <button id="btn-history-refresh" class="btn btn-mini" type="button">🔄 새로고침</button>
          <span id="history-info" class="hint-inline"></span>
          <button id="btn-history-clear" class="btn btn-mini btn-danger" type="button">이력 전체 삭제</button>
        </div>
        <div id="history-table" class="table-wrap"></div>
        <div id="history-detail" class="history-detail"></div>
      </div>
    </div>
  </section>
</main>

<!-- ===================== 사전 관리 모달 ===================== -->
<div id="dict-modal" class="modal-backdrop" hidden>
  <div class="modal modal-lg">
    <div class="modal-head">
      <h2>⚙ 분석 사전 관리</h2>
      <button class="modal-close" data-close="dict-modal" type="button">✕</button>
    </div>
    <div class="modal-body">
      <div class="dict-topbar">
        <div class="dict-tabs" id="dict-tabs">
          <button class="dict-tab active" data-kind="stopword" type="button">제외 단어 <span class="cnt" id="cnt-stopword"></span></button>
          <button class="dict-tab" data-kind="security" type="button">보안 키워드 <span class="cnt" id="cnt-security"></span></button>
          <button class="dict-tab" data-kind="pattern" type="button">정규식 패턴 <span class="cnt" id="cnt-pattern"></span></button>
          <button class="dict-tab" data-kind="pattern_type" type="button">패턴 유형 <span class="cnt" id="cnt-pattern_type"></span></button>
        </div>
        <div class="dict-storage">
          <span id="dict-storage-badge" class="status-chip status-local">로컬</span>
          <button id="btn-dict-push" class="btn btn-mini" type="button" title="현재 화면의 사전을 DB로 업로드">DB로 올리기</button>
          <button id="btn-dict-pull" class="btn btn-mini" type="button" title="DB 사전을 현재 화면으로 가져오기">DB에서 가져오기</button>
        </div>
      </div>

      <div class="dict-help" id="dict-help"></div>

      <!-- 빠른 추가 -->
      <div class="quick-add">
        <input id="quick-value" class="mini-input" type="text" placeholder="값 (단어 / 정규식 / 유형명)" />
        <input id="quick-category" class="mini-input" type="text" placeholder="분류" />
        <select id="quick-risk" class="mini-input">
          <option value="">위험도</option>
          <option value="매우 높음">매우 높음</option>
          <option value="높음">높음</option>
          <option value="중간">중간</option>
          <option value="주의">주의</option>
          <option value="낮음">낮음</option>
        </select>
        <input id="quick-note" class="mini-input" type="text" placeholder="메모(선택)" />
        <button id="btn-quick-add" class="btn btn-primary btn-mini" type="button">+ 추가</button>
        <span id="quick-msg" class="hint-inline"></span>
      </div>

      <!-- 붙여넣기 일괄 등록 -->
      <details class="bulk-box" id="bulk-box">
        <summary>📋 붙여넣기로 한 번에 등록 (탭/쉼표 구분, 한 줄에 하나)</summary>
        <div class="bulk-body">
          <textarea id="bulk-text" rows="6" spellcheck="false"
            placeholder="주민등록번호&#9;개인정보&#9;매우 높음&#10;계약서&#9;정보등급&#9;높음&#10;(제외 단어는 값만 입력)"></textarea>
          <div class="bulk-actions">
            <label class="check"><input id="bulk-replace" type="checkbox" /> 기존 항목 교체</label>
            <button id="btn-bulk-add" class="btn btn-secondary btn-mini" type="button">일괄 추가</button>
            <button id="btn-bulk-append" class="btn btn-ghost btn-mini" type="button">미리보기</button>
            <span id="bulk-msg" class="hint-inline"></span>
          </div>
          <pre id="bulk-preview" class="bulk-preview" hidden></pre>
        </div>
      </details>

      <div class="dict-table-toolbar">
        <input id="dict-search" class="mini-input wide" type="text" placeholder="검색 (값/분류/메모)" />
        <label class="check"><input id="dict-enabled-only" type="checkbox" /> 사용 중만 보기</label>
        <button id="btn-dict-seed" class="btn btn-mini" type="button">기본값 채우기</button>
        <button id="btn-dict-delete-sel" class="btn btn-mini btn-danger" type="button">선택 삭제</button>
        <button id="btn-dict-export" class="btn btn-mini" type="button">CSV 내보내기</button>
        <label class="btn btn-mini file-btn">CSV 가져오기<input id="dict-import" type="file" accept=".csv,.txt" hidden /></label>
        <span id="dict-table-info" class="hint-inline"></span>
      </div>
      <div id="dict-table" class="table-wrap dict-table-wrap"></div>
    </div>
    <div class="modal-foot">
      <span class="hint-inline">수정한 값은 <strong>자동 저장</strong>됩니다. (입력 후 포커스를 다른 곳으로 옮기면 저장)</span>
      <button class="btn btn-primary" data-close="dict-modal" type="button">닫기</button>
    </div>
  </div>
</div>

<!-- ===================== DB 설정 모달 ===================== -->
<div id="db-modal" class="modal-backdrop" hidden>
  <div class="modal">
    <div class="modal-head">
      <h2>🗄 데이터베이스 설정</h2>
      <button class="modal-close" data-close="db-modal" type="button">✕</button>
    </div>
    <div class="modal-body">
      <div id="db-health" class="db-health"></div>

      <div class="db-section">
        <h3>저장 모드</h3>
        <label class="radio-card compact">
          <input type="radio" name="db-storage-mode" value="local" />
          <div>
            <span class="radio-title">로컬 모드</span>
            <span class="radio-desc">DB를 사용하지 않고 브라우저(localStorage)에만 사전과 결과를 보관합니다.</span>
          </div>
        </label>
        <label class="radio-card compact">
          <input type="radio" name="db-storage-mode" value="db" />
          <div>
            <span class="radio-title">DB 저장 모드</span>
            <span class="radio-desc">사전/설정/분석 이력을 DB(로컬: MySQL / 배포: D1)에 저장합니다.</span>
          </div>
        </label>
      </div>

      <div class="db-section">
        <h3>보관 정책</h3>
        <div class="grid grid-2">
          <label class="check"><input id="db-keep-history" type="checkbox" /> 분석 이력 저장</label>
          <label class="check"><input id="db-persist-results" type="checkbox" /> 결과 표까지 저장 (용량 증가)</label>
        </div>
        <div class="field mt-sm">
          <label for="db-retention">이력 보관 최대 건수</label>
          <input id="db-retention" type="number" min="1" max="5000" value="50" />
        </div>
        <div class="action-row mt-sm">
          <button id="btn-db-save" class="btn btn-primary btn-mini" type="button">설정 저장</button>
          <span id="db-save-msg" class="hint-inline"></span>
        </div>
      </div>

      <div class="db-section">
        <h3>데이터 관리</h3>
        <div class="db-btn-grid">
          <button id="btn-db-init" class="btn btn-ghost btn-mini" type="button">① 스키마 생성/점검</button>
          <button id="btn-db-seed" class="btn btn-ghost btn-mini" type="button">② 기본 사전 채우기</button>
          <button id="btn-db-health" class="btn btn-ghost btn-mini" type="button">③ 연결 진단</button>
          <button id="btn-db-export" class="btn btn-ghost btn-mini" type="button">④ 전체 백업(JSON)</button>
        </div>
        <div class="danger-zone mt">
          <p class="danger-title">데이터 초기화</p>
          <div class="db-btn-grid">
            <button id="btn-reset-history" class="btn btn-mini btn-danger" type="button">분석 이력만 삭제</button>
            <button id="btn-reset-dict" class="btn btn-mini btn-danger" type="button">사전 기본값 복원</button>
            <button id="btn-reset-all" class="btn btn-mini btn-danger" type="button">전체 초기화</button>
          </div>
          <p class="hint-inline">초기화는 되돌릴 수 없습니다. 필요한 데이터는 먼저 백업하세요.</p>
        </div>
      </div>

      <div class="db-section">
        <h3>연결 정보</h3>
        <table class="kv-table" id="db-info-table"></table>
      </div>
    </div>
    <div class="modal-foot">
      <button class="btn btn-primary" data-close="db-modal" type="button">닫기</button>
    </div>
  </div>
</div>

<!-- ===================== 사용법 모달 ===================== -->
<div id="help-modal" class="modal-backdrop" hidden>
  <div class="modal">
    <div class="modal-head">
      <h2>? 사용법</h2>
      <button class="modal-close" data-close="help-modal" type="button">✕</button>
    </div>
    <div class="modal-body help-body">
      <h3>1. 데이터 업로드</h3>
      <p>Excel(.xlsx/.xls) 또는 CSV 파일을 끌어다 놓습니다. CSV는 인코딩(UTF-8/EUC-KR)과 구분자(쉼표/탭/세미콜론)를 자동 판별합니다.</p>
      <h3>2. 분석 대상 열 선택</h3>
      <p>분석할 열만 체크합니다. 조건 필터를 쓰면 특정 필드가 정확히 일치하는 행만 분석합니다.</p>
      <h3>3. 결과 저장 방식 선택</h3>
      <p><strong>로컬 모드</strong>는 DB를 쓰지 않고 브라우저에만 결과를 남깁니다(원본 미전송). <strong>DB 모드</strong>는 요약/이력을 Cloudflare D1에 보관해 나중에 다시 볼 수 있습니다.</p>
      <h3>4. 분석 실행</h3>
      <ul>
        <li><strong>단어 빈도</strong> — 한글/영문/숫자 토큰 빈도와 포함 열·행 번호</li>
        <li><strong>보안 분석</strong> — 사전 키워드 + 정규식 패턴 탐지(위험도 정렬)</li>
        <li><strong>상세 Findings</strong> — 탐지된 셀 단위 내역(원문 포함, 마스킹 지원)</li>
      </ul>
      <h3>5. 2차 재분석</h3>
      <p>"생성이 / 생성을 / 생성은" 처럼 조사만 다른 단어를 하나로 합치고, 보안 키워드가 나온 행에서 2~4단어 보안문구 후보를 뽑습니다.</p>
      <h3>6. 패턴 유형 분석</h3>
      <p>PJT-2026-12345 / PJT-2025-11111 처럼 값은 달라도 형식이 같으면 하나의 유형으로 묶어 고유값·출현 수를 집계합니다. 사전에 없는 값은 자동 형태(A{3}-d{3+})로 묶입니다.</p>
      <h3>7. 사전 관리 (예외 단어)</h3>
      <p>제외 단어/보안 키워드/정규식/패턴 유형을 화면에서 바로 수정·추가할 수 있습니다. 붙여넣기로 수십 줄을 한 번에 등록하고, CSV로 주고받을 수 있습니다. 수정 즉시 자동 저장됩니다.</p>
      <h3>8. 결과 저장</h3>
      <p>Excel 저장 시 원본과 동일한 12개 시트(Summary, Word_Frequency, Security_Analysis, Findings, 사전 3종, 재분석 2종, 패턴 유형 2종)로 내보냅니다.</p>
    </div>
    <div class="modal-foot"><button class="btn btn-primary" data-close="help-modal" type="button">확인</button></div>
  </div>
</div>

<div id="toast" class="toast" hidden></div>
</body>
</html>`
}
