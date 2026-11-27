/* ==========================================================================
 * d1adapter.ts — Cloudflare D1(D1Database)을 SqlDb 인터페이스로 감싼다.
 *  배포(Cloudflare Pages)와 `wrangler pages dev` 로컬 실행에서 사용된다.
 * ========================================================================== */
import type { BatchStmt, RunResult, SqlDb } from './dbtypes'

type D1 = D1Database

export function createD1Db(d1: D1, label = 'Cloudflare D1 (SQLite)'): SqlDb {
  return {
    dialect: 'sqlite',
    label,

    async all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
      const st = params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql)
      const r = await st.all<T>()
      return r.results || []
    },

    async first<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
      const st = params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql)
      return (await st.first<T>()) ?? null
    },

    async run(sql: string, params: unknown[] = []): Promise<RunResult> {
      const st = params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql)
      const r = await st.run()
      return {
        changes: Number(r.meta?.changes ?? 0),
        lastRowId: r.meta?.last_row_id != null ? Number(r.meta.last_row_id) : null,
      }
    },

    async batch(stmts: BatchStmt[]): Promise<RunResult[]> {
      if (!stmts.length) return []
      const prepared = stmts.map((s) =>
        s.params?.length ? d1.prepare(s.sql).bind(...s.params) : d1.prepare(s.sql)
      )
      const res = await d1.batch(prepared)
      return res.map((r: any) => ({
        changes: Number(r.meta?.changes ?? 0),
        lastRowId: r.meta?.last_row_id != null ? Number(r.meta.last_row_id) : null,
      }))
    },

    async version(): Promise<string> {
      try {
        const r = await d1.prepare('SELECT sqlite_version() AS v').first<{ v: string }>()
        return r?.v ? `SQLite ${r.v}` : 'SQLite'
      } catch {
        return 'SQLite'
      }
    },

    async ping(): Promise<boolean> {
      try {
        const r = await d1.prepare('SELECT 1 AS ok').first<{ ok: number }>()
        return r?.ok === 1
      } catch {
        return false
      }
    },

    async close(): Promise<void> {
      /* D1 은 연결 개념이 없다 */
    },
  }
}
