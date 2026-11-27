# Security Word Analyzer · Web Edition

데스크톱 앱(`main.py` v1.2.0, PySide6)의 **모든 분석 기능을 그대로** 웹으로 옮긴 시스템입니다.
추가로 ① **DB 저장 / 미저장 선택**, ② **DB 설정 화면**, ③ **예외 단어(사전) 관리 고도화** 를 적용했습니다.

- **기술 스택**: Hono + TypeScript · 프론트는 바닐라 JS 모듈 + CDN(Tailwind, SheetJS)
- **DB (2가지 런타임 지원)**
  - **로컬 실행** = Node.js + **MySQL**(`mysql2`) — `start.bat` / `npm run start:local`
  - **클라우드 배포** = Cloudflare Pages/Workers + **D1**(SQLite) — `npm run build && npm run deploy`
  - SQL 실행 계층만 추상화(`SqlDb`)해서 **같은 API 코드가 양쪽에서 동작**합니다.
- **핵심 설계**: 원본 데이터(개인정보 포함 가능)는 **브라우저 밖으로 나가지 않습니다.** 분석 엔진 전체를 브라우저에서 실행하고, 서버(MySQL/D1)는 **사전·설정·이력 메타데이터**만 보관합니다.

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

## 3. 데이터 모델 (MySQL / D1 공통)

같은 테이블 구조를 **로컬 MySQL**과 **배포 D1** 양쪽에 동일하게 생성합니다.

| 테이블 | 주요 컬럼 |
|---|---|
| `dictionaries` | `kind`(stopword·security·pattern·pattern_type), `value`, `pattern`, `category`, `risk`, `enabled`, `note`, `source`(default·user) — 유니크: `(kind, value, pattern)` |
| `app_settings` | `key`, `value` — `storage_mode`, `persist_results`, `retention_limit`, `keep_history` 등 |
| `analysis_runs` | `file_name`, `sheet`, `row_count`, `summary_json`, `created_at` |
| `analysis_results` | `run_id`, `kind`, `payload_json` (옵션: 결과 표 보관 시) — `run_id` FK `ON DELETE CASCADE` |

**MySQL 전용 구현 차이 (자동 처리됨)**

- MySQL은 `TEXT` 컬럼에 바로 UNIQUE 인덱스를 걸 수 없고, 긴 정규식은 인덱스 길이 제한(3072 byte)에 걸립니다.
  → `pattern`의 `MD5` 앞 32자를 **생성 컬럼 `uq_pattern`** 으로 저장해 `(kind, value, uq_pattern)` 유니크 키를 만듭니다.
  (사용자에게는 그대로 `(kind, value, pattern)` 유니크로 동작합니다)
- `INSERT ... ON CONFLICT` → `INSERT ... ON DUPLICATE KEY UPDATE`, `INSERT OR IGNORE` → `INSERT IGNORE`,
  `datetime('now')` → `NOW()`, `sqlite_master` → `information_schema` 로 방언별 자동 변환됩니다.

---

## 4. 사용 방법

1. Excel/CSV를 끌어다 놓기 → 시트 선택
2. **분석 대상 열** 체크(필요 시 조건 필터)
3. **결과 저장 방식** 선택(로컬 / DB)
4. **▶ 분석 시작** → 요약·단어 빈도·보안 분석·상세 Findings 확인
5. **🧠 2차 재분석**, **🧩 패턴 유형** 필요 시 실행
6. **📊 Excel 저장** → 12개 시트 결과 파일

---

## 5. 로컬에서 실행하기 (Windows · MySQL)

> **가장 간단한 방법: 저장소 폴더의 `start.bat` 더블클릭**
> Node 확인 → `.env` 생성 → 패키지 설치 → MySQL 초기화 → 서버 실행을 자동으로 처리합니다.

### 5.1 사전 준비
- **Node.js 20 LTS 이상** (권장 22) — `node -v` 로 확인
- **MySQL 8.0 이상** (또는 MariaDB 10.5+) — 로컬에 설치 후 **서비스 실행 중**이어야 합니다
- **Git** — `git --version`

### 5.2 MySQL 계정 준비 (최초 1회)
MySQL 관리자(`root`)로 접속해 아래를 실행합니다. 비밀번호는 원하는 값으로 바꾸세요.
```sql
CREATE DATABASE IF NOT EXISTS webapp
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'webapp'@'localhost' IDENTIFIED BY 'webapp1234';
GRANT ALL PRIVILEGES ON webapp.* TO 'webapp'@'localhost';
FLUSH PRIVILEGES;
```
> `npm run db:setup` 은 **DB 생성 권한이 있으면 자동으로 DB까지 만들어 줍니다.**
> 권한이 없으면 위 SQL을 먼저 실행하라는 안내가 화면에 출력됩니다.

### 5.3 설치
```bat
git clone https://github.com/choimyungsu/prompt_security.git
cd prompt_security
npm install
```
```bash
# macOS / Linux 는 동일
git clone https://github.com/choimyungsu/prompt_security.git && cd prompt_security && npm install
```

### 5.4 접속 정보 설정
`.env.example` 을 복사해 `.env` 로 저장한 뒤 본인 환경에 맞게 수정합니다.
```bat
copy .env.example .env
```
```ini
PORT=3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=webapp
MYSQL_PASSWORD=webapp1234
MYSQL_DATABASE=webapp
MYSQL_POOL=10
```
> `.env` 는 `.gitignore` 에 포함되어 있어 커밋되지 않습니다.

### 5.5 DB 초기화 (테이블 생성 + 기본 사전 시드)
```bat
npm run db:setup
```
정상 출력 예시:
```
[1/3] 데이터베이스 확인/생성 완료: webapp
[2/3] 테이블 준비 완료: dictionaries, app_settings, analysis_runs, analysis_results
[3/3] 기본 사전 시드: 159건 추가
  - pattern        8건
  - pattern_type   15건
  - security       48건
  - stopword       64건
```

### 5.6 서버 실행
```bat
start.bat
```
또는 명령으로:
```bat
npm run start:local          :: 실행
npm run dev:local            :: 파일 수정 시 자동 재시작
```
→ 브라우저에서 **http://localhost:3000** 접속

정상 기동 시 콘솔:
```
==========================================
  Security Word Analyzer (로컬 실행)
==========================================
  주소   : http://localhost:3000
  DB     : MySQL 8.0.36 @127.0.0.1:3306/webapp
  종료   : Ctrl + C
==========================================
```

### 5.7 정상 동작 확인
```bash
curl http://localhost:3000/api/health
```
```json
{"ok":true,"dbBound":true,"dbOk":true,"schemaOk":true,
 "dbKind":"mysql","dbLabel":"MySQL 8.0.36 @127.0.0.1:3306/webapp",
 "counts":{"stopword":64,"security":48,"pattern":8,"pattern_type":15,"_runs":0}}
```
`dbKind` 가 `mysql`, `schemaOk` 가 `true`, 사전 건수가 채워져 있으면 성공입니다.

### 5.8 자주 발생하는 문제
| 증상 | 원인 / 해결 |
|---|---|
| `[DB 연결 실패] ... ECONNREFUSED` | MySQL 서비스가 꺼져 있음. MySQL 을 시작한 뒤 다시 실행 |
| `ER_ACCESS_DENIED_ERROR` | 계정/비밀번호 불일치. `.env` 의 `MYSQL_USER`/`MYSQL_PASSWORD` 확인 |
| `ER_BAD_DB_ERROR` | DB 없음. `npm run db:setup` 실행 (또는 5.2 SQL 실행) |
| `[안내] DB 초기화에 실패했습니다` | DB 생성 권한 없음. 5.2 의 관리자 SQL 을 먼저 실행 |
| `Port 3000 is in use` | `.env` 의 `PORT` 를 `3100` 등으로 변경 |
| 사전이 전부 비어 보임 | 브라우저 개발자도구 → Application → Local Storage 삭제 후 새로고침 |
| Excel 업로드가 안 됨 | SheetJS CDN 차단 환경. 오프라인이면 CSV로 진행 |

### 5.9 (대안) Cloudflare 런타임으로 로컬 실행 — D1 사용
MySQL 없이 배포 환경과 동일하게 띄우려면:
```bash
npm run build
npx wrangler pages dev dist --d1=DB --local --ip 0.0.0.0 --port 3000
```
- D1은 `.wrangler/state/v3/d1/` 에 SQLite 파일로 자동 생성되며, 첫 요청 시 스키마·기본 사전이 자동 준비됩니다.
- 스키마부터 초기화: `rm -rf .wrangler/state/v3/d1`

### 5.10 테스트
```bash
node tests/engine.test.mjs   # 분석 엔진 34개 (로직 정합성)
node tests/export.test.mjs   # Excel 생성 27개 (12시트/제약처리)
```

**검증 결과 (2026-11-27)**
- 엔진 **34/34** · Excel **27/27** · 브라우저 통합 **31/31**
- **MySQL 백엔드 API 통합 51/51** (health·사전 CRUD·upsert 중복·정규식 검증·bulk·이력·정리·백업·초기화 3종)
- **D1 경로 회귀 검증 통과** (`dbKind:"sqlite"`, 사전 4종 시드 유지)

---

## 6. 미구현 / 다음 단계

- [ ] **Cloudflare 배포** — 배포 경로 선택 필요(아래 안내)
- [ ] MySQL 접속 정보를 UI에서 입력하는 화면 (현재는 `.env` 파일로만 설정)
- [ ] MySQL SSL/TLS 접속 옵션 (원격 DB 사용 시)
- [ ] 대용량(수십만 행) 파일용 Web Worker 이관 (현재는 UI 양보 방식으로 진행률 표시)
- [ ] 이력 비교 대시보드(회차 간 신규 탐지 항목 diff)
- [ ] 사전 버전 관리(변경 이력 롤백)
- [ ] 인증 기반 접근 제어(현재 공개 접근)

## 7. 실행/배포 상태

| 구분 | DB | 상태 |
|---|---|---|
| 로컬 실행 (Windows · `start.bat`) | **MySQL** | ✅ 검증 완료 (API 통합 51/51) |
| 로컬 실행 (Cloudflare 런타임) | D1 (로컬 SQLite) | ✅ 검증 완료 |
| 클라우드 배포 | D1 (Cloudflare) | ❌ 미배포 — 배포 경로 선택 필요 |

> **왜 로컬은 MySQL, 배포는 D1인가?**
> Cloudflare Workers 런타임은 TCP 소켓을 열 수 없어 MySQL에 직접 접속할 수 없습니다.
> 그래서 SQL 실행 계층(`src/lib/dbtypes.ts` 의 `SqlDb`)만 추상화해
> **로컬은 `mysql2`(MySQL), 배포는 D1** 드라이버를 끼우는 구조로 만들었습니다.
> API·사업 로직은 `src/routes/api.ts` 한 벌로 양쪽에서 동일하게 동작합니다.

**파일 구성 (DB 관련)**

```
src/lib/dbtypes.ts        SqlDb 인터페이스 (방언 중립)
src/lib/d1adapter.ts      D1 → SqlDb 어댑터 (배포용)
src/lib/mysqladapter.ts   MySQL → SqlDb 어댑터 (로컬용)
src/lib/db.ts             스키마·시드·설정 (방언별 SQL 자동 분기)
src/routes/api.ts         REST API (DB 종류 무관)
src/index.tsx             Cloudflare 진입점 (D1)
src/server/node.ts        로컬 진입점 (MySQL)
scripts/db-setup.ts       MySQL DB/테이블/시드 초기화
start.bat                 Windows 원클릭 실행
.env.example              접속 정보 템플릿
```

- **마지막 업데이트**: 2026-11-27
