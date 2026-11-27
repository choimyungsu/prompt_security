/* ==========================================================================
 * mysqladapter.ts — 로컬 Node.js 서버용 MySQL 커넥션 풀을 SqlDb 로 감싼다.
 *  · Cloudflare Workers 는 TCP 를 열 수 없으므로 이 파일은 Node 런타임에서만 쓴다.
 *  · D1 과 문법이 다른 부분(placeholder, upsert, datetime)은 각 호출부에서
 *    dialect 를 보고 분기한다. 이 파일은 "실행"만 담당한다.
 * ========================================================================== */
import mysql from 'mysql2/promise'
import type { BatchStmt, RunResult, SqlDb } from './dbtypes'

export interface MysqlConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  connectionLimit?: number
}

/** D1 과 동일하게 undefined 는 NULL 로, boolean 은 0/1 로 정규화 */
function norm(params: unknown[] = []): any[] {
  return params.map((p) => {
    if (p === undefined) return null
    if (typeof p === 'boolean') return p ? 1 : 0
    return p
  })
}

export function mysqlConfigFromEnv(env: Record<string, string | undefined>): MysqlConfig {
  return {
    host: env.MYSQL_HOST || '127.0.0.1',
    port: Number(env.MYSQL_PORT || 3306),
    user: env.MYSQL_USER || 'webapp',
    password: env.MYSQL_PASSWORD || env.MYSQL_PASS || '',
    database: env.MYSQL_DATABASE || env.MYSQL_DB || 'webapp',
    connectionLimit: Number(env.MYSQL_POOL || 10),
  }
}

export async function createMysqlDb(cfg: MysqlConfig): Promise<SqlDb> {
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: cfg.connectionLimit ?? 10,
    charset: 'utf8mb4',
    dateStrings: true, // DATETIME 을 문자열로 받아 D1 과 응답 형태를 맞춘다
    supportBigNumbers: true,
    bigNumberStrings: false,
  })

  /* 접속 즉시 검증 — 잘못된 설정이면 앱이 뜰 때 바로 알 수 있게 한다 */
  const probe = await pool.getConnection()
  probe.release()

  let label = `MySQL ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`
  try {
    const [rows] = await pool.query<any[]>('SELECT VERSION() AS v')
    if (rows?.[0]?.v) label = `MySQL ${rows[0].v} @${cfg.host}:${cfg.port}/${cfg.database}`
  } catch {
    /* ignore */
  }

  return {
    dialect: 'mysql',
    label,

    async all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
      const [rows] = await pool.query(sql, norm(params))
      return Array.isArray(rows) ? (rows as T[]) : []
    },

    async first<T = any>(sql: string, params: unknown[] = []): Promise<T | null> {
      const [rows] = await pool.query(sql, norm(params))
      const arr = Array.isArray(rows) ? (rows as T[]) : []
      return arr.length ? arr[0] : null
    },

    async run(sql: string, params: unknown[] = []): Promise<RunResult> {
      const [res] = await pool.query(sql, norm(params))
      const r = res as any
      return {
        changes: Number(r?.affectedRows ?? 0),
        lastRowId: r?.insertId ? Number(r.insertId) : null,
      }
    },

    async batch(stmts: BatchStmt[]): Promise<RunResult[]> {
      /* mysql2 는 D1 batch 가 없으므로 순차 실행 (원자성은 호출부에서 관리) */
      const out: RunResult[] = []
      for (const s of stmts) out.push(await this.run(s.sql, s.params))
      return out
    },

    async version(): Promise<string> {
      try {
        const [rows] = await pool.query<any[]>('SELECT VERSION() AS v')
        return `MySQL ${rows?.[0]?.v ?? ''}`.trim()
      } catch {
        return 'MySQL'
      }
    },

    async ping(): Promise<boolean> {
      try {
        const [rows] = await pool.query<any[]>('SELECT 1 AS ok')
        return Number(rows?.[0]?.ok) === 1
      } catch {
        return false
      }
    },

    async close(): Promise<void> {
      await pool.end()
    },
  }
}
