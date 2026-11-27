import {
  DEFAULT_PATTERN_TYPES,
  DEFAULT_PATTERNS,
  DEFAULT_SECURITY,
  DEFAULT_STOPWORDS,
} from './defaults'
import type { Dialect, SqlDb } from './dbtypes'

export type DictKind = 'stopword' | 'security' | 'pattern' | 'pattern_type'

export const DICT_KINDS: DictKind[] = ['stopword', 'security', 'pattern', 'pattern_type']

export const TABLES = ['dictionaries', 'app_settings', 'analysis_runs', 'analysis_results']

/* -------------------------------------------------------------------------- */
/* 방언별 SQL 조각                                                             */
/* -------------------------------------------------------------------------- */

/** 현재 시각 함수 */
export const nowFn = (d: Dialect) => (d === 'mysql' ? 'NOW()' : `datetime('now')`)

/** MySQL 예약어(key) 및 안전한 식별자 인용 */
export const col = (name: string, d: Dialect) => (d === 'mysql' ? `\`${name}\`` : name)

/** 사전 upsert — (kind, value, pattern) 충돌 시 갱신 */
export function upsertDictSql(d: Dialect): string {
  const n = nowFn(d)
  if (d === 'mysql') {
    return `INSERT INTO dictionaries (kind, value, pattern, category, risk, note, source)
            VALUES (?,?,?,?,?,?,'user')
            ON DUPLICATE KEY UPDATE
              category = VALUES(category),
              risk = VALUES(risk),
              note = IF(VALUES(note) = '', note, VALUES(note)),
              enabled = 1,
              updated_at = ${n}`
  }
  return `INSERT INTO dictionaries (kind, value, pattern, category, risk, note, source)
          VALUES (?,?,?,?,?,?,'user')
          ON CONFLICT(kind, value, pattern) DO UPDATE SET
            category = excluded.category,
            risk = excluded.risk,
            note = CASE WHEN excluded.note = '' THEN dictionaries.note ELSE excluded.note END,
            enabled = 1,
            updated_at = ${n}`
}

/**
 * 시드/일괄추가용 — 이미 있으면 건너뛴다.
 *  source 는 호출자가 지정한다.
 *   · 'default' : 기본 사전 시드  → 사전 초기화(reset) 시 다시 채워짐
 *   · 'user'    : 사용자가 추가한 항목 → reset 시 제거 대상
 */
export function insertIgnoreDictSql(d: Dialect, source: 'default' | 'user' = 'default'): string {
  const src = source === 'user' ? 'user' : 'default'
  if (d === 'mysql') {
    return `INSERT IGNORE INTO dictionaries (kind, value, pattern, category, risk, note, source)
            VALUES (?,?,?,?,?,'','${src}')`
  }
  return `INSERT INTO dictionaries (kind, value, pattern, category, risk, note, source)
          VALUES (?,?,?,?,?,'','${src}')
          ON CONFLICT(kind, value, pattern) DO NOTHING`
}

/** 설정 upsert */
export function upsertSettingSql(d: Dialect): string {
  const n = nowFn(d)
  if (d === 'mysql') {
    return `INSERT INTO app_settings (\`key\`, value, updated_at) VALUES (?,?,${n})
            ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = ${n}`
  }
  return `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,${n})
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ${n}`
}

export function insertSettingSql(d: Dialect): string {
  if (d === 'mysql') {
    return `INSERT IGNORE INTO app_settings (\`key\`, value, updated_at) VALUES (?,?,${nowFn(d)})`
  }
  return `INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,${nowFn(d)})
          ON CONFLICT(key) DO NOTHING`
}

/** 최근순 정렬 */
export const orderByCreatedDesc = (d: Dialect, alias = '') =>
  d === 'mysql'
    ? `${alias}created_at DESC, ${alias}id DESC`
    : `datetime(${alias}created_at) DESC, ${alias}id DESC`

/* -------------------------------------------------------------------------- */
/* 스키마                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 사전 테이블 구조
 *  kind      : stopword | security | pattern | pattern_type
 *  value     : 단어 / 패턴 이름 / 유형 이름
 *  pattern   : 정규식 (pattern, pattern_type 에서만 사용)
 *  category  : 분류 (개인정보, 인증정보 …)
 *  risk      : 위험도 (매우 높음 / 높음 / 중간 / 주의 / 낮음)
 *  enabled   : 사용 여부 (0/1) — 행을 지우지 않고 끄고 켤 수 있다
 *  note      : 메모
 *  source    : default | user  (기본값 복원 시 user 만 지우기 위함)
 *
 * MySQL 은 TEXT 컬럼에 UNIQUE 인덱스를 바로 걸 수 없어서,
 * pattern 의 MD5(32자) 를 생성 컬럼으로 만들어 유니크 키에 포함시킨다.
 * (긴 정규식도 3072 byte 인덱스 제한에 걸리지 않는다)
 */
export function schemaStatements(d: Dialect): string[] {
  const n = nowFn(d)
  if (d === 'mysql') {
    return [
      `CREATE TABLE IF NOT EXISTS dictionaries (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        kind VARCHAR(32) NOT NULL,
        value VARCHAR(512) NOT NULL,
        pattern TEXT NOT NULL,
        uq_pattern VARCHAR(32) GENERATED ALWAYS AS (LEFT(MD5(pattern), 32)) STORED,
        category VARCHAR(255) NOT NULL DEFAULT '',
        risk VARCHAR(64) NOT NULL DEFAULT '',
        enabled TINYINT NOT NULL DEFAULT 1,
        note TEXT NOT NULL,
        source VARCHAR(16) NOT NULL DEFAULT 'user',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_dict (kind, value, uq_pattern),
        KEY idx_dict_kind (kind, enabled)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS app_settings (
        \`key\` VARCHAR(128) NOT NULL,
        value TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS analysis_runs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        file_name VARCHAR(512) NOT NULL DEFAULT '',
        sheet VARCHAR(255) NOT NULL DEFAULT '',
        storage_mode VARCHAR(16) NOT NULL DEFAULT 'db',
        row_count INT NOT NULL DEFAULT 0,
        column_count INT NOT NULL DEFAULT 0,
        columns_json MEDIUMTEXT NOT NULL,
        summary_json MEDIUMTEXT NOT NULL,
        label VARCHAR(255) NOT NULL DEFAULT '',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_runs_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS analysis_results (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        run_id BIGINT UNSIGNED NOT NULL,
        kind VARCHAR(64) NOT NULL,
        payload_json LONGTEXT NOT NULL,
        row_total INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_results_run (run_id, kind),
        CONSTRAINT fk_results_run FOREIGN KEY (run_id)
          REFERENCES analysis_runs (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    ]
  }
  /* SQLite (Cloudflare D1) */
  return [
    `CREATE TABLE IF NOT EXISTS dictionaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      pattern TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL DEFAULT (${n}),
      updated_at TEXT NOT NULL DEFAULT (${n})
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_dict_unique
       ON dictionaries(kind, value, pattern)`,
    `CREATE INDEX IF NOT EXISTS idx_dict_kind ON dictionaries(kind, enabled)`,
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (${n})
    )`,
    `CREATE TABLE IF NOT EXISTS analysis_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL DEFAULT '',
      sheet TEXT NOT NULL DEFAULT '',
      storage_mode TEXT NOT NULL DEFAULT 'db',
      row_count INTEGER NOT NULL DEFAULT 0,
      column_count INTEGER NOT NULL DEFAULT 0,
      columns_json TEXT NOT NULL DEFAULT '[]',
      summary_json TEXT NOT NULL DEFAULT '{}',
      label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (${n})
    )`,
    `CREATE INDEX IF NOT EXISTS idx_runs_created ON analysis_runs(created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS analysis_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      row_total INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (${n}),
      FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
    )`,
    `CREATE INDEX IF NOT EXISTS idx_results_run ON analysis_results(run_id, kind)`,
  ]
}

/** 하위 호환: SQLite(D1) 기준 스키마 */
export const SCHEMA_STATEMENTS = schemaStatements('sqlite')

export const DEFAULT_SETTINGS: Record<string, string> = {
  storage_mode: 'local',
  persist_results: '0',
  retention_limit: '50',
  keep_history: '1',
  default_allow_space: '1',
  default_min_len: '2',
  seeded: '0',
}

export function defaultsFor(kind: DictKind): string[][] {
  if (kind === 'security') return DEFAULT_SECURITY
  if (kind === 'pattern') return DEFAULT_PATTERNS
  if (kind === 'pattern_type') return DEFAULT_PATTERN_TYPES
  return DEFAULT_STOPWORDS.map((w) => [w])
}

/** 사전 종류별 기본값을 공통 아이템 형태로 변환 (프론트/백 공용 규격). */
export function defaultItemsFor(kind: DictKind) {
  return defaultsFor(kind).map((row) => ({
    kind,
    value: String(row[0] ?? '').trim(),
    pattern: kind === 'pattern' || kind === 'pattern_type' ? String(row[1] ?? '') : '',
    category:
      kind === 'pattern' || kind === 'pattern_type' ? String(row[2] ?? '') : String(row[1] ?? ''),
    risk: kind === 'pattern' || kind === 'pattern_type' ? String(row[3] ?? '') : String(row[2] ?? ''),
    note: '',
    enabled: 1,
    source: 'default',
  }))
}

/* -------------------------------------------------------------------------- */
/* 스키마 준비 / 시드                                                          */
/* -------------------------------------------------------------------------- */

export async function ensureSchema(db: SqlDb): Promise<void> {
  for (const stmt of schemaStatements(db.dialect)) {
    await db.run(stmt)
  }
  const insSetting = insertSettingSql(db.dialect)
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await db.run(insSetting, [k, v])
  }
  const seeded = await db.first<{ value: string }>(
    `SELECT value FROM app_settings WHERE ${col('key', db.dialect)} = 'seeded'`
  )
  if (seeded?.value === '1') return
  await seedDefaults(db)
  await setSetting(db, 'seeded', '1')
}

export async function seedDefaults(db: SqlDb, kinds: DictKind[] = DICT_KINDS): Promise<number> {
  const sql = insertIgnoreDictSql(db.dialect, 'default')
  let inserted = 0
  for (const kind of kinds) {
    const items = defaultItemsFor(kind)
    const stmts = items
      .filter((it) => it.value)
      .map((it) => ({
        sql,
        params: [kind, it.value, it.pattern, it.category, it.risk] as unknown[],
      }))
    for (let i = 0; i < stmts.length; i += 40) {
      const res = await db.batch(stmts.slice(i, i + 40))
      inserted += res.reduce((a, r) => a + (r.changes ?? 0), 0)
    }
  }
  return inserted
}

export async function getSettings(db: SqlDb): Promise<Record<string, string>> {
  const rows = await db.all<{ key: string; value: string }>(
    `SELECT ${col('key', db.dialect)} AS ${col('key', db.dialect)}, value FROM app_settings`
  )
  const out: Record<string, string> = { ...DEFAULT_SETTINGS }
  for (const r of rows || []) out[r.key] = r.value
  return out
}

export async function setSetting(db: SqlDb, key: string, value: string): Promise<void> {
  await db.run(upsertSettingSql(db.dialect), [key, value])
}

export async function pruneHistory(db: SqlDb, limit: number): Promise<number> {
  const lim = Math.max(1, Math.min(5000, Number(limit) || 50))
  if (db.dialect === 'mysql') {
    /* MySQL 은 서브쿼리 안에서 같은 테이블 LIMIT 을 못 쓰므로 파생 테이블로 감싼다 */
    const r = await db.run(
      `DELETE FROM analysis_runs WHERE id NOT IN (
         SELECT id FROM (
           SELECT id FROM analysis_runs ORDER BY created_at DESC, id DESC LIMIT ?
         ) AS keep
       )`,
      [lim]
    )
    return r.changes
  }
  const r = await db.run(
    `DELETE FROM analysis_runs WHERE id NOT IN (
       SELECT id FROM analysis_runs ORDER BY datetime(created_at) DESC, id DESC LIMIT ?
     )`,
    [lim]
  )
  return r.changes
}

/** 실제로 존재하는 테이블 목록 */
export async function listTables(db: SqlDb): Promise<string[]> {
  if (db.dialect === 'mysql') {
    const rows = await db.all<{ name: string }>(
      `SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`
    )
    return (rows || []).map((r) => r.name)
  }
  const rows = await db.all<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  )
  return (rows || []).map((r) => r.name)
}

/** 정규식 유효성 검사 */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}
