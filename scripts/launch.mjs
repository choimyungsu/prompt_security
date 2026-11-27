#!/usr/bin/env node
/* ==========================================================================
 * scripts/launch.mjs — 로컬 실행 런처 (start.bat 이 호출)
 *
 *  설계 원칙
 *   1) start.bat 은 ASCII 만 사용한다.
 *      (cmd.exe 는 .bat 을 OEM 코드페이지로 읽어 UTF-8 한글이 깨진다)
 *   2) 한글 안내는 이 파일이 출력한다.
 *      (Node 는 Windows 콘솔에 UTF-16 으로 쓰기 때문에 한글이 깨지지 않는다)
 *   3) npm(.cmd) 을 직접 spawn 하지 않는다.
 *      (Node 20+ 는 shell:false 로 .cmd 실행을 거부 → EINVAL)
 *      대신 node 로 npm-cli.js / tsx cli.mjs 를 직접 실행한다.
 * ========================================================================== */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(ROOT)

const isWin = process.platform === 'win32'
const NODE = process.execPath

const line = (s = '') => console.log(s)
const brief = (t) => {
  line('')
  line(`  ======  ${t}  ======`)
  line('')
}

function fail(msg, hint) {
  line('')
  line(`  [오류] ${msg}`)
  if (hint) {
    line('')
    for (const h of [].concat(hint)) line(`  ${h}`)
  }
  line('')
  process.exit(1)
}

/* -------------------------------------------------------------------------- */
/* 실행 헬퍼 (모두 node 로 직접 실행)                                           */
/* -------------------------------------------------------------------------- */

/** tsx CLI 경로 */
function tsxCli() {
  const p = join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  return existsSync(p) ? p : null
}

/** npm-cli.js 경로 (node 로 직접 실행하기 위함) */
function npmCli() {
  const candidates = [
    join(dirname(NODE), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(dirname(NODE)), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(NODE), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  if (isWin && process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', 'npm', 'bin', 'npm-cli.js'))
  }
  return candidates.find((p) => existsSync(p)) || null
}

function run(args, label) {
  line(`\n  > ${label || args.slice(1).join(' ')}`)
  const r = spawnSync(NODE, args, {
    stdio: 'inherit',
    cwd: ROOT,
    shell: false,
    env: process.env,
  })
  if (r.error) {
    line(`  [실행 오류] ${r.error.message}`)
    return 1
  }
  return r.status ?? 1
}

/** npm install (npm-cli.js 를 node 로 직접 실행, 실패 시 shell 로 재시도) */
function npmInstall() {
  const cli = npmCli()
  if (cli) {
    const code = run([cli, 'install', '--no-audit', '--no-fund'], 'npm install')
    if (code === 0) return 0
  }
  /* 마지막 수단: shell 을 통해 실행 (Windows 에서 npm.cmd 자동 해석) */
  line('\n  > npm install (shell 경유 재시도)')
  const r = spawnSync('npm install', {
    stdio: 'inherit',
    cwd: ROOT,
    shell: true,
    env: process.env,
  })
  return r.status ?? 1
}

/** tsx 로 .ts 실행 */
function runTs(file, label) {
  const cli = tsxCli()
  if (!cli) fail('tsx 를 찾을 수 없습니다.', ['npm install 을 다시 실행해 주세요.'])
  return run([cli, file], label)
}

/** .env 에서 값 하나 읽기 (OS 환경변수가 있으면 그쪽 우선) */
function readEnvValue(key) {
  if (process.env[key]) return process.env[key]
  try {
    const text = readFileSync(join(ROOT, '.env'), 'utf8')
    for (const raw of text.split(/\r?\n/)) {
      const l = raw.trim()
      if (!l || l.startsWith('#')) continue
      const eq = l.indexOf('=')
      if (eq < 1) continue
      if (l.slice(0, eq).trim() !== key) continue
      return l.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    /* .env 없음 */
  }
  return ''
}

/* -------------------------------------------------------------------------- */
/* 1) Node 버전                                                                */
/* -------------------------------------------------------------------------- */
brief('Security Word Analyzer · 로컬 실행')

const major = Number(process.versions.node.split('.')[0])
line(`  [1/5] Node.js v${process.versions.node}`)
if (major < 20) {
  line('  [경고] Node.js 20 이상을 권장합니다.')
}

/* -------------------------------------------------------------------------- */
/* 2) .env                                                                     */
/* -------------------------------------------------------------------------- */
if (!existsSync('.env')) {
  if (existsSync('.env.example')) {
    copyFileSync('.env.example', '.env')
    line('  [2/5] .env 파일을 생성했습니다.')
  } else {
    line('  [2/5] .env.example 이 없어 환경변수를 그대로 사용합니다.')
  }
} else {
  line('  [2/5] 기존 .env 파일을 사용합니다.')
}

/* -------------------------------------------------------------------------- */
/* 3) 패키지                                                                   */
/* -------------------------------------------------------------------------- */
if (!existsSync('node_modules') || !tsxCli()) {
  line('  [3/5] 패키지를 설치합니다. (처음 한 번만, 1~3분 소요)')
  if (npmInstall() !== 0) {
    fail('패키지 설치에 실패했습니다.', [
      '- 네트워크 연결을 확인하세요.',
      '- 직접 실행해 보세요:  npm install --legacy-peer-deps',
    ])
  }
  if (!tsxCli()) fail('설치 후에도 tsx 를 찾을 수 없습니다.', 'npm install 을 직접 실행해 주세요.')
} else {
  line('  [3/5] 패키지가 이미 설치되어 있습니다. (건너뜀)')
}

/* -------------------------------------------------------------------------- */
/* 4) MySQL 초기화                                                             */
/* -------------------------------------------------------------------------- */
line('  [4/5] MySQL 초기화 확인 중...')
if (runTs(join('scripts', 'db-setup.ts'), 'npm run db:setup') !== 0) {
  fail('DB 초기화에 실패했습니다.', [
    '- MySQL 서비스가 실행 중인지 확인하세요.',
    '- .env 의 MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE 값을 확인하세요.',
    '- 위쪽에 안내된 관리자 SQL 을 실행한 뒤 다시 시작해 주세요.',
  ])
}

/* -------------------------------------------------------------------------- */
/* 5) 서버                                                                     */
/* -------------------------------------------------------------------------- */
const port = readEnvValue('PORT') || readEnvValue('APP_PORT') || '3000'

brief('서버를 시작합니다')
line(`  브라우저에서  http://localhost:${port}  을 여세요.`)
line('  종료하려면 이 창에서  Ctrl + C  를 누르세요.')
line('')

const code = runTs(join('src', 'server', 'node.ts'), 'npm run start:local')

line('')
if (code === 0) {
  line('  서버가 종료되었습니다.')
} else {
  line(`  서버가 비정상 종료되었습니다. (종료 코드: ${code})`)
  line('  위쪽 [DB 연결 실패] 안내를 확인하세요.')
}
line('')
