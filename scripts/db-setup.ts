/* ==========================================================================
 * scripts/db-setup.ts — MySQL 로컬 DB 초기화
 *
 *   실행: npm run db:setup      (= tsx scripts/db-setup.ts)
 *
 * 하는 일
 *   1) .env 를 읽어 접속 정보 확인
 *   2) 데이터베이스가 없으면 CREATE DATABASE (utf8mb4)
 *   3) 테이블 생성 (dictionaries / app_settings / analysis_runs / analysis_results)
 *   4) 기본 사전 4종 시드 (이미 있으면 건너뜀)
 *
 * 이미 만들어져 있어도 안전하게 다시 실행할 수 있다.
 * ========================================================================== */
import mysql from 'mysql2/promise'
import { ensureSchema, schemaStatements, seedDefaults, TABLES } from '../src/lib/db'
import { createMysqlDb, mysqlConfigFromEnv } from '../src/lib/mysqladapter'
import { loadEnv } from '../src/lib/loadEnv'

/* .env 자동 로드 — Node 버전과 무관하게 동작한다 */
loadEnv('.env')

const cfg = mysqlConfigFromEnv(process.env as Record<string, string | undefined>)
const log = (s: string) => console.log(s)

log('')
log('==========================================')
log('  MySQL 로컬 DB 초기화')
log('==========================================')
log(`  대상 : ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`)
log('')

/* 1) 데이터베이스 생성 (DB 를 지정하지 않고 접속) */
try {
  const root = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    charset: 'utf8mb4',
  })
  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${cfg.database}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  )
  await root.end()
  log(`[1/3] 데이터베이스 확인/생성 완료: ${cfg.database}`)
} catch (e: any) {
  const code = String(e?.code || '')
  log(`[1/3] 데이터베이스 생성 실패 (${code || e?.message})`)
  if (code === 'ER_DBACCESS_DENIED_ERROR' || code === 'ER_ACCESS_DENIED_ERROR') {
    log('')
    log('  계정에 DB 생성 권한이 없습니다. MySQL 관리자(root)로 아래를 한 번 실행하세요:')
    log('  ------------------------------------------------------------')
    log(`  CREATE DATABASE IF NOT EXISTS \`${cfg.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`)
    log(`  CREATE USER IF NOT EXISTS '${cfg.user}'@'localhost' IDENTIFIED BY '<password>';`)
    log(`  GRANT ALL PRIVILEGES ON \`${cfg.database}\`.* TO '${cfg.user}'@'localhost';`)
    log('  FLUSH PRIVILEGES;')
    log('  ------------------------------------------------------------')
    log('  그 뒤 다시 `npm run db:setup` 을 실행하세요.')
    log('')
    process.exit(1)
  }
  if (code === 'ECONNREFUSED') {
    log('  MySQL 서버가 꺼져 있습니다. MySQL 을 먼저 실행한 뒤 다시 시도하세요.')
    process.exit(1)
  }
  throw e
}

/* 2) 테이블 생성 */
const db = await createMysqlDb(cfg)
for (const stmt of schemaStatements('mysql')) {
  await db.run(stmt)
}
await ensureSchema(db)
log(`[2/3] 테이블 준비 완료: ${TABLES.join(', ')}`)

/* 3) 기본 사전 시드 */
const inserted = await seedDefaults(db)
log(`[3/3] 기본 사전 시드: ${inserted}건 추가`)

const counts = await db.all<{ kind: string; n: number }>(
  'SELECT kind, COUNT(*) AS n FROM dictionaries GROUP BY kind'
)
log('')
for (const r of counts) log(`  - ${r.kind.padEnd(14)} ${r.n}건`)
log('')
log('완료. 이제 `npm run start:local` 또는 `start.bat` 으로 서버를 실행하세요.')
log('')

await db.close()
process.exit(0)
