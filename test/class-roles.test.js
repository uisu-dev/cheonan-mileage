// 1인 1역 로직 검증 (메모리 mock)
// 실행: node test/class-roles.test.js
const assert = require('assert');
const CR = require('../lib/class-roles');
const { makeDb } = require('./_mockdb');

function seed() {
  const users = [{ id: 'T1', name: '김교사', role: 'teacher' }, { id: 'T2', name: '이교사', role: 'teacher' }, { id: 'A1', name: '관리자', role: 'admin' }];
  for (let n = 1; n <= 25; n++) users.push({ id: '201' + String(n).padStart(2, '0'), name: '학생' + n, role: 'student' });
  users.push({ id: '20201', name: '옆반', role: 'student' }, { id: '10101', name: '1학년', role: 'student' });
  return { users };
}
const db = () => makeDb(seed(), {
  unique: { class_role_types: [['school_year', 'semester', 'grade', 'class_nm', 'name']], class_role_assignments: [['student_id', 'school_year', 'semester']] },
  cascade: { class_role_types: [['class_role_assignments', 'role_id']] }
});

(async () => {
  // 학년도/학기 기본값 (서울)
  const at = s => CR.defaultTerm(new Date(s));
  assert.deepStrictEqual(at('2026-03-01T00:00:00+09:00'), { year: 2026, semester: 1 });
  assert.deepStrictEqual(at('2026-08-31T23:59:00+09:00'), { year: 2026, semester: 1 });
  assert.deepStrictEqual(at('2026-09-01T00:00:00+09:00'), { year: 2026, semester: 2 });
  assert.deepStrictEqual(at('2026-12-31T12:00:00+09:00'), { year: 2026, semester: 2 });
  assert.deepStrictEqual(at('2027-02-28T12:00:00+09:00'), { year: 2026, semester: 2 }, '1~2월은 전년도 2학기');
  assert.deepStrictEqual(at('2026-02-28T16:00:00Z'), { year: 2026, semester: 1 }, 'UTC 2/28 16시 = 서울 3/1');

  const d = db();
  const S1 = { teacherId: 'T1', grade: 2, classNm: 1, year: 2026, semester: 1 };
  const S2 = Object.assign({}, S1, { semester: 2 });
  const H = (o, base) => CR.handle(Object.assign({}, base || S1, o), { supabase: d });

  // 교사만
  assert(!(await H({ action: 'load', teacherId: '20101' })).success, '학생 불가');
  assert(!(await H({ action: 'load', teacherId: '' })).success);
  assert((await H({ action: 'load', teacherId: 'A1' })).success, 'admin 가능');
  assert(!(await H({ action: 'load', semester: 3 })).success, '학기 검증');
  assert(!(await H({ action: 'load', grade: 4 })).success, '학년 검증');

  let r = await H({ action: 'load' });
  assert.strictEqual(r.roster.length, 25, '2학년 1반만 (옆반·1학년 제외)');
  assert.strictEqual(r.roles.length, 0); assert.strictEqual(r.unassigned, 25);

  // 역할 등록/중복/이름 정리
  r = await H({ action: 'addRole', name: '  칠판  정리 ' }); assert(r.success); assert.strictEqual(r.roles[0].name, '칠판 정리');
  assert(!(await H({ action: 'addRole', name: '칠판 정리' })).success, '중복 이름');
  assert(!(await H({ action: 'addRole', name: '   ' })).success, '빈 이름');
  r = await H({ action: 'addRole', name: '우유 배달', teacherId: 'T2' }); assert(r.success);
  r = await H({ action: 'addRole', name: '분리수거' });
  const [chalk, milk, recycle] = r.roles;
  assert.strictEqual(milk.createdByName, '이교사', '다른 교사도 관리 가능, 등록자 기록');

  // 학기 분리: 2학기에는 안 보임
  assert.strictEqual((await H({ action: 'load' }, S2)).roles.length, 0, '1·2학기 목록 분리');
  // 다른 반 역할은 이 반에서 못 씀
  const other = Object.assign({}, S1, { classNm: 2 });
  r = await H({ action: 'addRole', name: '반장 도우미' }, other);
  const otherRole = r.roles[0];

  // 배정: 학기당 1개, 역할 1개에 여러 명
  r = await H({ action: 'assign', studentId: '20101', roleId: chalk.id }); assert(r.success);
  r = await H({ action: 'assign', studentId: '20102', roleId: chalk.id }); assert(r.success);
  r = await H({ action: 'assign', studentId: '20103', roleId: milk.id, teacherId: 'T2' }); assert(r.success);
  assert.strictEqual(r.assignments.filter(a => a.roleId === chalk.id).length, 2, '역할 1개에 여러 학생');
  assert.strictEqual(r.unassigned, 22);
  r = await H({ action: 'assign', studentId: '20101', roleId: recycle.id }); assert(r.success);
  assert.strictEqual(r.assignments.filter(a => a.studentId === '20101').length, 1, '학생은 학기당 1개 (변경 시 교체)');
  assert.strictEqual(r.assignments.find(a => a.studentId === '20101').roleId, recycle.id);
  assert.strictEqual(r.assignments.find(a => a.studentId === '20103').assignedByName, '이교사', '배정한 교사 기록');
  assert.strictEqual(d.tables.class_role_assignments.length, 3);
  assert(!(await H({ action: 'assign', studentId: '20201', roleId: chalk.id })).success, '다른 반 학생 불가');
  assert(!(await H({ action: 'assign', studentId: '20104', roleId: otherRole.id })).success, '다른 반 역할 불가');
  assert(!(await H({ action: 'assign', studentId: '20104', roleId: 99999 })).success, '없는 역할');
  // 2학기 역할을 1학기에 배정 불가
  r = await H({ action: 'addRole', name: '2학기 전용' }, S2);
  assert(!(await H({ action: 'assign', studentId: '20104', roleId: r.roles[0].id })).success, '다른 학기 역할 불가');

  // 해제
  r = await H({ action: 'assign', studentId: '20102', roleId: null }); assert(r.success);
  assert(!r.assignments.some(a => a.studentId === '20102'));

  // 이름 수정 (중복 거부)
  assert(!(await H({ action: 'renameRole', roleId: milk.id, name: '분리수거' })).success);
  r = await H({ action: 'renameRole', roleId: milk.id, name: '우유 당번' }); assert(r.success);
  assert(r.roles.some(x => x.name === '우유 당번'));
  assert(!(await H({ action: 'renameRole', roleId: otherRole.id, name: 'x' })).success, '다른 반 역할 수정 불가');

  // 역할 삭제 → 배정 해제
  r = await H({ action: 'deleteRole', roleId: milk.id }); assert(r.success);
  assert(!r.assignments.some(a => a.studentId === '20103'), '삭제된 역할 배정 해제');
  assert(!d.tables.class_role_assignments.some(a => a.role_id === milk.id));

  // 1학기 → 2학기 역할 복사 (이름 같으면 건너뜀, 배정은 복사 안 함)
  assert(!(await H({ action: 'copyFromFirst' })).success, '1학기 화면에서는 불가');
  await H({ action: 'addRole', name: '칠판 정리' }, S2);
  r = await H({ action: 'copyFromFirst' }, S2); assert(r.success, r.msg);
  assert.deepStrictEqual(r.roles.map(x => x.name).sort(), ['2학기 전용', '분리수거', '칠판 정리'].sort());
  assert.strictEqual(r.assignments.length, 0, '배정은 복사 안 함');
  r = await H({ action: 'copyFromFirst' }, S2); assert(r.success && /없어요/.test(r.msg), '두 번 눌러도 중복 없음');
  // 2학기 배정은 1학기와 독립 (같은 학생이 학기마다 1개씩)
  r = await H({ action: 'assign', studentId: '20101', roleId: r.roles.find(x => x.name === '칠판 정리').id }, S2); assert(r.success);
  assert.strictEqual(d.tables.class_role_assignments.filter(a => a.student_id === '20101').length, 2);
  console.log('class-roles tests: OK');
})().catch(e => { console.error(e); process.exit(1); });
