/* ==========================================================================
 * loadEnv.ts — .env 로더 (Node 버전 무관)
 *
 *  Node 20.12+ 의 process.loadEnvFile 을 우선 사용하고,
 *  그보다 낮은 버전이면 직접 파싱한다. (.env 가 없으면 조용히 넘어간다)
 *
 *  규칙: KEY=VALUE 한 줄씩, # 주석, 양쪽 따옴표 제거, CRLF 허용.
 *  이미 설정된 OS 환경변수는 덮어쓰지 않는다.
 * ========================================================================== */
import { existsSync, readFileSync } from 'node:fs'

function parse(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** .env 를 process.env 로 로드한다 (이미 있는 값은 유지) */
export function loadEnv(file = '.env'): void {
  if (!existsSync(file)) return
  /* Node 20.12+ 는 내장 로더가 있다 */
  const native = (process as any).loadEnvFile
  if (typeof native === 'function') {
    try {
      native.call(process, file)
      return
    } catch {
      /* 내장 로더 실패 시 아래 수동 파싱으로 진행 */
    }
  }
  try {
    const vars = parse(readFileSync(file, 'utf8'))
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] === undefined) process.env[k] = v
    }
  } catch {
    /* 파일을 읽을 수 없으면 OS 환경변수만 사용 */
  }
}
