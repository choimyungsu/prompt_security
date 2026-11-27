/* ==========================================================================
 * tests/api.test.mjs — API 통합 테스트 (실행 중인 서버 대상)
 *
 *   실행 중인 서버가 필요합니다. DB 종류는 묻지 않습니다.
 *   → MySQL 로컬 서버(npm run start:local)와 D1(wrangler pages dev) 양쪽 모두 통과해야 합니다.
 *
 *   사용법
 *     node tests/api.test.mjs                       # http://localhost:3000
 *     BASE=http://localhost:3300 node tests/api.test.mjs
 *     EXPECT_DIALECT=mysql node tests/api.test.mjs  # DB 종류까지 검증
 *
 *   주의: 사전/이력 데이터를 수정합니다. 개발용 DB 에서만 실행하세요.
 * ========================================================================== */

const BASE = (process.env.BASE || 'http://localhost:3000') + '/api'
const EXPECT = process.env.EXPECT_DIALECT || ''

let pass = 0
let fail = 0

const ok = (name) => {
  pass++
  console.log(`  ✓ ${name}`)
}
const ng = (name, exp, act) => {
  fail++
  console.log(`  ✗ ${name}  (기대:${exp} / 실제:${act})`)
}
const ck = (name, exp, act) => (JSON.stringify(exp) === JSON.stringify(act) ? ok(name) : ng(name, exp, act))
const ckTrue = (name, cond) => (cond ? ok(name) : ng(name, 'true', String(cond)))
const section = (s) => console.log(`\n== ${s} ==`)

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${method} ${path} → JSON 아님 (${res.status}): ${text.slice(0, 200)}`)
  }
  return { status: res.status, json }
}
const GET = (p) => call('GET', p)
const POST = (p, b) => call('POST', p, b)
const PUT = (p, b) => call('PUT', p, b)
const DEL = (p) => call('DELETE', p)

const tag = `검증${Date.now().toString().slice(-6)}`

/* -------------------------------------------------------------------------- */
async function main() {
  console.log(`대상: ${BASE}`)

  /* 1. health */
  section('[1] health')
  const { json: h } = await GET('/health')
  const dialect = h.dbKind
  console.log(`  (DB 종류: ${dialect || '?'} / ${h.dbLabel || '-'})`)
  if (EXPECT) ck('DB 종류 일치', EXPECT, dialect)
  ckTrue('dbBound', h.dbBound === true)
  ckTrue('dbOk', h.dbOk === true)
  ckTrue('schemaOk', h.schemaOk === true)
  ckTrue('기본 사전이 시드됨 (stopword>0)', (h.counts?.stopword ?? 0) > 0)
  ckTrue('기본 사전이 시드됨 (security>0)', (h.counts?.security ?? 0) > 0)
  ckTrue('기본 사전이 시드됨 (pattern>0)', (h.counts?.pattern ?? 0) > 0)
  ckTrue('기본 사전이 시드됨 (pattern_type>0)', (h.counts?.pattern_type ?? 0) > 0)

  /* 2. defaults */
  section('[2] dict-defaults')
  const { json: d } = await GET('/dict-defaults')
  ck('기본값 4종', 4, Object.keys(d.defaults).length)
  ckTrue('stopword 항목 값이 비어있지 않음', Boolean(d.defaults.stopword?.[0]?.value))
  ckTrue('security 항목 값이 비어있지 않음', Boolean(d.defaults.security?.[0]?.value))

  /* 3. settings */
  section('[3] settings')
  const { json: s } = await POST('/settings', {
    keep_history: '1',
    persist_results: '1',
    retention_limit: '5',
  })
  ck('keep_history', '1', s.settings.keep_history)
  ck('persist_results', '1', s.settings.persist_results)
  ck('retention_limit', '5', s.settings.retention_limit)
  const bad = await POST('/settings', { retention_limit: '-3', storage_mode: 'nope' })
  ck('잘못된 값은 무시됨(여전히 5)', '5', bad.json.settings.retention_limit)

  /* 4. 사전 추가 + upsert */
  section('[4] 사전 추가 / upsert')
  const ins = await POST('/dict', {
    kind: 'security',
    value: `${tag}_키워드`,
    category: '검증',
    risk: '높음',
    note: 'n1',
  })
  ckTrue('추가 ok', ins.json.ok === true)
  const id = ins.json.item.id
  ckTrue('id 발급', Number.isFinite(id))

  const up = await POST('/dict', {
    kind: 'security',
    value: `${tag}_키워드`,
    category: '검증2',
    risk: '중간',
    note: '',
  })
  ck('upsert 시 id 유지', id, up.json.item.id)
  ck('upsert category 반영', '검증2', up.json.item.category)
  ck('빈 note 는 기존값 유지', 'n1', up.json.item.note)

  /* 5. 정규식 검증 */
  section('[5] 정규식 검증')
  const badRe = await POST('/dict', { kind: 'pattern', value: `${tag}_깨짐`, pattern: '[unclosed' })
  ckTrue('잘못된 정규식 거부', badRe.json.ok === false)
  const goodRe = await POST('/dict', {
    kind: 'pattern',
    value: `${tag}_정상`,
    pattern: 'PJT-[0-9]{4}-[0-9]{5}',
    category: '코드',
    risk: '주의',
  })
  ckTrue('정상 정규식 허용', goodRe.json.ok === true)
  const reId = goodRe.json.item.id

  /* 6. 목록 / 검색 / enabled 필터 */
  section('[6] 목록 / 검색')
  const search = await GET(`/dict?kind=security&q=${encodeURIComponent(tag + '_키워드')}`)
  ck('검색 결과 1건', 1, search.json.items.length)
  const en = await GET('/dict?enabled=1')
  ckTrue('enabled=1 목록에 노출', en.json.items.some((r) => r.value === `${tag}_키워드`))

  /* 7. 수정 (risk/enabled) */
  section('[7] 수정')
  const upd = await PUT(`/dict/${id}`, { risk: '매우 높음', enabled: false })
  ckTrue('수정 ok', upd.json.ok === true)
  ck('risk 반영', '매우 높음', upd.json.item.risk)
  ck('enabled=0 반영', 0, Number(upd.json.item.enabled))
  const en2 = await GET('/dict?kind=security&enabled=1')
  ckTrue('비활성 항목은 enabled=1 에서 제외', !en2.json.items.some((r) => r.id === id))
  await PUT(`/dict/${id}`, { enabled: true })

  /* 8. bulk (배열 + 객체 혼용, 중복 제거) */
  section('[8] 일괄 등록')
  const bulk = await POST('/dict/bulk', {
    kind: 'stopword',
    items: [[`${tag}_일괄1`], [`${tag}_일괄2`], [`${tag}_일괄1`], { value: `${tag}_일괄3` }],
  })
  ckTrue('bulk ok', bulk.json.ok === true)
  ck('중복 1건 skip', 1, bulk.json.skipped)
  const bulkList = await GET(`/dict?kind=stopword&q=${encodeURIComponent(tag + '_일괄')}`)
  ck('실제 저장 3건', 3, bulkList.json.items.length)
  ckTrue('source=user 로 저장', bulkList.json.items.every((r) => r.source === 'user'))

  /* 9. 빠른 제외 단어 (source=user 여야 함) */
  section('[9] 빠른 제외 단어')
  const words = await POST('/dict/stopword-bulk-words', {
    words: [`${tag}_제외1`, `${tag}_제외2`, `${tag}_제외1`],
  })
  ckTrue('ok', words.json.ok === true)
  ck('중복 skip', 1, words.json.skipped)
  const wl = await GET(`/dict?kind=stopword&q=${encodeURIComponent(tag + '_제외')}`)
  ck('저장 2건', 2, wl.json.items.length)
  ckTrue('source=user (초기화 시 정리 대상)', wl.json.items.every((r) => r.source === 'user'))

  /* 10. 이력 저장 */
  section('[10] 이력 저장')
  const run = await POST('/runs', {
    run: {
      fileName: 'test.xlsx',
      sheet: 'S1',
      storageMode: 'db',
      rowCount: 10,
      columnCount: 3,
      columns: ['a', 'b'],
      summary: { sec: 2 },
      label: '검증',
    },
    results: [
      { kind: 'summary', payload: { x: 1 }, rowTotal: 10 },
      { kind: 'patterns', payload: { y: 2 }, rowTotal: 5 },
    ],
  })
  ckTrue('저장 ok', run.json.ok === true)
  ck('결과 2건 저장', 2, run.json.savedResults)
  const runId = run.json.runId
  ckTrue('runId 발급', Number.isFinite(runId))

  /* 11. 이력 목록/상세 */
  section('[11] 이력 조회')
  const list = await GET('/runs?limit=100')
  const found = list.json.items.find((r) => r.id === runId)
  ckTrue('목록에 존재', Boolean(found))
  ck('summary 파싱', 2, found?.summary?.sec)
  const detail = await GET(`/runs/${runId}`)
  ck('상세 결과 2건', 2, detail.json.results.length)
  ckTrue(
    'payload 보존',
    detail.json.results.some((r) => (r.payload || {}).x === 1)
  )

  /* 12. 이력 정리(retention) */
  section('[12] 이력 자동 정리 (retention=5)')
  for (let i = 0; i < 7; i++) {
    await POST('/runs', { run: { fileName: `t${i}.xlsx`, rowCount: 1 }, results: [] })
  }
  const after = await GET('/runs?limit=100')
  ck('5건으로 정리됨', 5, after.json.items.length)

  /* 13. 이력 삭제 */
  section('[13] 이력 삭제')
  const del = await DEL(`/runs/${runId}`)
  ckTrue('삭제 ok', del.json.ok === true)
  const g = await GET(`/runs/${runId}`)
  ck('삭제 후 조회 404', 404, g.status)

  /* 14. 백업 */
  section('[14] 백업 export')
  const exp = await GET('/db/export')
  ckTrue('ok', exp.json.ok === true)
  ck('dialect 노출', dialect, exp.json.dialect)
  ckTrue('사전 포함', Array.isArray(exp.json.dictionaries) && exp.json.dictionaries.length > 0)
  ckTrue('설정 포함', Boolean(exp.json.settings?.retention_limit))
  ckTrue('방금 추가한 항목 포함', exp.json.dictionaries.some((r) => r.value === `${tag}_키워드`))

  /* 15. 스키마 생성 멱등성 */
  section('[15] db/init 멱등성')
  const init = await POST('/db/init')
  ckTrue('ok', init.json.ok === true)
  const init2 = await POST('/db/init')
  ckTrue('두 번 호출해도 ok', init2.json.ok === true)

  /* 16. seed 멱등성 */
  section('[16] db/seed 멱등성')
  const seed = await POST('/db/seed')
  ckTrue('ok', seed.json.ok === true)
  ck('이미 있으므로 0건 추가', 0, seed.json.inserted)

  /* 17. 사전 초기화 — user 만 삭제, default 유지 */
  section('[17] 사전 초기화')
  const rst = await POST('/db/reset', { target: 'dictionaries' })
  ckTrue('ok', rst.json.ok === true)
  const gone = await GET(`/dict?q=${encodeURIComponent(tag)}`)
  ck('사용자 항목 모두 삭제', 0, gone.json.items.length)
  const h2 = await GET('/health')
  ckTrue('기본값은 재시드되어 유지', (h2.json.counts?.stopword ?? 0) >= 64)

  /* 18. 이력 초기화 */
  section('[18] 이력 초기화')
  await POST('/db/reset', { target: 'history' })
  const h3 = await GET('/health')
  ck('이력 0건', 0, h3.json.counts._runs)

  /* 19. 전체 초기화 */
  section('[19] 전체 초기화')
  const all = await POST('/db/reset', { target: 'all' })
  ckTrue('ok', all.json.ok === true)
  const h4 = await GET('/health')
  ckTrue('스키마 복구', h4.json.schemaOk === true)
  ckTrue('기본 사전 복구', (h4.json.counts?.stopword ?? 0) >= 64)
  ck('이력 0건', 0, h4.json.counts._runs)

  /* 결과 */
  console.log(`\n결과: ${pass} PASS / ${fail} FAIL  (DB: ${dialect || '?'})`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\n[실패]', e.message)
  console.error('서버가 실행 중인지 확인하세요: npm run start:local  (또는 wrangler pages dev)')
  process.exit(1)
})
