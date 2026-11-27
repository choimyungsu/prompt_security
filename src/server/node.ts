/* ==========================================================================
 * node.ts — 로컬 실행용 Node.js + MySQL 서버 엔트리
 *
 *   실행: npm run start:local      (= tsx src/server/node.ts)
 *   개발: npm run dev:local        (파일 변경 자동 재시작)
 *
 *   이 파일은 Cloudflare 빌드(dist)에 포함되지 않는다.
 *   배포용 엔트리는 src/index.tsx 이며 D1 을 사용한다.
 * ========================================================================== */
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import api from '../routes/api'
import { renderPage } from '../lib/page'
import { createMysqlDb, mysqlConfigFromEnv } from '../lib/mysqladapter'

/* .env 자동 로드 (Node 20.12+ / 21.7+) */
try {
  ;(process as any).loadEnvFile?.('.env')
} catch {
  /* .env 가 없으면 OS 환경변수를 그대로 사용한다 */
}

const cfg = mysqlConfigFromEnv(process.env as Record<string, string | undefined>)

let db
try {
  db = await createMysqlDb(cfg)
} catch (e: any) {
  const code = String(e?.code || '')
  console.error('\n[DB 연결 실패] MySQL 에 접속할 수 없습니다.')
  console.error(`  대상: ${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}`)
  console.error(`  원인: ${code || ''} ${e?.message || e}\n`)
  if (code === 'ER_BAD_DB_ERROR' || code === 'ER_BAD_DB') {
    console.error('  → 데이터베이스가 없습니다. 아래를 한 번 실행하세요:  npm run db:setup\n')
  } else if (code === 'ECONNREFUSED') {
    console.error('  → MySQL 서비스가 꺼져 있습니다. MySQL 을 먼저 실행하세요.\n')
  } else if (code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('  → 계정/비밀번호가 틀렸습니다. .env 의 MYSQL_USER / MYSQL_PASSWORD 를 확인하세요.\n')
  }
  process.exit(1)
}

const app = new Hono()

/* 정적 자산 (public/static/* → /static/*) */
app.use('/static/*', serveStatic({ root: './public' }))

/* API */
app.route('/api', api)

/* 메인 화면 */
app.get('/', (c) => c.html(renderPage()))
app.get('/health', (c) =>
  c.json({ ok: true, app: 'security-word-analyzer', runtime: 'node', db: db!.label })
)

const port = Number(process.env.PORT || process.env.APP_PORT || 3000)

serve(
  {
    /* 요청마다 DB 핸들을 바인딩 (Cloudflare 의 env.DB 와 동일한 경로로 동작) */
    fetch: (req: Request) => app.fetch(req, { DB: db }),
    port,
    hostname: '0.0.0.0',
  },
  (info: { port: number }) => {
    const url = `http://localhost:${info.port}`
    console.log('\n==========================================')
    console.log('  Security Word Analyzer (로컬 실행)')
    console.log('==========================================')
    console.log(`  주소   : ${url}`)
    console.log(`  DB     : ${db!.label}`)
    console.log('  종료   : Ctrl + C')
    console.log('==========================================\n')
  }
)
