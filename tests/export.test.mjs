import { buildWorkbook, splitLongColumns, scrub } from '../public/static/export.js';
import { analyze, buildExportSheets } from '../public/static/engine.js';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { fileURLToPath } = require('url');
const { dirname, resolve } = require('path');
const fs = require('fs');
const vm = require('vm');

/*
 * 저장소에 포함된 SheetJS 브라우저 번들을 로드한다 (외부 CDN 의존 없음).
 * 이 패키지는 "type":"module" 이라 .js 를 require 하면 ESM 으로 해석되어
 * exports 가 비어버린다. 그래서 브라우저와 동일하게 샌드박스에서 실행해
 * 전역 XLSX 를 얻는다.
 *
 * 주의: 샌드박스에 module/exports 를 넣으면 UMD 번들이 CJS 분기를 타면서
 *       utils(XLSX.utils) 가 빠진 채로 반환된다. 전역만 주어야 정상이다.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const VENDOR = resolve(HERE, '../public/static/vendor/xlsx.full.min.js');
function loadXLSX() {
  const sandbox = { console };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(VENDOR, 'utf8'), sandbox);
  return sandbox.XLSX || null;
}
const XLSX = loadXLSX();
if (!XLSX || typeof XLSX.utils?.book_new !== 'function') {
  console.error('[준비 실패] 로컬 xlsx 번들을 로드하지 못했습니다:', VENDOR);
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (n, c, e='') => c ? (pass++, console.log('  ✓', n)) : (fail++, console.log('  ✗', n, e));

const dict = {
  stopwords: new Set(['은','는','정보']),
  securityWords: [['주민등록번호','개인정보','매우 높음'],['비밀번호','인증정보','매우 높음']],
  patterns: [['이메일 주소','\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b','개인정보','중간']],
  patternTypes: [['프로젝트/사업 코드','[A-Z]{2,6}[-_](?:19|20)\\d{2}[-_]\\d{3,8}','업무식별자','중간']],
};
const rows = [
  { 담당자:'홍길동', 메모:'주민등록번호 확인', 코드:'PJT-2026-12345' },
  { 담당자:'김철수', 메모:'비밀번호 변경 user@test.com', 코드:'PJT-2025-11111' },
];
const r = await analyze({ rows, rowNumbers:[2,3], columns:['담당자','메모','코드'], dict, patternTypes:true });
const re = { rows:[{순위:1,정규화단어:'주민등록번호',빈도:1}], phrases:[{순위:1,'보안문구 후보':'주민등록번호 확인'}], stats:{} };
const sheets = buildExportSheets({ result:r, reResult:re, ptResult:{types:r.pt_types,variants:r.pt_variants,stats:r.pt_stats}, summaryMeta:{} }, dict);

console.log('\n[1] 시트 구성 (원본 12개)');
ok('시트 12개', sheets.length === 12, sheets.length);
const names = sheets.map(s=>s.name);
console.log('   ', names.join(', '));
for (const need of ['Summary','Word_Frequency','Security_Analysis','Findings','Excluded_Words','Security_Dictionary','Pattern_Dictionary','Reanalysis_Words','Security_Phrases','Pattern_Types','Pattern_Type_Values','Pattern_Type_Dictionary'])
  ok('시트 포함: '+need, names.includes(need));

console.log('\n[2] xlsx 실제 생성');
const arr = buildWorkbook(XLSX, sheets);
ok('바이트 생성', arr && arr.byteLength > 2000, arr && arr.byteLength);
fs.writeFileSync('/tmp/swa_test.xlsx', Buffer.from(arr));
const wb = XLSX.read(fs.readFileSync('/tmp/swa_test.xlsx'), { type:'buffer' });
ok('재읽기 성공', wb.SheetNames.length === 12, wb.SheetNames.length);
ok('Summary 내용 존재', XLSX.utils.sheet_to_json(wb.Sheets['Summary']).length > 0);
const secSheet = XLSX.utils.sheet_to_json(wb.Sheets['Security_Analysis']);
ok('보안분석 시트에 주민등록번호', JSON.stringify(secSheet).includes('주민등록번호'), secSheet.slice(0,2));
const wf = XLSX.utils.sheet_to_json(wb.Sheets['Word_Frequency']);
ok('단어빈도 시트 데이터', wf.length > 0 && Object.keys(wf[0]).includes('단어'), wf[0]);
const pd = XLSX.utils.sheet_to_json(wb.Sheets['Pattern_Dictionary']);
ok('패턴사전 시트 정규식 포함', pd.length>0 && Object.keys(pd[0]).includes('정규식'), pd[0]);

console.log('\n[3] Excel 제약 처리');
// 32,767자 초과 셀 분할
const longRow = { A: 'x'.repeat(40000), B: 'short' };
const split = splitLongColumns([longRow]);
ok('긴 셀 2열로 분할', split.columns.length === 3, split.columns);
ok('분할 후 내용 보존', (split.rows[0][split.columns[0]] + split.rows[0][split.columns[1]]).length === 40000);
// 제어문자 제거
ok('제어문자 제거', scrub('a\u0000b\u0001c') === 'abc', JSON.stringify(scrub('a\u0000b\u0001c')));
ok('탭/개행 보존', scrub('a\tb\nc') === 'a\tb\nc');
ok('숫자형 유지', scrub(123) === 123);
// 시트명 정규화(금지문자, 31자)
const bad = buildWorkbook(XLSX, [{ name:'a/b:c*d?e[f]g' + 'x'.repeat(40), rows:[{v:1}] }]);
const wb2 = XLSX.read(Buffer.from(bad), { type:'buffer' });
ok('시트명 금지문자 치환+31자', !/[[\]:*?/\\]/.test(wb2.SheetNames[0]) && wb2.SheetNames[0].length <= 31, wb2.SheetNames[0]);
// 중복 시트명
const dup = buildWorkbook(XLSX, [{name:'Same',rows:[{v:1}]},{name:'Same',rows:[{v:2}]}]);
const wb3 = XLSX.read(Buffer.from(dup), { type:'buffer' });
ok('중복 시트명 유니크화', wb3.SheetNames.length === 2 && wb3.SheetNames[0] !== wb3.SheetNames[1], wb3.SheetNames);
// 빈 결과
const empty = buildWorkbook(XLSX, [{ name:'Empty', rows:[] }]);
const wb4 = XLSX.read(Buffer.from(empty), { type:'buffer' });
ok('빈 시트도 저장(데이터 없음)', JSON.stringify(XLSX.utils.sheet_to_json(wb4.Sheets['Empty'])).includes('데이터 없음'));

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
