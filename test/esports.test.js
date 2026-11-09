// 이스포츠 신청 검증 (실DB 미사용, 메모리 mock: esports_members.student_id UNIQUE + ON DELETE CASCADE 흉내)
// 실행: node test/esports.test.js
const assert = require('assert');
const E = require('../lib/esports');

function makeDb(users) {
  const tables = { users: users.slice(), esports_teams: [], esports_members: [] };
  const seq = { esports_teams: 0, esports_members: 0 };
  const delay = () => new Promise(r => setTimeout(r, Math.random() * 4));
  const clone = o => JSON.parse(JSON.stringify(o));
  function q(table) {
    const st = { filters: [], ins: [], likes: [], op: 'select', payload: null, order: false };
    const run = async () => {
      await delay();
      const match = r => st.filters.every(([k, v]) => String(r[k]) === String(v)) &&
        st.ins.every(([k, vs]) => vs.map(String).includes(String(r[k]))) &&
        st.likes.every(([k, p]) => String(r[k]).startsWith(p.replace(/%$/, '')));
      if (st.op === 'insert') {
        const arr = Array.isArray(st.payload) ? st.payload : [st.payload];
        const out = [];
        // 한 문장 = 원자적: 중복이 하나라도 있으면 전부 실패
        if (table === 'esports_members') {
          const ids = new Set(tables.esports_members.map(m => m.student_id));
          for (const r of arr) { if (ids.has(r.student_id)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint esports_members_student_unique' } }; ids.add(r.student_id); }
        }
        for (const r of arr) { const row = Object.assign({ id: ++seq[table], created_at: new Date().toISOString() }, clone(r)); tables[table].push(row); out.push(clone(row)); }
        return { data: out, error: null };
      }
      if (st.op === 'delete') {
        const gone = tables[table].filter(match);
        tables[table] = tables[table].filter(r => !match(r));
        if (table === 'esports_teams') tables.esports_members = tables.esports_members.filter(m => !gone.some(g => g.id === m.team_id));
        return { data: null, error: null };
      }
      let out = tables[table].filter(match).map(clone);
      if (st.order) out.sort((a, b) => a.id - b.id);
      return { data: out, error: null };
    };
    const b = {
      select() { return b; }, eq(k, v) { st.filters.push([k, v]); return b; }, in(k, vs) { st.ins.push([k, vs]); return b; },
      like(k, p) { st.likes.push([k, p]); return b; }, order() { st.order = true; return b; },
      insert(p) { st.op = 'insert'; st.payload = p; return b; }, delete() { st.op = 'delete'; return b; },
      then(res, rej) { return run().then(res, rej); }
    };
    return b;
  }
  return { from: q, tables };
}

function users() {
  const u = [];
  for (const g of [1, 2, 3]) for (let c = 1; c <= 3; c++) for (let n = 1; n <= 20; n++)
    u.push({ id: `${g}${String(c).padStart(2, '0')}${String(n).padStart(2, '0')}`, name: `학생${g}${c}${n}`, role: 'student' });
  u.push({ id: 'T001', name: '교사', role: 'teacher' });
  return u;
}
const ids = (c, from, n) => Array.from({ length: n }, (_, i) => `3${String(c).padStart(2, '0')}${String(from + i).padStart(2, '0')}`);
const mem = (arr) => arr.map(id => ({ id, tier: '골드' }));

(async () => {
  const db = makeDb(users());
  // 대상 여부
  assert.strictEqual((await E.status(db, '10101')).eligible, false);
  assert.strictEqual((await E.status(db, '20105')).eligible, false);
  assert.strictEqual((await E.status(db, 'T001')).eligible, false);
  assert.strictEqual((await E.status(db, '30101')).eligible, true);
  // 1,2학년은 신청/검색 불가
  assert(!(await E.apply(db, { studentId: '10101', game: 'steppin', tier: '실버' })).success);
  assert(!(await E.search(db, '10101', '학생')).success);

  // 종목별 정확한 인원
  const [a, b, c, d, e] = ids(1, 1, 5);
  assert(!(await E.apply(db, { studentId: a, game: 'lol', teamName: 'T', tier: '골드', members: mem([b, c, d]) })).success, 'lol 4명 거부');
  assert(!(await E.apply(db, { studentId: a, game: 'lol', teamName: 'T', tier: '골드', members: mem([b, c, d, e, '30106']) })).success, 'lol 6명 거부');
  assert(!(await E.apply(db, { studentId: a, game: 'brawl', teamName: 'T', tier: '골드', members: mem([b]) })).success, 'brawl 2명 거부');
  assert(!(await E.apply(db, { studentId: a, game: 'steppin', tier: '골드', members: mem([b]) })).success, 'steppin 2명 거부');
  assert(!(await E.apply(db, { studentId: a, game: 'lol', teamName: '', tier: '골드', members: mem([b, c, d, e]) })).success, '팀명 필수');
  assert(!(await E.apply(db, { studentId: a, game: 'lol', teamName: 'T', tier: '', members: mem([b, c, d, e]) })).success, '내 티어 필수');
  assert(!(await E.apply(db, { studentId: a, game: 'lol', teamName: 'T', tier: '골드', members: [{ id: b, tier: '' }, ...mem([c, d, e])] })).success, '팀원 티어 필수');
  assert(!(await E.apply(db, { studentId: a, game: 'lol', teamName: 'T', tier: '골드', members: mem([b, b, c, d]) })).success, '팀 내 중복 거부');
  assert(!(await E.apply(db, { studentId: a, game: 'lol', teamName: 'T', tier: '골드', members: mem([a, b, c, d]) })).success, '본인 중복 거부');
  assert(!(await E.apply(db, { studentId: a, game: 'lol', teamName: 'T', tier: '골드', members: mem([b, c, d, '20101']) })).success, '2학년 팀원 거부');
  assert(!(await E.apply(db, { studentId: a, game: 'chess', tier: '골드' })).success, '없는 종목');
  assert.strictEqual(db.tables.esports_teams.length, 0, '실패 시 아무것도 저장 안 됨');

  // 정상 신청: 롤 5명
  const r1 = await E.apply(db, { studentId: a, game: 'lol', teamName: '천중마', tier: '플래 4', members: mem([b, c, d, e]) });
  assert(r1.success, r1.msg);
  assert.strictEqual(r1.team.members.length, 5); assert(r1.team.members[0].isLeader);

  // 이미 신청한 사람은 다른 종목/다른 팀 리더·팀원 모두 불가
  assert(!(await E.apply(db, { studentId: a, game: 'steppin', tier: '골드' })).success, '리더 중복 신청 거부');
  assert(!(await E.apply(db, { studentId: b, game: 'steppin', tier: '골드' })).success, '팀원으로 이미 포함된 학생 단독 신청 거부');
  const [f, g] = ids(2, 1, 2), h = ids(2, 3, 1)[0];
  assert(!(await E.apply(db, { studentId: f, game: 'brawl', teamName: 'X', tier: '1', members: mem([g, c]) })).success, '이미 팀인 학생 영입 거부');
  assert.strictEqual(db.tables.esports_teams.length, 1);

  // 검색: 3학년만, 본인 제외, taken 표시
  const s = await E.search(db, f, '학생3');
  assert(s.success && s.list.every(x => x.id[0] === '3') && s.list.every(x => x.id !== f));
  assert(s.list.find(x => x.id === b).taken === true);
  assert(s.list.find(x => x.id === g).taken === false);
  assert.strictEqual((await E.search(db, f, '20101')).list.length, 0, '2학년 학번 검색 불가');
  assert.strictEqual((await E.search(db, f, b)).list[0].id, b, '학번 검색');
  assert.deepStrictEqual((await E.search(db, f, '')).list, []);

  // 내 신청 보기: 팀원도 볼 수 있고, 리더만 취소 가능
  const sb = await E.status(db, b);
  assert(sb.team && sb.team.leaderId === a && sb.isLeader === false);
  assert(!(await E.cancel(db, b)).success, '팀원은 취소 불가');
  assert.strictEqual(db.tables.esports_teams.length, 1);

  // 스테핀 개인 / 브롤 3명
  const rs = await E.apply(db, { studentId: f, game: 'steppin', tier: '다이아', members: [] });
  assert(rs.success, rs.msg); assert.strictEqual(rs.team.members.length, 1);
  const rb = await E.apply(db, { studentId: g, game: 'brawl', teamName: '브롤', tier: '1000', members: mem([h, '30301']) });
  assert(rb.success, rb.msg);

  // 교사 조회
  assert(!(await E.list(db, a)).success, '학생은 조회 불가');
  const L = await E.list(db, 'T001');
  assert(L.success && L.totalTeams === 3 && L.totalPeople === 5 + 1 + 3);
  assert.strictEqual(L.games.find(x => x.key === 'steppin').teams.length, 1);

  // 리더 취소 → 팀원 모두 풀려남 → 재신청 가능
  assert((await E.cancel(db, a)).success);
  assert.strictEqual((await E.status(db, b)).team, null);
  assert((await E.apply(db, { studentId: b, game: 'steppin', tier: '골드' })).success, '취소 후 재신청 가능');
  // 교사 삭제
  const tid = (await E.status(db, b)).team.id;
  assert(!(await E.teacherRemove(db, b, tid)).success);
  assert((await E.teacherRemove(db, 'T001', tid)).success);
  assert.strictEqual((await E.status(db, b)).team, null);

  // 동시 신청 경합: 같은 학생을 동시에 여러 팀이 영입 → 최대 1팀만 성공, 고아 팀/멤버 없음
  for (let round = 0; round < 15; round++) {
    const db2 = makeDb(users());
    const [x1, x2, x3, x4, x5, shared] = ids(3, 1, 6);
    const calls = [
      E.apply(db2, { studentId: x1, game: 'brawl', teamName: 'A', tier: '1', members: mem([x2, shared]) }),
      E.apply(db2, { studentId: x3, game: 'brawl', teamName: 'B', tier: '1', members: mem([x4, shared]) }),
      E.apply(db2, { studentId: shared, game: 'steppin', tier: '1', members: [] }),
      E.apply(db2, { studentId: x5, game: 'steppin', tier: '1', members: [] }),
      E.apply(db2, { studentId: x5, game: 'steppin', tier: '1', members: [] })
    ];
    const res = await Promise.all(calls);
    const per = {}; db2.tables.esports_members.forEach(m => { per[m.student_id] = (per[m.student_id] || 0) + 1; });
    assert(Object.values(per).every(n => n === 1), 'one team per student');
    const sharedWins = res.slice(0, 3).filter(r => r.success).length;
    assert(sharedWins <= 1, 'shared student in at most one team');
    assert(db2.tables.esports_teams.every(t => db2.tables.esports_members.some(m => m.team_id === t.id)), 'no orphan teams');
  }
  console.log('esports tests passed');
})().catch(e => { console.error(e); process.exit(1); });
