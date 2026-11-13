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
  assert.strictEqual((await E.status(db, '20105')).eligible, true);
  assert.strictEqual((await E.status(db, 'T001')).eligible, false);
  assert.strictEqual((await E.status(db, '30101')).eligible, true);
  assert(E.isEligibleId('20101') && E.isEligibleId('30101') && !E.isEligibleId('10101'));
  // 1학년은 신청/검색 불가
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
  assert(!(await E.apply(db, { studentId: a, game: 'lol', teamName: 'T', tier: '골드', members: mem([b, c, d, '10101']) })).success, '1학년 팀원 거부');
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

  // 검색: 2·3학년, 본인 제외, taken 표시
  const s = await E.search(db, f, '학생3');
  assert(s.success && s.list.every(x => x.id[0] === '3') && s.list.every(x => x.id !== f));
  assert(s.list.find(x => x.id === b).taken === true);
  assert(s.list.find(x => x.id === g).taken === false);
  assert.strictEqual((await E.search(db, f, '10101')).list.length, 0, '1학년 학번 검색 불가');
  assert.strictEqual((await E.search(db, f, '20101')).list[0].id, '20101', '2학년 학번 검색');
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
  // ===== v2: 발로란트 만 15세 + 생년월일, 중계(개인, 티어 없음, 인원 제한 없음), 전체 종목 1인 1신청 =====
  {
    const NOW = new Date('2026-11-10T03:00:00Z');                   // 서울 2026-11-10 12:00
    assert.strictEqual(E.seoulToday(new Date('2026-11-09T15:30:00Z')), '2026-11-10', 'UTC 15:30 = 서울 다음날 00:30');
    const age = (s, n) => E.fullAge(E.parseDate(s), n || NOW);
    assert.strictEqual(age('2011-11-10'), 15, '오늘이 만 15세 생일');
    assert.strictEqual(age('2011-11-11'), 14, '생일 하루 전');
    assert.strictEqual(age('2011-12-31'), 14);
    assert.strictEqual(age('2008-01-01'), 18);
    assert.strictEqual(age('2012-02-29', new Date('2027-02-28T03:00:00Z')), 14, '2/29생 평년 2/28은 아직');
    assert.strictEqual(age('2012-02-29', new Date('2027-03-01T03:00:00Z')), 15, '2/29생 평년 3/1은 지남');
    assert(E.parseDate('2010-02-30') === null && E.parseDate('abc') === null && E.parseDate('2010-5-1') === null);

    const db3 = makeDb(users());
    const [v1, v2, v3, v4, v5] = ids(1, 1, 5);
    const vm = (arr, b) => arr.map(id => ({ id, tier: '골드', birthdate: b }));
    const base = { studentId: v1, game: 'valorant', teamName: 'V', tier: '골드', birthdate: '2010-05-21' };
    const ap = (o) => E.apply(db3, Object.assign({}, base, o), NOW);
    let r = await ap({ members: vm([v2, v3, v4, v5], '2010-05-21').slice(0, 3) });
    assert(!r.success, '4명 거부');
    r = await ap({ birthdate: '', members: vm([v2, v3, v4, v5], '2010-05-21') });
    assert(!r.success && /생년월일/.test(r.msg), '리더 생년월일 필수');
    r = await ap({ members: vm([v2, v3, v4], '2010-05-21').concat([{ id: v5, tier: '골드' }]) });
    assert(!r.success && /생년월일/.test(r.msg), '팀원 생년월일 누락 거부');
    r = await ap({ members: vm([v2, v3, v4], '2010-05-21').concat([{ id: v5, tier: '골드', birthdate: '2010-13-40' }]) });
    assert(!r.success, '잘못된 날짜 거부');
    r = await ap({ members: vm([v2, v3, v4], '2010-05-21').concat([{ id: v5, tier: '골드', birthdate: '2011-11-11' }]) });
    assert(!r.success && /만 15세/.test(r.msg), '팀원 생일 안 지남(만 14세) 거부: ' + r.msg);
    r = await ap({ birthdate: '2012-03-01', members: vm([v2, v3, v4, v5], '2010-05-21') });
    assert(!r.success && /만 15세/.test(r.msg), '리더 만 15세 미만 거부');
    r = await ap({ birthdate: '2027-01-01', members: vm([v2, v3, v4, v5], '2010-05-21') });
    assert(!r.success, '미래 날짜 거부');
    assert.strictEqual(db3.tables.esports_teams.length, 0, '거부 시 저장 없음');
    // 모두 통과 (오늘이 만 15세 생일인 학생 포함)
    r = await ap({ members: vm([v2, v3, v4], '2010-05-21').concat([{ id: v5, tier: '플래', birthdate: '2011-11-10' }]) });
    assert(r.success, r.msg);
    assert.strictEqual(r.team.members.length, 5);
    assert(r.team.members.every(m => m.birthdate === undefined), '학생 응답에는 생년월일 미포함');
    assert.strictEqual(db3.tables.esports_members.filter(m => m.birthdate).length, 5, 'DB에는 5명 모두 저장');
    // 다른 종목은 생년월일 요구/저장 안 함
    const [w1, w2, w3] = ids(2, 1, 3);
    r = await E.apply(db3, { studentId: w1, game: 'brawl', teamName: 'B', tier: '1', birthdate: '2000-01-01', members: mem([w2, w3]) }, NOW);
    assert(r.success, r.msg);
    assert(db3.tables.esports_members.filter(m => [w1, w2, w3].includes(m.student_id)).every(m => !m.birthdate), '비발로란트는 생년월일 저장 안 함');

    // 중계: 개인, 티어 없이 가능, 한마디 선택, 인원 제한 없음(2명 초과 신청 가능), 1인 1신청 유지
    const c = ids(3, 1, 4);
    r = await E.apply(db3, { studentId: c[0], game: 'caster' }, NOW);
    assert(r.success, r.msg); assert.strictEqual(r.team.members.length, 1); assert.strictEqual(r.team.members[0].tier, '');
    r = await E.apply(db3, { studentId: c[1], game: 'caster', message: '말하기 좋아해요', tier: '무시됨' }, NOW);
    assert(r.success, r.msg); assert.strictEqual(r.team.members[0].message, '말하기 좋아해요'); assert.strictEqual(r.team.members[0].tier, '');
    r = await E.apply(db3, { studentId: c[2], game: 'caster' }, NOW); assert(r.success);
    r = await E.apply(db3, { studentId: c[3], game: 'caster', members: mem([ids(3, 10, 1)[0]]) }, NOW);
    assert(!r.success, '중계는 개인만');
    r = await E.apply(db3, { studentId: c[0], game: 'steppin', tier: '골드' }, NOW);
    assert(!r.success, '중계 신청자는 다른 종목 불가');
    r = await E.apply(db3, { studentId: v1, game: 'caster' }, NOW);
    assert(!r.success, '발로란트 팀원은 중계 불가');
    r = await E.apply(db3, { studentId: ids(3, 11, 1)[0], game: 'lol', teamName: 'L', tier: '1', members: mem([c[0], ids(3, 12, 1)[0], ids(3, 13, 1)[0], ids(3, 14, 1)[0]]) }, NOW);
    assert(!r.success, '중계 신청자는 팀원으로도 불가');
    // 교사 조회: 생년월일/한마디 포함, 종목 5개, 중계 note
    const L2 = await E.list(db3, 'T001');
    assert.strictEqual(L2.games.length, 5);
    const vg = L2.games.find(x => x.key === 'valorant'); assert(vg.minAge === 15 && vg.teams[0].members.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.birthdate)));
    const cg = L2.games.find(x => x.key === 'caster'); assert(cg.note === '2명 선발 예정' && cg.noTier && cg.teams.length === 3);
    assert(cg.teams.some(t => t.members[0].message === '말하기 좋아해요'));
    const st = await E.status(db3, c[0]); assert(st.games.length === 5 && st.games.find(g => g.key === 'caster').noTier);
    // 중계 취소 후 재신청
    assert((await E.cancel(db3, c[0])).success);
    assert((await E.apply(db3, { studentId: c[0], game: 'steppin', tier: '실버' }, NOW)).success);
  }
  // 종목별 경기 방식 안내(표시용 메타데이터)
  {
    const dbF = makeDb(users());
    const st = await E.status(dbF, '30101'); const L3 = await E.list(dbF, 'T001');
    const fmt = { lol: '소환사의 협곡 (비공개 선택)', valorant: '토너먼트 모드 및 연장 2점 승리 옵션', brawl: '젬 그랩, 브롤 볼, 하이스트', steppin: '배틀모드', caster: '' };
    for (const k of Object.keys(fmt)) {
      assert.strictEqual(st.games.find(g => g.key === k).format, fmt[k], 'status format ' + k);
      assert.strictEqual(L3.games.find(g => g.key === k).format, fmt[k], 'list format ' + k);
    }
  }

  // ===== 교사 대리 등록 (teacherRegister / teacherSearch) =====
  {
    const NOW = new Date('2026-11-10T03:00:00Z');
    const dbT = makeDb(users());
    const [p1, p2, p3, p4, p5] = ids(1, 1, 5);
    const memT = (arr) => arr.map(id => ({ id, tier: '골드' }));

    // 권한: 학생은 검색/등록 불가, 교사만 가능, 리더 미지정 거부
    assert(!(await E.teacherSearch(dbT, p1, '학생')).success, '학생은 teacherSearch 불가');
    assert(!(await E.teacherRegister(dbT, { teacherId: p1, leaderId: p2, game: 'steppin', tier: '골드' }, NOW)).success, '학생은 teacherRegister 불가');
    assert(!(await E.teacherRegister(dbT, { teacherId: 'T001', game: 'steppin', tier: '골드' }, NOW)).success, '리더 미지정 거부');
    const tsEmpty = await E.teacherSearch(dbT, 'T001', '');
    assert(tsEmpty.success && tsEmpty.list.length === 0);

    // 교사 검색: 2·3학년 전원(자기 제외 없음), 이미 신청한 학생 taken
    assert((await E.apply(dbT, { studentId: p1, game: 'steppin', tier: '실버' }, NOW)).success);
    const ts = await E.teacherSearch(dbT, 'T001', '학생3');
    assert(ts.success && ts.list.every(x => x.id[0] === '3'));
    assert(ts.list.find(x => x.id === p1).taken === true);
    assert(ts.list.find(x => x.id === p2).taken === false);
    assert.strictEqual((await E.teacherSearch(dbT, 'T001', '10101')).list.length, 0, '1학년 검색 안 됨');
    assert.strictEqual((await E.teacherSearch(dbT, 'T001', '20101')).list[0].id, '20101', '2학년 검색');
    assert.strictEqual((await E.teacherSearch(dbT, 'T001', p1)).list[0].id, p1, '학번으로 본인도 검색(교사)');

    // 이미 신청한 학생을 리더/팀원으로 등록 거부
    assert(!(await E.teacherRegister(dbT, { teacherId: 'T001', leaderId: p1, game: 'brawl', teamName: 'X', tier: '1', members: memT([p2, p3]) }, NOW)).success);
    assert(!(await E.teacherRegister(dbT, { teacherId: 'T001', leaderId: p2, game: 'brawl', teamName: 'X', tier: '1', members: memT([p1, p3]) }, NOW)).success);

    // 인원/학년/티어 규칙도 apply와 동일
    assert(!(await E.teacherRegister(dbT, { teacherId: 'T001', leaderId: p2, game: 'lol', teamName: 'T', tier: '골드', members: memT([p3, p4]) }, NOW)).success, '인원 부족 거부');
    assert(!(await E.teacherRegister(dbT, { teacherId: 'T001', leaderId: p2, game: 'steppin', tier: '골드', members: memT([p3]) }, NOW)).success, '개인종목 팀원 거부');
    assert(!(await E.teacherRegister(dbT, { teacherId: 'T001', leaderId: '10101', game: 'steppin', tier: '골드' }, NOW)).success, '1학년 리더 거부');
    assert(!(await E.teacherRegister(dbT, { teacherId: 'T001', leaderId: p2, game: 'lol', teamName: 'T', tier: '골드', members: memT([p3, p4, p5, '10101']) }, NOW)).success, '1학년 팀원 거부');

    // 정상: 교사가 브롤 팀 등록, 리더는 p2 (학생 본인이 신청한 것과 동일하게 보임)
    const tr = await E.teacherRegister(dbT, { teacherId: 'T001', leaderId: p2, game: 'brawl', teamName: '교사팀', tier: '플래', members: memT([p3, p4]) }, NOW);
    assert(tr.success, tr.msg);
    assert.strictEqual(tr.msg, '학생 신청을 등록했어요.');
    assert.strictEqual(tr.team.leaderId, p2);
    assert.strictEqual(tr.team.members.length, 3);
    const stP2 = await E.status(dbT, p2);
    assert(stP2.team && stP2.isLeader && stP2.team.teamName === '교사팀');
    const stP3 = await E.status(dbT, p3);
    assert(stP3.team && stP3.isLeader === false && stP3.team.leaderId === p2);

    // 중계 개인 + 한마디
    const [c1] = ids(3, 1, 1);
    const tc = await E.teacherRegister(dbT, { teacherId: 'T001', leaderId: c1, game: 'caster', message: '교사가 등록' }, NOW);
    assert(tc.success, tc.msg);
    assert.strictEqual(tc.team.members[0].message, '교사가 등록');

    // 발로란트 만 15세 검증
    const [v1, v2, v3, v4, v5] = ids(2, 1, 5);
    const vm = (arr, b) => arr.map(id => ({ id, tier: '골드', birthdate: b }));
    const tvFail = await E.teacherRegister(dbT, { teacherId: 'T001', leaderId: v1, game: 'valorant', teamName: 'V', tier: '골드', birthdate: '2010-05-21', members: vm([v2, v3, v4], '2010-05-21').concat([{ id: v5, tier: '골드', birthdate: '2011-11-11' }]) }, NOW);
    assert(!tvFail.success && /만 15세/.test(tvFail.msg), '교사 등록도 만 15세 미만 거부: ' + tvFail.msg);
    const tvOk = await E.teacherRegister(dbT, { teacherId: 'T001', leaderId: v1, game: 'valorant', teamName: 'V', tier: '골드', birthdate: '2010-05-21', members: vm([v2, v3, v4, v5], '2010-05-21') }, NOW);
    assert(tvOk.success, tvOk.msg);
    const LT = await E.list(dbT, 'T001');
    assert(LT.games.find(x => x.key === 'brawl').teams.some(t => t.teamName === '교사팀'));
    assert(LT.games.find(x => x.key === 'valorant').teams[0].members.every(m => /^\d{4}-\d{2}-\d{2}$/.test(m.birthdate)));
  }

  // ===== 2·3학년 혼성 팀, 2학년 본인 신청, 1학년은 계속 불가 =====
  {
    const dbM = makeDb(users());
    const r2 = await E.apply(dbM, { studentId: '20105', game: 'steppin', tier: '실버' });
    assert(r2.success, r2.msg);
    assert.strictEqual((await E.status(dbM, '20105')).isLeader, true);
    // 2학년이 3학년을 팀원으로, 3학년이 2학년을 리더로
    const mix = await E.apply(dbM, { studentId: '20201', game: 'brawl', teamName: '혼성', tier: '골드', members: mem(['30301', '30110']) });
    assert(mix.success, mix.msg);
    assert.strictEqual(mix.team.members.length, 3);
    assert(mix.team.members.some(m => m.id[0] === '2') && mix.team.members.some(m => m.id[0] === '3'));
    const s23 = await E.search(dbM, '20201', '30301');
    assert(s23.success && s23.list[0].id === '30301' && s23.list[0].taken === true);
    const s2q = await E.search(dbM, '30110', '20101');
    assert(s2q.success && s2q.list[0].id === '20101' && s2q.list[0].taken === false);
    // 교사: 2학년 리더 + 3학년 팀원
    const trMix = await E.teacherRegister(dbM, { teacherId: 'T001', leaderId: '20301', game: 'lol', teamName: '교사혼성', tier: '골드', members: mem(['30111', '30112', '20106', '30113']) });
    assert(trMix.success, trMix.msg);
    assert.strictEqual(trMix.team.leaderId, '20301');
    assert.strictEqual(trMix.team.members.length, 5);
    // 1학년은 여전히 불가, 발로란트 만 15세는 2학년에도 그대로 적용
    assert(!(await E.apply(dbM, { studentId: '10101', game: 'steppin', tier: '골드' })).success);
    const NOW = new Date('2026-11-10T03:00:00Z');
    const vFail = await E.apply(dbM, { studentId: '20107', game: 'valorant', teamName: 'V2', tier: '골드', birthdate: '2011-11-11', members: [
      { id: '20108', tier: '골드', birthdate: '2010-05-21' },
      { id: '20109', tier: '골드', birthdate: '2010-05-21' },
      { id: '30114', tier: '골드', birthdate: '2010-05-21' },
      { id: '30115', tier: '골드', birthdate: '2010-05-21' }
    ] }, NOW);
    assert(!vFail.success && /만 15세/.test(vFail.msg), '2학년 리더도 만 15세 미만이면 거부: ' + vFail.msg);
    const vOk = await E.apply(dbM, { studentId: '20107', game: 'valorant', teamName: 'V2', tier: '골드', birthdate: '2010-05-21', members: [
      { id: '20108', tier: '골드', birthdate: '2010-05-21' },
      { id: '20109', tier: '골드', birthdate: '2010-05-21' },
      { id: '30114', tier: '골드', birthdate: '2010-05-21' },
      { id: '30115', tier: '골드', birthdate: '2010-05-21' }
    ] }, NOW);
    assert(vOk.success, vOk.msg);
  }
  console.log('esports tests passed');
})().catch(e => { console.error(e); process.exit(1); });
