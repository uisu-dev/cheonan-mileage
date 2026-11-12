// 상담 기록 열람 권한/공유 검증 (메모리 mock)
// 실행: node test/counseling.test.js
const assert = require('assert');
const C = require('../lib/counseling');
const { makeDb } = require('./_mockdb');

function seed() {
  return {
    users: [
      { id: 'T1', name: '김교사', role: 'teacher' }, { id: 'T2', name: '이교사', role: 'teacher' },
      { id: 'T3', name: '박교사', role: 'teacher' }, { id: 'A1', name: '관리자', role: 'admin' },
      { id: '10101', name: '가학생', role: 'student' }, { id: '10102', name: '나학생', role: 'student' }, { id: '20305', name: '다학생', role: 'student' }
    ],
    counseling_logs: [
      { id: 1, student_id: '10101', teacher_id: 'T1', teacher_name: '김교사', counsel_date: '2026-11-01T10:00:00+00:00', counsel_type: '일반 상담', content: 'T1-가', file_url: 'https://x/storage/v1/object/public/counseling-files/a.pdf', session_id: '' },
      { id: 2, student_id: '10101', teacher_id: 'T2', teacher_name: '이교사', counsel_date: '2026-11-02T10:00:00+00:00', content: 'T2-가', session_id: '' },
      { id: 3, student_id: '10101', teacher_id: 'T1', teacher_name: '김교사', counsel_date: '2026-10-05T10:00:00+00:00', content: 'T1-공동', session_id: 's1' },
      { id: 4, student_id: '10102', teacher_id: 'T1', teacher_name: '김교사', counsel_date: '2026-10-05T10:00:00+00:00', content: 'T1-공동', session_id: 's1' },
      { id: 5, student_id: '20305', teacher_id: 'T2', teacher_name: '이교사', counsel_date: '2026-09-01T23:30:00+00:00', content: 'T2-다', session_id: '' },
      { id: 6, student_id: '10101', teacher_id: null, teacher_name: '퇴직교사', counsel_date: '2026-03-01T10:00:00+00:00', content: '작성자 불명', session_id: '' }
    ],
    counseling_shares: []
  };
}
const mk = () => makeDb(seed(), { unique: { counseling_shares: [['log_id', 'teacher_id']] }, cascade: { counseling_logs: [['counseling_shares', 'log_id']] } });
const ids = rs => rs.map(r => r.id).sort((a, b) => a - b);

(async () => {
  assert.strictEqual(C.formatCounselDate('2026-11-01T10:05:00+00:00'), '2026-11-01 10:05', '기존 표시 방식 유지');
  const d = mk();
  const H = o => C.handle(o, { supabase: d });

  // 교사 아님 → 모든 읽기 거부
  for (const a of ['list', 'listAll', 'setShares', 'delete', 'teachers']) {
    assert(!(await H({ action: a, teacherId: '10101', studentId: '10101', id: 1 })).success, '학생 거부 ' + a);
    assert(!(await H({ action: a, studentId: '10101', id: 1 })).success, 'teacherId 없음 거부 ' + a);
  }

  // 학생별 목록: 내 것만
  let r = await H({ action: 'list', teacherId: 'T1', studentId: '10101' });
  assert.deepStrictEqual(ids(r.records), [1, 3], 'T1은 자기 것만');
  r = await H({ action: 'list', teacherId: 'T2', studentId: '10101' });
  assert.deepStrictEqual(ids(r.records), [2], 'T2는 자기 것만');
  assert.deepStrictEqual(ids((await H({ action: 'list', teacherId: 'T3', studentId: '10101' })).records), [], 'T3 없음');
  assert.deepStrictEqual(ids((await H({ action: 'list', teacherId: 'A1', studentId: '10101' })).records), [], 'admin도 전체 열람 안 됨');
  assert(!(await H({ action: 'listAll', teacherId: 'A1' })).records.some(x => x.id === 6), '작성자 불명 기록은 아무도 못 봄');

  // 전체 목록
  r = await H({ action: 'listAll', teacherId: 'T1' });
  assert.deepStrictEqual(ids(r.records), [1, 3, 4]);
  assert(r.records.every(x => x.isMine && Array.isArray(x.sharedWith)));
  assert.strictEqual(r.records.find(x => x.id === 4).studentName, '나학생');
  assert.deepStrictEqual(r.records.map(x => x.id).slice(0, 1), [1], '날짜 내림차순');

  // 공유: 작성자만, 대상은 교사만, 본인 제외
  assert(!(await H({ action: 'setShares', teacherId: 'T2', id: 1, teacherIds: ['T2'] })).success, '작성자 아니면 공유 불가');
  assert(!(await H({ action: 'setShares', teacherId: 'T1', id: 1, teacherIds: ['10101'] })).success, '학생에게 공유 불가');
  r = await H({ action: 'setShares', teacherId: 'T1', id: 1, teacherIds: ['T2', 'T1', 'T2'] });
  assert(r.success, r.msg); assert.deepStrictEqual(r.sharedWith.map(x => x.id), ['T2'], '본인/중복 제외');
  r = await H({ action: 'list', teacherId: 'T2', studentId: '10101' });
  assert.deepStrictEqual(ids(r.records), [1, 2], '공유받은 기록 보임');
  const got = r.records.find(x => x.id === 1);
  assert(!got.isMine && got.sharedFrom === '김교사' && got.sharedWith === undefined, '공유받음 표시, 공유 대상 목록은 작성자만');
  assert.deepStrictEqual(ids((await H({ action: 'list', teacherId: 'T3', studentId: '10101' })).records), [], '공유 안 받은 T3는 여전히 못 봄');
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'T2' })).records), [1, 2, 5]);
  assert.deepStrictEqual((await H({ action: 'list', teacherId: 'T1', studentId: '10101' })).records.find(x => x.id === 1).sharedWith.map(x => x.name), ['이교사']);

  // 공유받은 교사는 삭제·재공유 불가
  assert(!(await H({ action: 'delete', teacherId: 'T2', id: 1 })).success, '공유받은 교사 삭제 불가');
  assert(!(await H({ action: 'setShares', teacherId: 'T2', id: 1, teacherIds: ['T3'] })).success, '공유받은 교사 재공유 불가');
  assert(d.tables.counseling_logs.some(x => x.id === 1));

  // 공동 상담: 세션 전체에 공유 적용
  r = await H({ action: 'setShares', teacherId: 'T1', id: 3, teacherIds: ['T3', 'A1'] });
  assert(r.success && r.rowsAffected === 2);
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'T3' })).records), [3, 4]);
  // 공유 교체/해제
  r = await H({ action: 'setShares', teacherId: 'T1', id: 4, teacherIds: ['A1'] }); assert(r.success);
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'T3' })).records), [], '공유 해제됨');
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'A1' })).records), [3, 4]);
  r = await H({ action: 'setShares', teacherId: 'T1', id: 3, teacherIds: [] }); assert(r.success);
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'A1' })).records), []);

  // 필터
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'T2', grade: '2' })).records), [5]);
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'T2', grade: '2', classNm: '3' })).records), [5]);
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'T2', classNm: '1' })).records), [1, 2]);
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'T2', q: '다학' })).records), [5]);
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'T2', q: '10101' })).records), [1, 2]);
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'T2', from: '2026-11-02', to: '2026-11-30' })).records), [2]);
  assert.deepStrictEqual(ids((await H({ action: 'listAll', teacherId: 'T2', from: '2026-09-01', to: '2026-09-01' })).records), [5], '날짜 경계(표시 날짜 기준)');

  // 교사 목록(공유 대상 검색용): 본인 제외
  r = await H({ action: 'teachers', teacherId: 'T1' });
  assert.deepStrictEqual(r.teachers.map(x => x.id).sort(), ['A1', 'T2', 'T3']);

  // 삭제: 작성자만, 공유 행 같이 정리
  r = await H({ action: 'delete', teacherId: 'T1', id: 1 }); assert(r.success);
  assert(!d.tables.counseling_shares.some(s => s.log_id === 1), '공유 행 정리');
  assert.deepStrictEqual(d.removed, ['a.pdf'], '첨부파일 정리');
  assert.deepStrictEqual(ids((await H({ action: 'list', teacherId: 'T2', studentId: '10101' })).records), [2]);
  // 공동 상담 전체 삭제는 내가 작성한 세션 행만
  d.tables.counseling_logs.push({ id: 7, student_id: '20305', teacher_id: 'T2', teacher_name: '이교사', counsel_date: '2026-10-05T10:00:00+00:00', content: '다른 교사 같은 세션?', session_id: 's1' });
  r = await H({ action: 'delete', teacherId: 'T1', id: 3, mode: 'all' }); assert(r.success);
  assert.deepStrictEqual(d.tables.counseling_logs.filter(x => x.session_id === 's1').map(x => x.id), [7], '다른 교사 행은 남음');
  assert(d.tables.counseling_logs.some(x => x.id === 6), '작성자 불명 기록 보존');
  console.log('counseling tests: OK');
})().catch(e => { console.error(e); process.exit(1); });
