import { Hono } from 'hono'
import {
  DICT_KINDS,
  ensureSchema,
  getSettings,
  isValidRegex,
  pruneHistory,
  SCHEMA_STATEMENTS,
  seedDefaults,
  setSetting,
  getSettings as readSettings,
  type DictKind,
} from '../lib/db'

type Bindings = { DB?: D1Database }

const api = new Hono<{ Bindings: Bindings }>()

/* -------------------------------------------------------------------------- */
/* 공통 헬퍼                                                                   */
/* -------------------------------------------------------------------------- */
function noDb(c: any) {
  return c.json(
    {
      ok: false,
      error: 'no_database',
      message:
        'D1 데이터베이스가 연결되지 않았습니다. DB 설정 화면에서 연결 상태를 확인하거나, ' +
        "'로컬 모드(DB 미사용)'로 전환해 주세요.",
    },
    503
  )
}

async function requireDb(c: any): Promise<D1Database | null> {
  if (!c.env?.DB) return null
  try {
    await ensureSchema(c.env.DB)
    return c.env.DB
  } catch (e: any) {
    console.error('schema error', e)
    return null
  }
}

const isKind = (v: unknown): v is DictKind => DICT_KINDS.includes(v as DictKind)

function str(v: unknown): string {
  return String(v ?? '').trim()
}

/* -------------------------------------------------------------------------- */
/* 상태 / 진단                                                                 */
/* -------------------------------------------------------------------------- */
api.get('/health', async (c) => {
  const bound = Boolean(c.env?.DB)
  let dbOk = false
  let schemaOk = false
  const counts: Record<string, number> = {}
  let sqliteVersion = ''
  if (bound) {
    try {
      const db = c.env!.DB!
      const ping = await db.prepare('SELECT 1 AS ok').first<{ ok: number }>()
      dbOk = ping?.ok === 1
      try {
        const v = await db.prepare('SELECT sqlite_version() AS v').first<{ v: string }>()
        sqliteVersion = v?.v || ''
      } catch {
        /* ignore */
      }
      /* 첫 접속(신규 DB)에서도 바로 DB 모드를 쓸 수 있도록 스키마를 자동 준비한다.
         실패해도 health 응답은 계속 반환하고, 아래 진단 결과로 사용자에게 알린다. */
      try {
        await ensureSchema(db)
      } catch (e: any) {
        console.error('health ensureSchema error', String(e?.message || e))
      }
      const t = await db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all<{ name: string }>()
      const names = (t.results || []).map((r) => r.name)
      schemaOk = ['dictionaries', 'app_settings', 'analysis_runs', 'analysis_results'].every((n) =>
        names.includes(n)
      )
      if (schemaOk) {
        const g = await db
          .prepare(`SELECT kind, COUNT(*) AS n FROM dictionaries GROUP BY kind`)
          .all<{ kind: string; n: number }>()
        for (const k of DICT_KINDS) counts[k] = 0
        for (const r of g.results || []) counts[r.kind] = r.n
        const runs = await db
          .prepare('SELECT COUNT(*) AS n FROM analysis_runs')
          .first<{ n: number }>()
        counts._runs = runs?.n ?? 0
      }
    } catch (e: any) {
      console.error('health db error', String(e?.message || e))
    }
  }
  return c.json({
    ok: true,
    dbBound: bound,
    dbOk,
    schemaOk,
    sqliteVersion,
    schemaTables: ['dictionaries', 'app_settings', 'analysis_runs', 'analysis_results'],
    counts,
  })
})

/* -------------------------------------------------------------------------- */
/* 기본 사전 (DB 없이도 동작 — 단일 소스 유지)                                   */
/* -------------------------------------------------------------------------- */
api.get('/dict-defaults', async (c) => {
  const { defaultItemsFor } = await import('../lib/db')
  const out: Record<string, any[]> = {}
  for (const kind of DICT_KINDS) out[kind] = defaultItemsFor(kind)
  return c.json({ ok: true, defaults: out })
})

/* -------------------------------------------------------------------------- */
/* 설정                                                                        */
/* -------------------------------------------------------------------------- */
api.get('/settings', async (c) => {
  const db = await requireDb(c)
  const { DEFAULT_SETTINGS } = await import('../lib/db')
  if (!db) {
    return c.json({ ok: true, dbBound: Boolean(c.env?.DB), dbReady: false, settings: DEFAULT_SETTINGS })
  }
  const settings = await getSettings(db)
  return c.json({ ok: true, dbBound: true, dbReady: true, settings })
})

api.post('/settings', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}))
  const allowed = new Set([
    'storage_mode',
    'persist_results',
    'retention_limit',
    'keep_history',
    'default_allow_space',
    'default_min_len',
  ])
  const applied: Record<string, string> = {}
  for (const [k, v] of Object.entries(body || {})) {
    if (!allowed.has(k)) continue
    let val = str(v)
    if (!val) continue
    if (k === 'storage_mode' && !['local', 'db'].includes(val)) continue
    if (k === 'retention_limit') {
      const n = Number(val)
      if (!Number.isFinite(n) || n < 1) continue
      val = String(Math.min(5000, Math.floor(n)))
    }
    applied[k] = val
    await setSetting(db, k, val)
  }
  if (applied.retention_limit) await pruneHistory(db, Number(applied.retention_limit))
  const settings = await getSettings(db)
  return c.json({ ok: true, applied, settings })
})

/* -------------------------------------------------------------------------- */
/* DB 관리                                                                     */
/* -------------------------------------------------------------------------- */
api.post('/db/init', async (c) => {
  if (!c.env?.DB) return noDb(c)
  try {
    await ensureSchema(c.env.DB)
    return c.json({ ok: true, message: '스키마 생성/점검 완료' })
  } catch (e: any) {
    return c.json({ ok: false, error: String(e?.message || e) }, 500)
  }
})

api.post('/db/seed', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const body = await c.req.json<{ kinds?: string[] }>().catch(() => ({}))
  const kinds = (body.kinds || []).filter(isKind)
  const inserted = await seedDefaults(db, kinds.length ? kinds : undefined)
  return c.json({ ok: true, inserted })
})

api.post('/db/reset', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const body = await c.req.json<{ target?: string }>().catch(() => ({}))
  const target = body.target || 'history'
  if (target === 'history') {
    await db.prepare('DELETE FROM analysis_results').run()
    await db.prepare('DELETE FROM analysis_runs').run()
    return c.json({ ok: true, message: '분석 이력을 모두 삭제했습니다.' })
  }
  if (target === 'dictionaries') {
    /* 사용자가 만든 항목만 지우고 기본값은 다시 채운다 */
    await db.prepare(`DELETE FROM dictionaries WHERE source = 'user'`).run()
    const inserted = await seedDefaults(db)
    return c.json({ ok: true, message: '사전을 기본값으로 되돌렸습니다.', inserted })
  }
  if (target === 'all') {
    await db.prepare('DELETE FROM analysis_results').run()
    await db.prepare('DELETE FROM analysis_runs').run()
    await db.prepare('DELETE FROM dictionaries').run()
    await db.prepare('DELETE FROM app_settings').run()
    for (const stmt of SCHEMA_STATEMENTS) await db.prepare(stmt).run()
    const { DEFAULT_SETTINGS } = await import('../lib/db')
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
      await setSetting(db, k, v)
    }
    await seedDefaults(db)
    await setSetting(db, 'seeded', '1')
    return c.json({ ok: true, message: '모든 데이터를 초기 상태로 되돌렸습니다.' })
  }
  return c.json({ ok: false, error: 'unknown_target' }, 400)
})

/** 전체 백업(사전 + 설정 + 이력 메타) */
api.get('/db/export', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const dict = await db.prepare('SELECT * FROM dictionaries ORDER BY kind, category, value').all()
  const settings = await db.prepare('SELECT key, value FROM app_settings').all()
  const runs = await db
    .prepare(
      `SELECT id, file_name, sheet, storage_mode, row_count, column_count, summary_json, label, created_at
       FROM analysis_runs ORDER BY id DESC`
    )
    .all()
  return c.json({
    ok: true,
    exportedAt: new Date().toISOString(),
    dictionaries: dict.results || [],
    settings: Object.fromEntries(
      (settings.results || []).map((r: any) => [r.key, r.value])
    ),
    runs: (runs.results || []).map((r: any) => ({ ...r, summary: safeParse(r.summary_json) })),
  })
})

/* -------------------------------------------------------------------------- */
/* 사전                                                                        */
/* -------------------------------------------------------------------------- */
api.get('/dict', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const kind = c.req.query('kind')
  const q = str(c.req.query('q'))
  const onlyEnabled = c.req.query('enabled') === '1'
  const params: unknown[] = []
  let sql = `SELECT id, kind, value, pattern, category, risk, enabled, note, source, created_at, updated_at
               FROM dictionaries WHERE 1=1`
  if (kind && isKind(kind)) {
    sql += ' AND kind = ?'
    params.push(kind)
  }
  if (onlyEnabled) sql += ' AND enabled = 1'
  if (q) {
    sql += ' AND (value LIKE ? OR pattern LIKE ? OR category LIKE ? OR note LIKE ?)'
    const like = `%${q}%`
    params.push(like, like, like, like)
  }
  sql += ' ORDER BY kind, category, value LIMIT 30000'
  const rows = await db
    .prepare(sql)
    .bind(...params)
    .all()
  return c.json({ ok: true, items: rows.results || [] })
})

function validateItem(kind: DictKind, it: any): { ok: boolean; error?: string; item?: any } {
  const value = str(it?.value ?? it?.[0])
  if (!value) return { ok: false, error: '값을 입력하세요.' }
  const pattern = kind === 'pattern' || kind === 'pattern_type' ? str(it?.pattern ?? it?.[1]) : ''
  const category =
    kind === 'pattern' || kind === 'pattern_type'
      ? str(it?.category ?? it?.[2])
      : str(it?.category ?? it?.[1])
  const risk =
    kind === 'pattern' || kind === 'pattern_type'
      ? str(it?.risk ?? it?.[3])
      : str(it?.risk ?? it?.[2])
  if ((kind === 'pattern' || kind === 'pattern_type') && pattern) {
    if (!isValidRegex(pattern)) return { ok: false, error: `정규식 오류: ${value}` }
  }
  return { ok: true, item: { value, pattern, category, risk, note: str(it?.note ?? it?.[4]) } }
}

api.post('/dict', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const body = await c.req.json<any>().catch(() => ({}))
  const kind = body.kind
  if (!isKind(kind)) return c.json({ ok: false, error: 'invalid_kind' }, 400)
  const v = validateItem(kind, body)
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400)
  const { value, pattern, category, risk, note } = v.item!
  const r = await db
    .prepare(
      `INSERT INTO dictionaries (kind, value, pattern, category, risk, note, source)
       VALUES (?,?,?,?,?,?,'user')
       ON CONFLICT(kind, value, pattern) DO UPDATE SET
         category = excluded.category,
         risk = excluded.risk,
         note = CASE WHEN excluded.note = '' THEN dictionaries.note ELSE excluded.note END,
         enabled = 1,
         updated_at = datetime('now')`
    )
    .bind(kind, value, pattern, category, risk, note)
    .run()
  const row = await db
    .prepare(`SELECT * FROM dictionaries WHERE kind=? AND value=? AND pattern=?`)
    .bind(kind, value, pattern)
    .first()
  return c.json({ ok: true, changes: r.meta?.changes ?? 0, item: row })
})

/** 일괄 등록(붙여넣기 / CSV 가져오기) */
api.post('/dict/bulk', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const body = await c.req.json<any>().catch(() => ({}))
  const kind = body.kind
  const items: any[] = Array.isArray(body.items) ? body.items : []
  const replace = Boolean(body.replace)
  if (!isKind(kind)) return c.json({ ok: false, error: 'invalid_kind' }, 400)

  const errors: string[] = []
  const seen = new Set<string>()
  const prepared: any[] = []
  for (const raw of items.slice(0, 30000)) {
    const v = validateItem(kind, raw)
    if (!v.ok) {
      if (errors.length < 8) errors.push(v.error!)
      continue
    }
    const it = v.item!
    const key = it.value + '\u0000' + it.pattern
    if (seen.has(key)) continue
    seen.add(key)
    prepared.push(it)
  }

  if (replace) {
    await db.prepare('DELETE FROM dictionaries WHERE kind = ?').bind(kind).run()
  }
  const stmts = prepared.map((it) =>
    db
      .prepare(
        `INSERT INTO dictionaries (kind, value, pattern, category, risk, note, source)
         VALUES (?,?,?,?,?,?,'user')
         ON CONFLICT(kind, value, pattern) DO UPDATE SET
           category = excluded.category,
           risk = excluded.risk,
           note = CASE WHEN excluded.note = '' THEN dictionaries.note ELSE excluded.note END,
           enabled = 1,
           updated_at = datetime('now')`
      )
      .bind(kind, it.value, it.pattern, it.category, it.risk, it.note)
  )
  let inserted = 0
  for (let i = 0; i < stmts.length; i += 40) {
    const res = await db.batch(stmts.slice(i, i + 40))
    inserted += res.reduce((a, r) => a + (r.meta?.changes ?? 0), 0)
  }
  return c.json({ ok: true, inserted, skipped: items.length - prepared.length, errors })
})

api.put('/dict/:id', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'invalid_id' }, 400)
  const body = await c.req.json<any>().catch(() => ({}))
  const cur = await db.prepare('SELECT * FROM dictionaries WHERE id = ?').bind(id).first<any>()
  if (!cur) return c.json({ ok: false, error: 'not_found' }, 404)

  const sets: string[] = []
  const params: unknown[] = []
  const kind = cur.kind as DictKind

  if (body.value !== undefined) {
    const value = str(body.value)
    if (!value) return c.json({ ok: false, error: '값은 비울 수 없습니다.' }, 400)
    sets.push('value = ?')
    params.push(value)
  }
  if (body.pattern !== undefined && (kind === 'pattern' || kind === 'pattern_type')) {
    const pattern = str(body.pattern)
    if (pattern && !isValidRegex(pattern)) {
      return c.json({ ok: false, error: '정규식 형식이 올바르지 않습니다.' }, 400)
    }
    sets.push('pattern = ?')
    params.push(pattern)
  }
  if (body.category !== undefined) {
    sets.push('category = ?')
    params.push(str(body.category))
  }
  if (body.risk !== undefined) {
    sets.push('risk = ?')
    params.push(str(body.risk))
  }
  if (body.note !== undefined) {
    sets.push('note = ?')
    params.push(str(body.note))
  }
  if (body.enabled !== undefined) {
    sets.push('enabled = ?')
    params.push(body.enabled ? 1 : 0)
  }
  if (!sets.length) return c.json({ ok: false, error: 'nothing_to_update' }, 400)
  sets.push(`source = 'user'`, `updated_at = datetime('now')`)

  try {
    await db
      .prepare(`UPDATE dictionaries SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...params, id)
      .run()
  } catch (e: any) {
    return c.json({ ok: false, error: '같은 값이 이미 있습니다.' }, 409)
  }
  const row = await db.prepare('SELECT * FROM dictionaries WHERE id = ?').bind(id).first()
  return c.json({ ok: true, item: row })
})

api.delete('/dict/:id', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const id = Number(c.req.param('id'))
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'invalid_id' }, 400)
  await db.prepare('DELETE FROM dictionaries WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

api.post('/dict/delete', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const body = await c.req.json<{ ids?: number[] }>().catch(() => ({}))
  const ids = (body.ids || []).map(Number).filter((n) => Number.isFinite(n))
  if (!ids.length) return c.json({ ok: true, deleted: 0 })
  let deleted = 0
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40)
    const stmts = chunk.map((id) => db.prepare('DELETE FROM dictionaries WHERE id = ?').bind(id))
    const res = await db.batch(stmts)
    deleted += res.reduce((a, r) => a + (r.meta?.changes ?? 0), 0)
  }
  return c.json({ ok: true, deleted })
})

/** 제외 단어만 대량 추가 (보안 분석에서 제외할 단어 빠른 등록) */
api.post('/dict/stopword-bulk-words', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const body = await c.req.json<{ words?: string[] }>().catch(() => ({}))
  const words = (body.words || []).map((w) => String(w).trim()).filter(Boolean)
  if (!words.length) return c.json({ ok: true, inserted: 0 })
  const uniq = [...new Set(words)].slice(0, 10000)
  const stmts = uniq.map((w) =>
    db
      .prepare(
        `INSERT INTO dictionaries (kind, value, pattern, category, risk, note, source)
         VALUES ('stopword', ?, '', '', '', '', 'user')
         ON CONFLICT(kind, value, pattern) DO NOTHING`
      )
      .bind(w)
  )
  let inserted = 0
  for (let i = 0; i < stmts.length; i += 40) {
    const res = await db.batch(stmts.slice(i, i + 40))
    inserted += res.reduce((a, r) => a + (r.meta?.changes ?? 0), 0)
  }
  return c.json({ ok: true, inserted, skipped: words.length - uniq.length })
})

/* -------------------------------------------------------------------------- */
/* 분석 이력                                                                    */
/* -------------------------------------------------------------------------- */
api.post('/runs', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const s = await readSettings(db)
  if (s.keep_history !== '1') {
    return c.json({ ok: true, skipped: true, message: '이력 저장이 꺼져 있습니다.' })
  }
  const body = await c.req.json<any>().catch(() => ({}))
  const run = body.run || {}
  const results: Array<{ kind: string; payload: unknown; rowTotal?: number }> = Array.isArray(
    body.results
  )
    ? body.results
    : []
  const r = await db
    .prepare(
      `INSERT INTO analysis_runs
        (file_name, sheet, storage_mode, row_count, column_count, columns_json, summary_json, label)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .bind(
      str(run.fileName),
      str(run.sheet),
      str(run.storageMode) || 'db',
      Number(run.rowCount || 0),
      Number(run.columnCount || 0),
      JSON.stringify(run.columns || []),
      JSON.stringify(run.summary || {}),
      str(run.label)
    )
    .run()
  const runId = r.meta?.last_row_id
  let savedResults = 0
  if (s.persist_results === '1' && runId) {
    for (const item of results) {
      await db
        .prepare(`INSERT INTO analysis_results (run_id, kind, payload_json, row_total) VALUES (?,?,?,?)`)
        .bind(runId, str(item.kind), JSON.stringify(item.payload ?? null), Number(item.rowTotal || 0))
        .run()
      savedResults++
    }
  }
  await pruneHistory(db, Number(s.retention_limit || 50))
  return c.json({ ok: true, runId, savedResults })
})

api.get('/runs', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || 100)))
  const rows = await db
    .prepare(
      `SELECT id, file_name, sheet, storage_mode, row_count, column_count,
              summary_json, label, created_at
         FROM analysis_runs ORDER BY datetime(created_at) DESC, id DESC LIMIT ?`
    )
    .bind(limit)
    .all<any>()
  return c.json({
    ok: true,
    items: (rows.results || []).map((r) => ({ ...r, summary: safeParse(r.summary_json) })),
  })
})

api.get('/runs/:id', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const id = Number(c.req.param('id'))
  const run = await db.prepare('SELECT * FROM analysis_runs WHERE id = ?').bind(id).first<any>()
  if (!run) return c.json({ ok: false, error: 'not_found' }, 404)
  const results = await db
    .prepare('SELECT kind, payload_json, row_total FROM analysis_results WHERE run_id = ?')
    .bind(id)
    .all<any>()
  return c.json({
    ok: true,
    run: { ...run, summary: safeParse(run.summary_json), columns: safeParse(run.columns_json) },
    results: (results.results || []).map((r) => ({
      kind: r.kind,
      rowTotal: r.row_total,
      payload: safeParse(r.payload_json),
    })),
  })
})

api.delete('/runs/:id', async (c) => {
  const db = await requireDb(c)
  if (!db) return noDb(c)
  const id = Number(c.req.param('id'))
  await db.prepare('DELETE FROM analysis_results WHERE run_id = ?').bind(id).run()
  await db.prepare('DELETE FROM analysis_runs WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

function safeParse(s: any) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export default api
