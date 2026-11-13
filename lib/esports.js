// ===== 찾아가는 이스포츠 대회 신청 (2·3학년) =====
// 테이블: esports_teams / esports_members (sql/esports.sql)
// 한 학생은 전체 종목 통틀어 하나의 팀에만 속할 수 있다.
//   - 서버 검증: 신청 전에 이미 다른 팀에 있는지 확인
//   - DB 강제: esports_members.student_id UNIQUE → 동시 신청이 겹치면 한쪽 insert가 실패하고 팀이 롤백됨

const GAMES = {
  lol: { name: '리그 오브 레전드', short: '롤', size: 5, format: '소환사의 협곡 (비공개 선택)' },
  brawl: { name: '브롤스타즈', short: '브롤스타즈', size: 3, format: '젬 그랩, 브롤 볼, 하이스트' },
  steppin: { name: '스테핀', short: '스테핀', size: 1, format: '배틀모드' },
  // 발로란트: 만 15세 이상(생일 지난 학생)만 가능 → 모든 팀원의 생년월일을 받고 서버에서 검증
  valorant: { name: '발로란트', short: '발로란트', size: 5, minAge: 15, format: '토너먼트 모드 및 연장 2점 승리 옵션' },
  // 중계: 개인 1명, 티어 없음(한마디/지원 동기만 선택 입력), 2명 선발 예정이지만 신청은 인원 제한 없음(교사가 선발)
  caster: { name: '중계', short: '중계', size: 1, noTier: true, note: '2명 선발 예정' }
};
const GAME_ORDER = ['lol', 'brawl', 'steppin', 'valorant', 'caster'];
const ELIGIBLE_GRADES = ['2', '3'];
const GRADE_LABEL = '2·3학년';
const MAX_TIER_LEN = 20;
const MAX_TEAM_NAME_LEN = 20;
const MAX_MESSAGE_LEN = 100;

function isEligibleId(id) { return /^\d{5}$/.test(String(id || '')) && ELIGIBLE_GRADES.includes(String(id).charAt(0)); }
function clean(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max); }
function fail(msg) { return { success: false, msg }; }
function isUnique(err) { return !!err && (String(err.code) === '23505' || /duplicate key|unique/i.test(String(err.message || ''))); }

function gamesInfo() { return GAME_ORDER.map(k => ({ key: k, name: GAMES[k].name, short: GAMES[k].short, size: GAMES[k].size, minAge: GAMES[k].minAge || 0, noTier: !!GAMES[k].noTier, note: GAMES[k].note || '', format: GAMES[k].format || '' })); }

// 오늘 날짜(Asia/Seoul) 'YYYY-MM-DD'
function seoulToday(now) {
  const d = new Date((now || new Date()).getTime() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
// 'YYYY-MM-DD' 실제 존재하는 날짜인지 확인 후 {y,m,d}, 아니면 null
function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d, str: m[0] };
}
// 만 나이 (신청일 = 서울 오늘 기준, 생일이 지나야 +1; 2/29생은 평년 3/1에 생일이 지난 것으로 계산)
function fullAge(birth, now) {
  const t = parseDate(seoulToday(now));
  return t.y - birth.y - ((t.m < birth.m || (t.m === birth.m && t.d < birth.d)) ? 1 : 0);
}

async function getUser(supabase, id) {
  const { data } = await supabase.from('users').select('id,name,role').eq('id', String(id).trim());
  const u = data && data[0];
  return u ? { id: String(u.id).trim(), name: String(u.name || ''), role: String(u.role || '').toLowerCase().trim() } : null;
}
async function getEligibleStudent(supabase, id) {
  if (!isEligibleId(id)) return null;
  const u = await getUser(supabase, id);
  return u && u.role === 'student' ? u : null;
}
async function isTeacher(supabase, id) {
  const u = await getUser(supabase, String(id || '').trim());
  return !!u && (u.role === 'teacher' || u.role === 'admin');
}

function shapeTeam(team, members, withBirth) {
  const ms = (members || []).filter(m => String(m.team_id) === String(team.id))
    .sort((a, b) => (b.is_leader ? 1 : 0) - (a.is_leader ? 1 : 0) || String(a.student_id).localeCompare(String(b.student_id)))
    .map(m => {
      const o = { id: String(m.student_id), name: m.name || '', tier: m.tier || '', isLeader: !!m.is_leader };
      if (m.is_leader && m.message) o.message = m.message;
      if (withBirth) o.birthdate = m.birthdate ? String(m.birthdate).slice(0, 10) : '';   // 생년월일은 교사 화면에만 내려줌
      return o;
    });
  const g = GAMES[team.game] || { name: team.game, short: team.game, size: ms.length };
  return {
    id: team.id, game: team.game, gameName: g.name, size: g.size, noTier: !!g.noTier,
    teamName: team.team_name || '', leaderId: String(team.leader_id), leaderName: team.leader_name || '',
    createdAt: team.created_at || null, members: ms
  };
}

async function teamOf(supabase, sid) {
  const { data: mrows, error } = await supabase.from('esports_members').select('team_id,student_id').eq('student_id', sid);
  if (error) throw new Error(error.message);
  if (!mrows || !mrows.length) return null;
  const tid = mrows[0].team_id;
  const { data: t } = await supabase.from('esports_teams').select('*').eq('id', tid);
  if (!t || !t[0]) return null;
  const { data: ms } = await supabase.from('esports_members').select('*').eq('team_id', tid);
  return shapeTeam(t[0], ms);
}

// 학생 본인 상태: 대상 여부 + 내 신청(리더든 팀원이든)
async function status(supabase, studentId) {
  const sid = String(studentId || '').trim();
  if (!isEligibleId(sid)) return { success: true, eligible: false };
  const u = await getEligibleStudent(supabase, sid);
  if (!u) return { success: true, eligible: false };
  const team = await teamOf(supabase, sid);
  return { success: true, eligible: true, games: gamesInfo(), team, isLeader: !!team && team.leaderId === sid };
}

// 2·3학년 학생 검색 공통. excludeId가 있으면 그 학번은 결과에서 뺌. 이미 팀에 속한 학생은 taken:true
async function searchStudents(supabase, q, excludeId) {
  const term = clean(q, 20).toLowerCase();
  const ex = String(excludeId || '').trim();
  if (!term) return { success: true, list: [] };
  let users = [];
  for (const g of ELIGIBLE_GRADES) {
    const { data, error } = await supabase.from('users').select('id,name,role').like('id', g + '%');
    if (error) return fail('검색 실패: ' + error.message);
    users = users.concat(data || []);
  }
  const cands = (users || []).filter(u => String(u.role || '').toLowerCase().trim() === 'student' && isEligibleId(String(u.id).trim()) && String(u.id).trim() !== ex &&
    (String(u.name || '').toLowerCase().includes(term) || String(u.id).includes(term)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, 30);
  if (!cands.length) return { success: true, list: [] };
  const { data: taken } = await supabase.from('esports_members').select('student_id').in('student_id', cands.map(c => String(c.id).trim()));
  const takenSet = new Set((taken || []).map(t => String(t.student_id)));
  return { success: true, list: cands.map(c => ({ id: String(c.id).trim(), name: c.name || '', taken: takenSet.has(String(c.id).trim()) })) };
}

// 학생용: 본인 제외
async function search(supabase, studentId, q) {
  const sid = String(studentId || '').trim();
  if (!await getEligibleStudent(supabase, sid)) return fail(GRADE_LABEL + ' 학생만 이용할 수 있어요.');
  return searchStudents(supabase, q, sid);
}

// 교사용: 2·3학년 전원 검색(리더로 쓸 학생 포함)
async function teacherSearch(supabase, teacherId, q) {
  if (!await isTeacher(supabase, teacherId)) return fail('교사만 할 수 있어요.');
  return searchStudents(supabase, q, '');
}

// 신청: 신청자(리더) + 팀원들, 종목별 정확한 인원
async function apply(supabase, body, now) {
  const sid = String(body.studentId || '').trim();
  const leader = await getEligibleStudent(supabase, sid);
  if (!leader) return fail(GRADE_LABEL + ' 학생만 신청할 수 있어요.');
  const gameKey = String(body.game || '');
  const game = GAMES[gameKey];
  if (!game) return fail('종목을 선택해 주세요.');

  const needTier = !game.noTier;
  const needBirth = !!game.minAge;
  const leaderTier = needTier ? clean(body.tier, MAX_TIER_LEN) : '';
  if (needTier && !leaderTier) return fail('내 티어를 입력해 주세요.');
  const leaderMessage = game.noTier ? clean(body.message, MAX_MESSAGE_LEN) : '';

  // 발로란트: 모든 팀원 생년월일 필수 + 신청일(서울 오늘) 기준 만 15세 이상
  const checkBirth = (label, raw) => {
    const b = parseDate(raw);
    if (!b) return { err: label + '의 생년월일을 정확히 입력해 주세요. (예: 2010-05-21)' };
    if (b.str > seoulToday(now)) return { err: label + '의 생년월일이 미래 날짜예요.' };
    if (fullAge(b, now) < game.minAge) return { err: label + '은(는) 만 ' + game.minAge + '세가 안 됐어요. ' + game.short + '은(는) 만 ' + game.minAge + '세(생일 지난 학생)부터 참가할 수 있어요.' };
    return { value: b.str };
  };
  let leaderBirth = null;
  if (needBirth) {
    const c = checkBirth('신청자(' + leader.name + ')', body.birthdate);
    if (c.err) return fail(c.err);
    leaderBirth = c.value;
  }
  let teamName = clean(body.teamName, MAX_TEAM_NAME_LEN);
  if (game.size > 1 && !teamName) return fail('팀 이름을 입력해 주세요.');
  if (game.size === 1) teamName = teamName || leader.name;

  const rawMembers = Array.isArray(body.members) ? body.members : [];
  const mates = [];
  const seen = new Set([sid]);
  for (const m of rawMembers) {
    const id = String((m && m.id) || '').trim();
    if (!id) continue;
    if (seen.has(id)) return fail('같은 학생이 중복으로 들어 있어요: ' + id);
    seen.add(id);
    mates.push({ id, tier: needTier ? clean(m.tier, MAX_TIER_LEN) : '', birthdate: m.birthdate });
  }
  if (mates.length + 1 !== game.size) return fail(game.short + '은(는) 신청자 포함 정확히 ' + game.size + '명이어야 해요. (현재 ' + (mates.length + 1) + '명)');
  if (needTier && mates.some(m => !m.tier)) return fail('팀원의 티어를 모두 입력해 주세요.');

  // v2 컬럼(birthdate, message)은 값이 있을 때만 보냄 → sql/esports_v2.sql 적용 전에도 기존 종목 신청은 동작
  const rows = [Object.assign({ student_id: sid, name: leader.name, tier: leaderTier, is_leader: true },
    leaderBirth ? { birthdate: leaderBirth } : {}, leaderMessage ? { message: leaderMessage } : {})];
  for (const m of mates) {
    const u = await getEligibleStudent(supabase, m.id);
    if (!u) return fail(GRADE_LABEL + ' 학생이 아니거나 없는 학번이에요: ' + m.id);
    const row = { student_id: u.id, name: u.name, tier: m.tier, is_leader: false };
    if (needBirth) {
      const c = checkBirth('팀원 ' + u.name + '(' + u.id + ')', m.birthdate);
      if (c.err) return fail(c.err);
      row.birthdate = c.value;
    }
    rows.push(row);
  }

  // 1) 이미 어떤 팀에든 들어가 있는 학생 확인
  const { data: taken, error: tErr } = await supabase.from('esports_members').select('student_id,name').in('student_id', rows.map(r => r.student_id));
  if (tErr) return fail('확인 실패: ' + tErr.message);
  if (taken && taken.length) {
    const t = taken[0];
    const me = String(t.student_id) === sid;
    return fail(me ? '이미 이스포츠 대회에 신청했어요. 먼저 기존 신청을 취소해야 해요.' : (t.name || t.student_id) + ' 학생(' + t.student_id + ')은 이미 다른 팀에 들어가 있어요.');
  }

  // 2) 팀 → 멤버 (멤버 student_id UNIQUE가 동시 신청을 막음, 실패하면 팀 롤백)
  const { data: ins, error: teamErr } = await supabase.from('esports_teams')
    .insert({ game: gameKey, team_name: teamName, leader_id: sid, leader_name: leader.name }).select('*');
  if (teamErr || !ins || !ins[0]) return fail('저장 실패: ' + (teamErr ? teamErr.message : ''));
  const team = ins[0];
  const { error: memErr } = await supabase.from('esports_members').insert(rows.map(r => Object.assign({ team_id: team.id }, r)));
  if (memErr) {
    await supabase.from('esports_teams').delete().eq('id', team.id);
    if (isUnique(memErr)) return fail('다른 신청과 겹쳤어요. 이미 다른 팀에 들어간 학생이 있어요. 다시 확인해 주세요.');
    return fail('저장 실패: ' + memErr.message);
  }
  return Object.assign({ success: true, msg: '신청이 완료됐어요!' }, { team: await teamOf(supabase, sid) });
}

// 신청 취소: 리더만 (팀 전체 삭제 → 멤버 모두 풀려남)
async function cancel(supabase, studentId) {
  const sid = String(studentId || '').trim();
  if (!isEligibleId(sid)) return fail(GRADE_LABEL + ' 학생만 이용할 수 있어요.');
  const team = await teamOf(supabase, sid);
  if (!team) return fail('취소할 신청이 없어요.');
  if (team.leaderId !== sid) return fail('신청한 사람(' + team.leaderName + ')만 취소할 수 있어요.');
  await supabase.from('esports_members').delete().eq('team_id', team.id);
  const { error } = await supabase.from('esports_teams').delete().eq('id', team.id);
  if (error) return fail('취소 실패: ' + error.message);
  return { success: true, msg: '신청을 취소했어요.' };
}

// 교사용: 전체 현황 (종목별)
async function list(supabase, teacherId) {
  if (!await isTeacher(supabase, teacherId)) return fail('교사만 볼 수 있어요.');
  const { data: teams, error } = await supabase.from('esports_teams').select('*').order('id', { ascending: true });
  if (error) return fail('불러오기 실패: ' + error.message);
  const { data: members } = await supabase.from('esports_members').select('*');
  const shaped = (teams || []).map(t => shapeTeam(t, members, true));
  const byGame = GAME_ORDER.map(k => {
    const ts = shaped.filter(t => t.game === k);
    return { key: k, name: GAMES[k].name, size: GAMES[k].size, minAge: GAMES[k].minAge || 0, noTier: !!GAMES[k].noTier, note: GAMES[k].note || '', format: GAMES[k].format || '', teams: ts, people: ts.reduce((n, t) => n + t.members.length, 0) };
  });
  return { success: true, games: byGame, totalTeams: shaped.length, totalPeople: shaped.reduce((n, t) => n + t.members.length, 0) };
}

// 교사용: 팀 삭제 (잘못 들어간 신청 정리)
async function teacherRemove(supabase, teacherId, teamId) {
  if (!await isTeacher(supabase, teacherId)) return fail('교사만 할 수 있어요.');
  await supabase.from('esports_members').delete().eq('team_id', Number(teamId));
  const { error } = await supabase.from('esports_teams').delete().eq('id', Number(teamId));
  if (error) return fail('삭제 실패: ' + error.message);
  return { success: true, msg: '팀 신청을 삭제했어요.' };
}

// 교사용: 학생 대신 신청 등록. 리더(leaderId)와 팀원·검증 규칙은 학생 신청(apply)과 동일.
async function teacherRegister(supabase, body, now) {
  if (!await isTeacher(supabase, body && body.teacherId)) return fail('교사만 할 수 있어요.');
  const leaderId = String((body && (body.leaderId || body.studentId)) || '').trim();
  if (!leaderId) return fail('신청자(리더)를 선택해 주세요.');
  const result = await apply(supabase, Object.assign({}, body, { studentId: leaderId }), now);
  if (result && result.success) result.msg = '학생 신청을 등록했어요.';
  return result;
}

module.exports = { fullAge, parseDate, seoulToday, GAMES, GAME_ORDER, isEligibleId, status, search, teacherSearch, apply, cancel, list, teacherRemove, teacherRegister };
