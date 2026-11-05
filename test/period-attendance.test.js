// 학급 출석부(교시별) 저장/조회 로직 검증 — 실DB 미사용, 메모리 mock
// 실행: node test/period-attendance.test.js
const assert = require('assert');
const PA = require('../lib/period-attendance');

function makeDb(seed) {
  const tables = { users: seed.slice(), attendance_records: [], attendance_periods: [] };
  let seq = 0;
  const conflictKeys = { attendance_records: ['date', 'student_id', 'period'], attendance_periods: ['date', 'grade', 'class_nm', 'period'] };
  function q(table) {
    const st = { filters: [], ins: [], likes: [], op: 'select', payload: null, single: false };
    const match = r => st.filters.every(([k, v]) => String(r[k]) === String(v))
      && st.ins.every(([k, vs]) => vs.map(String).includes(String(r[k])))
      && st.likes.every(([k, p]) => String(r[k]).startsWith(p.replace(/%$/, '')));
    const run = async () => {
      const rows = tables[table];
      if (st.op === 'upsert') {
        const list = Array.isArray(st.payload) ? st.payload : [st.payload];
        const keys = conflictKeys[table];
        list.forEach(p => {
          const ex = rows.find(r => keys.every(k => String(r[k]) === String(p[k])));
          if (ex) Object.assign(ex, p); else rows.push(Object.assign({ id: ++seq }, p));
        });
        return { data: null, error: null };
      }
      if (st.op === 'delete') { tables[table] = rows.filter(r => !match(r)); return { data: null, error: null }; }
      const out = rows.filter(match).map(r => Object.assign({}, r));
      if (st.single) return { data: out[0] || null, error: null };
      return { data: out, error: null };
    };
    const b = {
      select() { return b; },
      eq(k, v) { st.filters.push([k, v]); return b; },
      in(k, vs) { st.ins.push([k, vs]); return b; },
      like(k, p) { st.likes.push([k, p]); return b; },
      maybeSingle() { st.single = true; return b; },
      upsert(p) { st.op = 'upsert'; st.payload = p; return b; },
      delete() { st.op = 'delete'; return b; },
      then(res, rej) { return run().then(res, rej); }
    };
    return b;
  }
  return { from: q, tables };
}

const users = [
  { id: 'T01', name: '김교사', role: 'teacher' },
  { id: 'T02', name: '이담임', role: 'teacher' },
  { id: '10301', name: '가', role: 'student' },
  { id: '10302', name: '나', role: 'student' },
  { id: '10303', name: '다', role: 'student' },
  { id: '10401', name: '다른반', role: 'student' },
  { id: '13001', name: '30반', role: 'student' },
  { id: '10399', name: '반이름교사', role: 'teacher' }
];
const tt = async (ymd, g, c) => (ymd === '20261106' && g === 1 && c === 3 ? [{ period: 1, subject: '국어' }, { period: 2, subject: '수학' }, { period: 3, subject: '과학' }] : []);

(async () => {
  const db = makeDb(users);
  const deps = { supabase: db, getNeisTimetable: tt };
  const base = { teacherId: 'T01', date: '20261106', grade: '1', classNm: '3' };

  // 학생은 거부
  let r = await PA.handle(Object.assign({}, base, { action: 'load', teacherId: '10301' }), deps);
  assert.strictEqual(r.success, false);

  // load: 시간표 + 1학년 3반 학생만
  r = await PA.handle(Object.assign({}, base, { action: 'load' }), deps);
  assert.ok(r.success, r.msg);
  assert.deepStrictEqual(r.roster.map(s => s.id), ['10301', '10302', '10303']);
  assert.strictEqual(r.timetable.length, 3);
  assert.deepStrictEqual(r.records, []);

  // 1교시: 10301 지각, 10302 결석(질병), 잘못된 상태/다른 반 학생은 무시. 2,3교시에도 추가
  r = await PA.handle(Object.assign({}, base, {
    action: 'saveMarks', period: 1, subjects: { 1: '국어', 2: '수학', 3: '과학' }, extraPeriods: [2, 3],
    marks: [
      { studentId: '10301', status: 'late' }, { studentId: '10302', status: 'absent_sick', note: '병원' },
      { studentId: '10303', status: 'bogus' }, { studentId: '10401', status: 'late' }
    ]
  }), deps);
  assert.ok(r.success, r.msg);
  assert.strictEqual(db.tables.attendance_records.length, 6);
  assert.strictEqual(r.periods.length, 3);
  assert.ok(r.periods.every(p => p.teacherName === '김교사' && p.exceptionCount === 2));
  assert.strictEqual(r.records.find(x => x.studentId === '10302' && x.period === 1).note, '병원');

  // 담임이 2교시 재저장: 10301은 출석으로 복귀(삭제), 10302 유지, 10303 조퇴(질병) 추가
  r = await PA.handle(Object.assign({}, base, {
    teacherId: 'T02', action: 'saveMarks', period: 2, subject: '수학',
    marks: [{ studentId: '10302', status: 'absent_sick' }, { studentId: '10303', status: 'early_leave_sick' }]
  }), deps);
  assert.ok(r.success, r.msg);
  const p2 = r.records.filter(x => x.period === 2).map(x => x.studentId + ':' + x.status).sort();
  assert.deepStrictEqual(p2, ['10302:absent_sick', '10303:early_leave_sick']);
  // 다른 교시는 그대로
  assert.strictEqual(r.records.filter(x => x.period === 1).length, 2);
  assert.strictEqual(r.records.filter(x => x.period === 3).length, 2);
  const m2 = r.periods.find(p => p.period === 2);
  assert.strictEqual(m2.teacherName, '이담임');
  assert.strictEqual(m2.exceptionCount, 2);

  // 예외 0명 저장도 '확인' 기록이 남음 (3교시 전원 출석)
  r = await PA.handle(Object.assign({}, base, { action: 'saveMarks', period: 3, subject: '과학', marks: [] }), deps);
  assert.ok(r.success);
  assert.strictEqual(r.records.filter(x => x.period === 3).length, 0);
  assert.strictEqual(r.periods.find(p => p.period === 3).exceptionCount, 0);

  // extraPeriods merge는 그 교시의 다른 학생을 지우지 않음
  r = await PA.handle(Object.assign({}, base, { action: 'saveMarks', period: 1, subject: '국어', extraPeriods: [2],
    marks: [{ studentId: '10301', status: 'absent_unexcused' }, { studentId: '10302', status: 'absent_sick' }] }), deps);
  const p2b = r.records.filter(x => x.period === 2).map(x => x.studentId + ':' + x.status).sort();
  assert.deepStrictEqual(p2b, ['10301:absent_unexcused', '10302:absent_sick', '10303:early_leave_sick']);
  assert.strictEqual(r.periods.find(p => p.period === 2).exceptionCount, 3);

  // 시간표 없는 날 + 자유 교시 번호
  r = await PA.handle({ action: 'load', teacherId: 'T01', date: '20261107', grade: 1, classNm: 3 }, deps);
  assert.ok(r.success); assert.deepStrictEqual(r.timetable, []); assert.deepStrictEqual(r.records, []);
  r = await PA.handle({ action: 'saveMarks', teacherId: 'T01', date: '20261107', grade: 1, classNm: 3, period: 7, subject: '보충', marks: [{ studentId: '10303', status: 'result' }] }, deps);
  assert.ok(r.success); assert.strictEqual(r.records[0].subject, '보충');

  // 입력 검증
  r = await PA.handle({ action: 'saveMarks', teacherId: 'T01', date: 'x', grade: 1, classNm: 3, period: 1, marks: [] }, deps);
  assert.strictEqual(r.success, false);
  r = await PA.handle({ action: 'saveMarks', teacherId: 'T01', date: '20261107', grade: 1, classNm: 3, period: 11, marks: [] }, deps);
  assert.strictEqual(r.success, false);

  // 조퇴 3종 허용, 구 early_leave는 거부
  assert.ok(PA.STATUSES.early_leave_sick);
  assert.ok(PA.STATUSES.early_leave_unexcused);
  assert.ok(PA.STATUSES.early_leave_excused);
  assert.strictEqual(PA.STATUSES.early_leave, undefined);
  const cleaned = PA.cleanMarks([
    { studentId: '10301', status: 'early_leave_excused' },
    { studentId: '10302', status: 'early_leave' },
    { studentId: '10303', status: 'early_leave_unexcused' }
  ], ['10301', '10302', '10303']);
  assert.deepStrictEqual(cleaned.map(x => x.student_id + ':' + x.status).sort(),
    ['10301:early_leave_excused', '10303:early_leave_unexcused']);

  console.log('period-attendance tests: OK');
})().catch(e => { console.error(e); process.exit(1); });
