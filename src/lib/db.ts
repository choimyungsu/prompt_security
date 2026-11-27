import {
  DEFAULT_PATTERN_TYPES,
  DEFAULT_PATTERNS,
  DEFAULT_SECURITY,
  DEFAULT_STOPWORDS,
} from './defaults'

export type DictKind = 'stopword' | 'security' | 'pattern' | 'pattern_type'

export const DICT_KINDS: DictKind[] = ['stopword', 'security', 'pattern', 'pattern_type']

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
 */
export const SCHEMA_STATEMENTS = [
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_dict_unique
     ON dictionaries(kind, value, pattern)`,
  `CREATE INDEX IF NOT EXISTS idx_dict_kind ON dictionaries(kind, enabled)`,
  `CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runs_created ON analysis_runs(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS analysis_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    row_total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_results_run ON analysis_results(run_id, kind)`,
]

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
    category: kind === 'pattern' || kind === 'pattern_type' ? String(row[2] ?? '') : String(row[1] ?? ''),
    risk: kind === 'pattern' || kind === 'pattern_type' ? String(row[3] ?? '') : String(row[2] ?? ''),
    note: '',
    enabled: 1,
    source: 'default',
  }))
}

export async function ensureSchema(db: D1Database): Promise<void> {
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.prepare(stmt).run()
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await db
      .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`)
      .bind(k, v)
      .run()
  }
  const seeded = await db
    .prepare(`SELECT value FROM app_settings WHERE key = 'seeded'`)
    .first<{ value: string }>()
  if (seeded?.value === '1') return
  await seedDefaults(db)
  await setSetting(db, 'seeded', '1')
}

export async function seedDefaults(
  db: D1Database,
  kinds: DictKind[] = DICT_KINDS
): Promise<number> {
  let inserted = 0
  for (const kind of kinds) {
    const items = defaultItemsFor(kind)
    const stmts: D1PreparedStatement[] = []
    for (const it of items) {
      if (!it.value) continue
      stmts.push(
        db
          .prepare(
            `INSERT INTO dictionaries (kind, value, pattern, category, risk, note, source)
             VALUES (?, ?, ?, ?, ?, '', 'default')
             ON CONFLICT(kind, value, pattern) DO NOTHING`
          )
          .bind(kind, it.value, it.pattern, it.category, it.risk)
      )
    }
    for (let i = 0; i < stmts.length; i += 40) {
      const res = await db.batch(stmts.slice(i, i + 40))
      inserted += res.reduce((a, r) => a + (r.meta?.changes ?? 0), 0)
    }
  }
  return inserted
}

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await db
    .prepare(`SELECT key, value FROM app_settings`)
    .all<{ key: string; value: string }>()
  const out: Record<string, string> = { ...DEFAULT_SETTINGS }
  for (const r of rows.results || []) out[r.key] = r.value
  return out
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
    )
    .bind(key, value)
    .run()
}

export async function pruneHistory(db: D1Database, limit: number): Promise<number> {
  const lim = Math.max(1, Math.min(5000, Number(limit) || 50))
  const res = await db
    .prepare(
      `DELETE FROM analysis_runs WHERE id NOT IN (
         SELECT id FROM analysis_runs ORDER BY datetime(created_at) DESC, id DESC LIMIT ?
       )`
    )
    .bind(lim)
    .run()
  return res.meta?.changes ?? 0
}

/** 정규식 유효성 검사 (D1/Worker 런타임에서 RegExp 생성 가능) */
export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}
