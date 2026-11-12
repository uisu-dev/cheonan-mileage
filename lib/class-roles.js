// ===== 1인 1역(봉사도우미) — 학급(학년·반) + 학년도 + 학기별 =====
// 테이블: class_role_types / class_role_assignments (sql/class_roles_counsel_share.sql)
// - 역할 종류는 교사가 직접 등록(추가/이름 수정/삭제). 1학기·2학기 목록은 별도.
// - 학생은 학기당 역할 1개 (UNIQUE student_id+school_year+semester). 역할 1개에 여러 학생 가능.
// - 모든 교사가 모든 학급을 관리할 수 있음(출석부와 같은 교사 확인), 배정한 교사를 기록.

const MAX_ROLE_NAME = 30;
const MAX_ROLES = 60;

function normGrade(v) { const n = parseInt(v, 10); return n >= 1 && n <= 3 ? n : null; }
function normClass(v) { const n = parseInt(v, 10); return n >= 1 && n <= 20 ? n : null; }
function normSemester(v) { const n = parseInt(v, 10); return n === 1 || n === 2 ? n : null; }
function normYear(v) { const n = parseInt(v, 10); return n >= 2000 && n <= 2100 ? n : null; }
function cleanName(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_ROLE_NAME); }
function classPrefix(g, c) { return String(g) + String(c).padStart(2, '0'); }
function isUnique(err) { return !!err && (String(err.code) === '23505' || /duplicate key|unique/i.test(String(err.message || ''))); }

// 학년도/학기 기본값 (Asia/Seoul): 3~8월 = 1학기, 9~2월 = 2학기. 1~2월은 전년도 학년도.
function defaultTerm(now) {
  const d = new Date((now || new Date()).getTime() + 9 * 3600 * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  return { year: m >= 3 ? y : y - 1, semester: (m >= 3 && m <= 8) ? 1 : 2 };
}

async function assertTeacher(supabase, teacherId) {
  const id = String(teacherId || '').trim();
  if (!id) return { ok: false, msg: '교사 정보가 필요합니다.' };
  const { data, error } = await supabase.from('users').select('id, name, role').eq('id', id);
  if (error) return { ok: false, msg: error.message };
  const u = data && data[0];
  if (!u) return { ok: false, msg: '교사를 찾을 수 없습니다.' };
  const role = String(u.role || '').toLowerCase().trim();
  if (role !== 'teacher' && role !== 'admin') return { ok: false, msg: '교사만 사용할 수 있습니다.' };
  return { ok: true, user: { id: String(u.id).trim(), name: u.name || '' } };
}

async function loadRoster(supabase, grade, classNm) {
  const prefix = classPrefix(grade, classNm);
  const { data, error } = await supabase.from('users').select('id, name, role').like('id', prefix + '%');
  if (error) throw new Error(error.message);
  return (data || [])
    .filter(u => String(u.role || 'student').toLowerCase().trim() === 'student')
    .map(u => ({ id: String(u.id).trim(), name: u.name || '' }))
    .filter(u => /^\d{5}$/.test(u.id) && u.id.substring(0, 3) === prefix)
    .map(u => Object.assign(u, { no: parseInt(u.id.substring(3, 5), 10) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function scopeOf(body) {
  const s = { grade: normGrade(body.grade), classNm: normClass(body.classNm), year: normYear(body.year), semester: normSemester(body.semester) };
  if (!s.grade || !s.classNm) return { err: '학년/반을 확인해 주세요.' };
  if (!s.year || !s.semester) return { err: '학년도/학기를 확인해 주세요.' };
  return s;
}
const scopeEq = (q, s) => q.eq('school_year', s.year).eq('semester', s.semester).eq('grade', s.grade).eq('class_nm', s.classNm);

async function loadRoles(supabase, s) {
  const { data, error } = await scopeEq(supabase.from('class_role_types').select('*'), s).order('id', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(r => ({ id: r.id, name: r.name, createdByName: r.created_by_name || '' }));
}
async function loadAssignments(supabase, s) {
  const { data, error } = await scopeEq(supabase.from('class_role_assignments').select('*'), s);
  if (error) throw new Error(error.message);
  return (data || []).map(a => ({ studentId: String(a.student_id), roleId: a.role_id, assignedByName: a.assigned_by_name || '', assignedAt: a.assigned_at || null }));
}

async function snapshot(supabase, s) {
  const [roster, roles, assigns] = await Promise.all([loadRoster(supabase, s.grade, s.classNm), loadRoles(supabase, s), loadAssignments(supabase, s)]);
  const inRoster = new Set(roster.map(x => x.id));
  const assignments = assigns.filter(a => inRoster.has(a.studentId));
  return { success: true, grade: s.grade, classNm: s.classNm, year: s.year, semester: s.semester, roster, roles, assignments,
    unassigned: roster.length - assignments.length };
}

async function roleInScope(supabase, s, roleId) {
  const { data } = await scopeEq(supabase.from('class_role_types').select('*').eq('id', Number(roleId)), s);
  return (data && data[0]) || null;
}

async function handle(body, deps) {
  const supabase = deps.supabase;
  const action = body.action;
  const t = await assertTeacher(supabase, body.teacherId);
  if (!t.ok) return { success: false, msg: t.msg };
  const s = scopeOf(body);
  if (s.err) return { success: false, msg: s.err };

  if (action === 'load') return snapshot(supabase, s);

  if (action === 'addRole') {
    const name = cleanName(body.name);
    if (!name) return { success: false, msg: '역할 이름을 입력해 주세요.' };
    const roles = await loadRoles(supabase, s);
    if (roles.length >= MAX_ROLES) return { success: false, msg: '역할은 최대 ' + MAX_ROLES + '개까지 등록할 수 있어요.' };
    if (roles.some(r => r.name === name)) return { success: false, msg: '이미 있는 역할이에요: ' + name };
    const { error } = await supabase.from('class_role_types').insert({ school_year: s.year, semester: s.semester, grade: s.grade, class_nm: s.classNm, name, created_by: t.user.id, created_by_name: t.user.name });
    if (error) return { success: false, msg: isUnique(error) ? '이미 있는 역할이에요: ' + name : '저장 실패: ' + error.message };
    return Object.assign(await snapshot(supabase, s), { msg: '역할을 추가했어요.' });
  }

  if (action === 'renameRole') {
    const name = cleanName(body.name);
    if (!name) return { success: false, msg: '역할 이름을 입력해 주세요.' };
    const role = await roleInScope(supabase, s, body.roleId);
    if (!role) return { success: false, msg: '역할을 찾을 수 없어요.' };
    const roles = await loadRoles(supabase, s);
    if (roles.some(r => r.name === name && String(r.id) !== String(role.id))) return { success: false, msg: '이미 있는 역할이에요: ' + name };
    const { error } = await supabase.from('class_role_types').update({ name, updated_at: new Date().toISOString() }).eq('id', role.id);
    if (error) return { success: false, msg: isUnique(error) ? '이미 있는 역할이에요: ' + name : '저장 실패: ' + error.message };
    return Object.assign(await snapshot(supabase, s), { msg: '역할 이름을 바꿨어요.' });
  }

  if (action === 'deleteRole') {
    const role = await roleInScope(supabase, s, body.roleId);
    if (!role) return { success: false, msg: '역할을 찾을 수 없어요.' };
    await supabase.from('class_role_assignments').delete().eq('role_id', role.id);   // FK CASCADE와 동일 (명시적으로도 정리)
    const { error } = await supabase.from('class_role_types').delete().eq('id', role.id);
    if (error) return { success: false, msg: '삭제 실패: ' + error.message };
    return Object.assign(await snapshot(supabase, s), { msg: '역할을 삭제했어요. (배정된 학생은 미배정으로)' });
  }

  if (action === 'assign') {
    const sid = String(body.studentId || '').trim();
    const roster = await loadRoster(supabase, s.grade, s.classNm);
    if (!roster.some(x => x.id === sid)) return { success: false, msg: '이 학급 학생이 아니에요: ' + sid };
    const roleId = body.roleId === null || body.roleId === undefined || body.roleId === '' ? null : body.roleId;
    if (roleId === null) {
      await supabase.from('class_role_assignments').delete().eq('student_id', sid).eq('school_year', s.year).eq('semester', s.semester);
      return Object.assign(await snapshot(supabase, s), { msg: '배정을 해제했어요.' });
    }
    const role = await roleInScope(supabase, s, roleId);
    if (!role) return { success: false, msg: '이 학급·학기의 역할이 아니에요.' };
    const row = { school_year: s.year, semester: s.semester, grade: s.grade, class_nm: s.classNm, student_id: sid, role_id: role.id,
      assigned_by: t.user.id, assigned_by_name: t.user.name, assigned_at: new Date().toISOString() };
    const { error } = await supabase.from('class_role_assignments').upsert(row, { onConflict: 'student_id,school_year,semester' });
    if (error) return { success: false, msg: '저장 실패: ' + error.message };
    return Object.assign(await snapshot(supabase, s), { msg: '배정했어요.' });
  }

  // 1학기 역할 종류를 2학기로 복사 (이름이 같은 역할은 건너뜀, 배정은 복사하지 않음)
  if (action === 'copyFromFirst') {
    if (s.semester !== 2) return { success: false, msg: '2학기 화면에서만 가져올 수 있어요.' };
    const first = await loadRoles(supabase, Object.assign({}, s, { semester: 1 }));
    if (!first.length) return { success: false, msg: '1학기에 등록된 역할이 없어요.' };
    const cur = new Set((await loadRoles(supabase, s)).map(r => r.name));
    const add = first.filter(r => !cur.has(r.name)).slice(0, Math.max(0, MAX_ROLES - cur.size));
    if (add.length) {
      const { error } = await supabase.from('class_role_types').insert(add.map(r => ({ school_year: s.year, semester: 2, grade: s.grade, class_nm: s.classNm, name: r.name, created_by: t.user.id, created_by_name: t.user.name })));
      if (error) return { success: false, msg: '복사 실패: ' + error.message };
    }
    return Object.assign(await snapshot(supabase, s), { msg: add.length ? '1학기 역할 ' + add.length + '개를 가져왔어요.' : '가져올 새 역할이 없어요. (이미 모두 있음)' });
  }

  return { success: false, msg: '알 수 없는 action' };
}

module.exports = { defaultTerm, cleanName, handle };
