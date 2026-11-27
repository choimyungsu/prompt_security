# Security Word Analyzer · Web Edition

데스크톱 앱(`main.py` v1.2.0, PySide6)의 **모든 분석 기능을 그대로** 웹으로 옮긴 시스템입니다.
추가로 ① **DB 저장 / 미저장 선택**, ② **DB 설정 화면**, ③ **예외 단어(사전) 관리 고도화** 를 적용했습니다.

- **기술 스택**: Hono + TypeScript + Cloudflare Pages/Workers + D1(SQLite) · 프론트는 바닐라 JS 모듈 + CDN(Tailwind, SheetJS)
- **핵심 설계**: 원본 데이터(개인정보 포함 가능)는 **브라우저 밖으로 나가지 않습니다.** 분석 엔진 전체를 브라우저에서 실행하고, 서버(D1)는 **사전·설정·이력 메타데이터**만 보관합니다.

---

## 1. 완성된 기능

### 분석 (원본과 동일 로직 이식)
| 기능 | 설명 |
|---|---|
| 1차 단어 빈도 | 한글/영문/숫자 토큰 빈도, 포함 열, **원본 행 번호** 유지 |
| 보안 분석 | 사전 키워드(부분일치) + 정규식 패턴 탐지, 위험도 정렬 |
| 상세 Findings | 셀 단위 탐지 내역, **원문 마스킹** 토글 |
| 2차 재분석 | 조사/어미 제거로 단어 통합(`생성이/생성을/생성은 → 생성`), **2~4단어 보안문구 후보** 추출 |
| 패턴 유형 분석 | `PJT-2026-12345` / `PJT-2025-11111` → 같은 유형으로 집계, 사전에 없으면 **자동형태**(`A{3}-d{3+}`) |
| 조건 필터 | 특정 열의 정확 일치 행만 분석(행 번호는 원본 유지) |
| 파일 | Excel(.xlsx/.xls) 다중 시트, CSV **인코딩 자동감지**(UTF-8/EUC-KR/CP949) + **구분자 자동감지**(`,` `TAB` `;` `\|`) |
| Excel 내보내기 | 원본과 동일한 **12개 시트**, 32,767자 초과 셀 자동 분할, 제어문자 제거, 시트명 규칙 준수 |
| CSV 내보내기 | 단어/보안/Findings 개별 저장 |

### DB 저장 여부 선택 + DB 설정 화면 (신규)
- **로컬 모드**: 사전·결과를 브라우저(localStorage)에만 보관. 서버 전송 없음 → 개인정보 데이터에 안전
- **DB 저장 모드**: Cloudflare D1에 사전/설정/분석 이력 보관
- **결과 표까지 보관** 옵션(기본 OFF — 용량 절약), **이력 보관 최대 건수** 자동 정리
- DB 설정 화면: 연결 진단(바인딩/응답/스키마/건수), 스키마 생성, 기본 사전 채우기, JSON 전체 백업, 초기화 3종(이력/사전/전체)

### 예외 단어(사전) 관리 고도화 (신규)
- 4종 사전을 **표에서 바로 인라인 편집** → 포커스 이탈 시 **자동 저장**
- **빠른 추가** 한 줄 입력 + **붙여넣기 일괄 등록**(탭/쉼표, 미리보기·오류 검출)
- **CSV 가져오기/내보내기**, 정규식 **실시간 유효성 검증**(입력 테두리 색)
- 행 삭제 없이 **사용/미사용 토글**, 검색, 선택 삭제
- **로컬 ↔ DB 동기화**(올리기/가져오기), 기본값 복원

---

## 2. API 엔드포인트

| Method | Path | 설명 |
|---|---|---|
| GET | `/api/health` | DB 바인딩/응답/스키마/사전 건수 진단 (스키마 자동 준비) |
| GET | `/api/dict-defaults` | 기본 사전 4종(DB 없이도 동작) |
| GET/POST | `/api/settings` | 저장 모드·보관 정책 조회/저장 |
| POST | `/api/db/init` `/db/seed` `/db/reset` | 스키마 준비 / 기본 사전 / 초기화(`history`·`dictionaries`·`all`) |
| GET | `/api/db/export` | 전체 백업(사전+설정+이력) |
| GET/POST | `/api/dict` | 사전 조회(`?kind=&q=&enabled=1`) / 추가·갱신 |
| POST | `/api/dict/bulk` | 일괄 등록(`replace` 지원) |
| PUT/DELETE | `/api/dict/:id` | 개별 수정/삭제 |
| POST | `/api/dict/delete` | 다중 삭제 |
| POST/GET | `/api/runs` | 분석 이력 저장 / 목록 |
| GET/DELETE | `/api/runs/:id` | 이력 상세(결과 포함) / 삭제 |

---

## 3. 데이터 모델 (D1)

| 테이블 | 주요 컬럼 |
|---|---|
| `dictionaries` | `kind`(stopword·security·pattern·pattern_type), `value`, `pattern`, `category`, `risk`, `enabled`, `note`, `source`(default·user) — 유니크: `(kind, value, pattern)` |
| `app_settings` | `key`, `value` — `storage_mode`, `persist_results`, `retention_limit`, `keep_history` 등 |
| `analysis_runs` | `file_name`, `sheet`, `row_count`, `summary_json`, `created_at` |
| `analysis_results` | `run_id`, `kind`, `payload_json` (옵션: 결과 표 보관 시) |

---

## 4. 사용 방법

1. Excel/CSV를 끌어다 놓기 → 시트 선택
2. **분석 대상 열** 체크(필요 시 조건 필터)
3. **결과 저장 방식** 선택(로컬 / DB)
4. **▶ 분석 시작** → 요약·단어 빈도·보안 분석·상세 Findings 확인
5. **🧠 2차 재분석**, **🧩 패턴 유형** 필요 시 실행
6. **📊 Excel 저장** → 12개 시트 결과 파일

---

## 5. 로컬 개발

```bash
npm run build
npx wrangler pages dev dist --d1=DB --local --ip 0.0.0.0 --port 3000
# 또는
pm2 start ecosystem.config.cjs
```

### 테스트
```bash
node tests/engine.test.mjs   # 분석 엔진 34개 (로직 정합성)
node tests/export.test.mjs   # Excel 생성 27개 (12시트/제약처리)
```
> 브라우저 통합 테스트: `tests/selftest.html` (개발 서버의 `/static/`에 복사해 실행)

**검증 결과: 엔진 34/34 · Excel 27/27 · 브라우저 통합 31/31 통과**

---

## 6. 미구현 / 다음 단계

- [ ] **Cloudflare 배포** — 배포 경로 선택 필요(아래 안내)
- [ ] 대용량(수십만 행) 파일용 Web Worker 이관 (현재는 UI 양보 방식으로 진행률 표시)
- [ ] 이력 비교 대시보드(회차 간 신규 탐지 항목 diff)
- [ ] 사전 버전 관리(변경 이력 롤백)
- [ ] 인증 기반 접근 제어(현재 공개 접근)

## 7. 배포 상태

- **플랫폼**: Cloudflare Pages + D1 (로컬 개발 서버 검증 완료)
- **상태**: ❌ 미배포 — 배포 방식 2가지(① 본인 Cloudflare 계정 ② Genspark 호스팅) 중 선택 필요
- **마지막 업데이트**: 2026-11-27
