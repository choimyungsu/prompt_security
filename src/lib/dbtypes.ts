/* ==========================================================================
 * dbtypes.ts — DB 드라이버 공통 인터페이스
 *
 *  같은 API 코드가 두 런타임에서 그대로 동작하도록 SQL 실행 계층만 추상화한다.
 *   · sqlite : Cloudflare D1 (배포용 / wrangler pages dev 로컬)
 *   · mysql  : 로컬 Node.js 서버 (mysql2)
 *
 *  주의: Cloudflare Workers 런타임은 TCP 소켓을 열 수 없어 MySQL 에 직접
 *        접속할 수 없다. 그래서 "로컬 = MySQL", "배포 = D1" 두 갈래로 나뉜다.
 * ========================================================================== */

export type Dialect = 'sqlite' | 'mysql'

export interface RunResult {
  /** 영향받은 행 수 */
  changes: number
  /** AUTO_INCREMENT / last_insert_rowid */
  lastRowId: number | null
}

export interface BatchStmt {
  sql: string
  params?: unknown[]
}

export interface SqlDb {
  dialect: Dialect
  /** 화면 표시용 이름 (예: "MySQL 8.0.36 @127.0.0.1/webapp", "Cloudflare D1") */
  label: string
  all<T = any>(sql: string, params?: unknown[]): Promise<T[]>
  first<T = any>(sql: string, params?: unknown[]): Promise<T | null>
  run(sql: string, params?: unknown[]): Promise<RunResult>
  batch(stmts: BatchStmt[]): Promise<RunResult[]>
  /** SELECT VERSION() / sqlite_version() */
  version(): Promise<string>
  /** SELECT 1 */
  ping(): Promise<boolean>
  close(): Promise<void>
}

export function isSqlDb(v: unknown): v is SqlDb {
  return Boolean(v) && typeof (v as SqlDb).all === 'function'
}
