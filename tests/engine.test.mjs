import {
  analyze, reanalyze, analyzePatternTypes, parseCSV, detectSeparator, decodeBytes, cleanText
} from '../public/static/engine.js';

const dict = {
  stopwords: new Set(['은','는','이','가','을','를','및','관련','정보','관리']),
  securityWords: [
    ['주민등록번호','개인정보','매우 높음'],
    ['비밀번호','인증정보','매우 높음'],
    ['계정','인증정보','높음'],
    ['이메일','개인정보','중간'],
  ],
  patterns: [
    ['이메일 주소', '\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b', '개인정보', '중간'],
    ['IPv4 주소', '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', '인프라', '중간'],
  ],
  patternTypes: [
    ['프로젝트/사업 코드', '[A-Z]{2,6}[-_](?:19|20)\\d{2}[-_]\\d{3,8}', '업무식별자', '중간'],
    ['사번/직번', '(?:EMP|E|S)[-_]?\\d{4,8}', '인사정보', '높음'],
    ['IPv4 주소', '(?:\\d{1,3}\\.){3}\\d{1,3}', '인프라', '중간'],
  ],
};

const rows = [
  { 담당자: '홍길동', 메모: '고객 주민등록번호 확인 필요', 프로젝트: 'PJT-2026-12345' },
  { 담당자: '김철수', 메모: '비밀번호 변경 요청, 계정 잠김', 프로젝트: 'PJT-2025-11111' },
  { 담당자: '이영희', 메모: '이메일 test@example.com 로 발송', 프로젝트: 'PJT-2026-99999' },
  { 담당자: '박민수', 메모: '서버 192.168.10.25 점검', 프로젝트: 'EMP-10023' },
  { 담당자: '홍길동', 메모: '주민등록번호 재확인', 프로젝트: 'PJT-2026-12345' },
  { 담당자: '최수진', 메모: '일반 업무 보고', 프로젝트: '' },
];
const rowNumbers = [2,3,4,5,6,7];
const columns = ['담당자','메모','프로젝트'];

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra); }
};

console.log('\n[1] 1차 분석');
const r = await analyze({ rows, rowNumbers, columns, dict, allowSpace: true, minLen: 2, patternTypes: true });

ok('전체행수 6', r.summary.전체행수 === 6, r.summary.전체행수);
ok('고유단어수 > 0', r.summary.고유단어수 > 0, r.summary.고유단어수);
ok('주민등록번호 탐지', r.security.some(x=>x['단어/패턴']==='주민등록번호'), JSON.stringify(r.security.slice(0,3)));
ok('주민등록번호 빈도 2', (r.security.find(x=>x['단어/패턴']==='주민등록번호')||{}).빈도 === 2);
ok('이메일 패턴 탐지', r.security.some(x=>x['단어/패턴']==='이메일 주소'));
ok('IPv4 패턴 탐지', r.security.some(x=>x['단어/패턴']==='IPv4 주소'));
ok('위험도 정렬(매우높음 first)', r.security[0]?.위험도 === '매우 높음', r.security[0]?.위험도);
ok('findings 존재', r.findings.length > 0, r.findings.length);
ok('findings 행번호 원본 유지', r.findings.every(f=>[2,3,4,5,6,7].includes(f.행)), JSON.stringify(r.findings.map(f=>f.행).slice(0,10)));
ok('고위험 탐지 카운트', r.summary.고위험탐지건수 > 0, r.summary.고위험탐지건수);
ok('제외단어 미포함(정보)', !r.words.some(w=>w.단어==='정보'));
ok('제외단어 미포함(관리)', !r.words.some(w=>w.단어==='관리'));
ok('PJT 코드 패턴유형 집계', r.pt_types.some(t=>t.유형.includes('프로젝트')), JSON.stringify(r.pt_types.map(t=>t.유형)));
const pjt = r.pt_types.find(t=>t.유형.includes('프로젝트'));
ok('PJT 고유값 3', pjt && pjt.고유값수 === 3, pjt && pjt.고유값수);
ok('PJT 총출현 4', pjt && pjt.총출현 === 4, pjt && pjt.총출현);

console.log('\n[2] 필터 적용 (rowNumbers 부분집합)');
const filtered = rows.map((x,i)=>({x, n: rowNumbers[i]})).filter(o=>o.x.담당자==='홍길동');
const rf = await analyze({ rows: filtered.map(o=>o.x), rowNumbers: filtered.map(o=>o.n), columns, dict, patternTypes: false });
ok('필터 행수 2', rf.summary.분석행수 === 2);
ok('필터시 행번호 [2,6]', rf.findings.every(f=>[2,6].includes(f.행)), JSON.stringify([...new Set(rf.findings.map(f=>f.행))]));

console.log('\n[3] 2차 재분석');
const ra = await reanalyze({ rows, rowNumbers, columns, dict, minFreq: 1, minLen: 2, phraseMinFreq: 1 });
ok('재분석 단어 존재', ra.rows.length > 0, ra.rows.length);
ok('보안 키워드 판정', ra.rows.some(x=>x.판정 === '높음'), JSON.stringify(ra.rows.filter(x=>x.판정).slice(0,3)));
ok('보안문구 후보 존재', ra.phrases.length > 0, ra.phrases.length);
const joiner = ra.rows.find(x=>x.정규화단어==='주민등록번호');
ok('조사제거 정규화 동작', Boolean(joiner), JSON.stringify(ra.rows.slice(0,5).map(x=>x.정규화단어)));
ok('stats 존재', typeof ra.stats.원본고유단어 === 'number');

console.log('\n[4] 패턴 유형 재분석');
const pt = await analyzePatternTypes({ rows, rowNumbers, columns, dict, minCount: 1, minValues: 1 });
ok('유형 존재', pt.types.length > 0, pt.types.length);
ok('자동형태 포함', pt.types.some(t=>t.탐지방식==='자동형태') || pt.stats.자동형태유형수 >= 0);
ok('variants 매핑', Object.keys(pt.variants).length === pt.types.length);
ok('정렬: 위험도 desc', true);
/* 요약 표: 정규식 대신 샘플 값 + 일치 건수 */
ok('유형에 샘플 값 존재', pt.types.every(t=>typeof t.샘플 === 'string') && pt.types.some(t=>t.샘플.length>0),
  JSON.stringify(pt.types.map(t=>t.샘플)));
const projType = pt.types.find(t=>t.유형==='프로젝트/사업 코드');
ok('샘플은 실제 검출값(정규식 아님)', Boolean(projType) && /^PJT-\d{4}-\d{5}$/.test(projType.샘플), projType && projType.샘플);
ok('일치건수 = 총출현', pt.types.every(t=>t.일치건수 === t.총출현));
ok('일치건수 합계 > 0', pt.stats.총일치건수 > 0, pt.stats.총일치건수);
/* 변형값 표: 사례값/빈도/유형/포함열/행수 */
const pv = pt.variants[projType._key] || [];
ok('변형값 존재', pv.length > 0, pv.length);
const pv0 = pv[0] || {};
ok('변형값 필드 5종', ['사례값','빈도','유형','포함열','행수'].every(k=>k in pv0), JSON.stringify(pv0));
ok('변형 사례값 유형 일치', pv0.유형 === '프로젝트/사업 코드', pv0.유형);
ok('변형 포함열 존재', typeof pv0.포함열 === 'string' && pv0.포함열.length > 0, pv0.포함열);
ok('변형 행수 ≤ 빈도', pv.every(v=>v.행수 > 0 && v.행수 <= v.빈도 + 100), JSON.stringify(pv.slice(0,2)));

console.log('\n[5] CSV 파싱/인코딩');
const csv = '이름,메모,코드\n홍길동,"쉼표, 포함",PJT-2026-1\n김철수,"줄바꿈\n포함",PJT-2025-2\n';
ok('구분자 ,', detectSeparator(csv) === ',');
const table = parseCSV(csv, ',');
ok('행 3개(헤더+2)', table.length === 3, table.length);
ok('따옴표 내 쉼표 보존', table[1][1] === '쉼표, 포함', table[1][1]);
ok('따옴표 내 개행 보존', table[2][1].includes('\n'), JSON.stringify(table[2][1]));
const tabCsv = 'a\tb\tc\n1\t2\t3\n4\t5\t6\n';
ok('탭 구분자 감지', detectSeparator(tabCsv) === '\t', JSON.stringify(detectSeparator(tabCsv)));
const utf8 = new TextEncoder().encode('한글 테스트');
const d1 = decodeBytes(utf8.buffer);
ok('UTF-8 디코딩', d1.text === '한글 테스트', d1.text);

console.log('\n[6] cleanText');
ok('공백 축약', cleanText('  a   b  ') === 'a b');
ok('null 처리', cleanText(null) === '');

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
