// 학교통일교육 복권 정원/1인1회 검증 (실DB 미사용, 메모리 mock + 무작위 지연으로 동시성 흉내)
// 실행: node test/unify-scratch.test.js
const assert = require('assert');
const U = require('../lib/unify-scratch');

function makeDb(users) {
  const tables = { users: users.slice(), survey_logs: [] };
  let seq = 0;
  const delay = () => new Promise(r => setTimeout(r, Math.random() * 4));
  function q(table) {
    const st = { filters: [], order: null, op: 'select', payload: null, inIds: null };
    const run = async () => {
      await delay();
      const rows = tables[table];
      const match = r => st.filters.every(([k, v]) => String(r[k]) === String(v)) && (!st.inIds || st.inIds.map(String).includes(String(r.id)));
      if (st.op === 'insert') {
        const id = ++seq;                       // 시퀀스는 먼저 발급되고
        const row = Object.assign({ id, date: new Date().toISOString() }, JSON.parse(JSON.stringify(st.payload)));
        await delay();                          // 커밋(보이게 되는 시점)은 나중 → 낮은 id가 늦게 보이는 경우 재현
        tables[table].push(row);
        return { data: [JSON.parse(JSON.stringify(row))], error: null };
      }
      if (st.op === 'update') { rows.filter(match).forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload)))); return { data: null, error: null }; }
      if (st.op === 'delete') { tables[table] = rows.filter(r => !match(r)); return { data: null, error: null }; }
      let out = rows.filter(match).map(r => JSON.parse(JSON.stringify(r)));
      if (st.order) out.sort((a, b) => a.id - b.id);
      return { data: out, error: null };
    };
    const b = {
      select() { return b; },
      eq(k, v) { st.filters.push([k, v]); return b; },
      in(k, ids) { st.inIds = ids; return b; },
      order() { st.order = true; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; },
      update(p) { st.op = 'update'; st.payload = p; return b; },
      delete() { st.op = 'delete'; return b; },
      then(res, rej) { return run().then(res, rej); }
    };
    return b;
  }
  return { from: q, tables };
}

function students() {
  const u = [];
  for (const g of [1, 2, 3]) for (let c = 1; c <= 8; c++) for (let n = 1; n <= 27; n++)
    u.push({ id: `${g}${String(c).padStart(2, '0')}${String(n).padStart(2, '0')}`, name: `학생${g}${c}${n}`, role: 'student' });
  u.push({ id: 'T001', name: '교사', role: 'teacher' }, { id: '00001', name: '테스트', role: 'student' });
  return u;
}

(async () => {
  const quota = U.UNIFY_GRADE_QUOTA;
  let maxSeen = { 1: 0, 2: 0, 3: 0 };
  for (let round = 0; round < 12; round++) {
    const users = students();
    const db = makeDb(users);
    const stu = users.filter(x => x.role === 'student' && /^[123]/.test(x.id));
    // 모두 동시에, 일부는 2~3번 연타 + 높은 당첨 확률(경합 극대화)
    const rand = round % 2 ? () => 0 : Math.random;  // 짝수 라운드: 실제 확률, 홀수: 항상 당첨 시도
    const calls = [];
    for (const s of stu) { const k = 1 + Math.floor(Math.random() * 3); for (let i = 0; i < k; i++) calls.push(U.play(db, s.id, rand)); }
    const res = await Promise.all(calls);
    assert(res.every(r => r.success), 'all student calls succeed');
    const rows = db.tables.survey_logs;
    // 1인 1행
    const per = {}; rows.forEach(r => { per[r.student_id] = (per[r.student_id] || 0) + 1; });
    assert(Object.values(per).every(n => n === 1), 'one row per student');
    assert.strictEqual(Object.keys(per).length, stu.length);
    // 정원 초과 없음
    for (const g of ['1', '2', '3']) {
      const w = rows.filter(r => r.answer.result === 'win' && r.student_id[0] === g).length;
      assert(w <= quota[g], `grade ${g} winners ${w} <= ${quota[g]}`);
      maxSeen[g] = Math.max(maxSeen[g], w);
    }
    // 이후 재호출/상태 조회는 저장값과 동일
    for (const s of stu.slice(0, 30)) {
      const st = await U.status(db, s.id); const again = await U.play(db, s.id, () => 0);
      assert.strictEqual(st.result, again.result); assert(again.already);
    }
    const w = await U.winners(db);
    assert(w.list.length <= 10);
  }
  // 교사/학년불명 거부
  const db = makeDb(students());
  assert(!(await U.play(db, 'T001')).success);
  assert(!(await U.play(db, '00001')).success);
  assert(!(await U.play(db, '19999')).success); // 없는 학생
  // 순차: 항상 당첨 시도 → 정확히 3/3/4 채워짐
  const db2 = makeDb(students());
  for (const s of students().filter(x => /^[123]\d{4}$/.test(x.id))) await U.play(db2, s.id, () => 0);
  const ww = await U.winners(db2);
  const byG = g => ww.list.filter(x => x.grade === g).length;
  assert.deepStrictEqual([byG('1'), byG('2'), byG('3')], [3, 3, 4]);
  console.log('OK. max winners seen under concurrency per grade:', maxSeen, '| sequential fill:', [byG('1'), byG('2'), byG('3')], '| p =', U.UNIFY_WIN_PROBABILITY);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
