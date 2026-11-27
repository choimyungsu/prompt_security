import { Hono } from 'hono'
import api from './routes/api'
import { renderPage } from './lib/page'

type Bindings = { DB?: D1Database }

const app = new Hono<{ Bindings: Bindings }>()

/* API 라우트 */
app.route('/api', api)

/* 메인 화면 (public/static 정적 자산은 Cloudflare Pages 가 자동 서빙) */
app.get('/', (c) => c.html(renderPage()))

app.get('/health', (c) => c.json({ ok: true, app: 'security-word-analyzer' }))

export default app
