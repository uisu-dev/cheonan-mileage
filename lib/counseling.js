// ===== 상담 기록 열람 권한 / 공유 =====
// 원칙(개인정보): 상담 기록은 "작성한 교사(teacher_id)"와 "작성자가 공유한 교사(counseling_shares)"만 볼 수 있다.
//   - 공유받은 교사는 읽기만 가능(수정·삭제·재공유 불가)
//   - admin 역할도 예외 없이 같은 규칙 (전체 열람 권한 없음)
//   - teacher_id가 비어 있는 옛 기록(작성자 확인 불가)은 아무에게도 보이지 않음 (데이터는 보존)
// 주의: API에 로그인 토큰이 없어 teacherId는 클라이언트가 보내는 값이다(앱 전체와 같은 약한 확인).

const MAX_LIST = 1000;

function formatCounselDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  // 기존 동작 유지: datetime-local 값이 시간대 없이 저장되어(DB=UTC) UTC 성분이 곧 입력한 시각
  const k = dt;
  const p = n => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

async function getTeacher(supabase, teacherId) {
  const id = String(teacherId || '').trim();
  if (!id) return null;
  const { data } = await supabase.from('users').select('id, name, role').eq('id', id);
  const u = data && data[0];
  if (!u) return null;
  const role = String(u.role || '').toLowerCase().trim();
  if (role !== 'teacher' && role !== 'admin') return null;
  return { id: String(u.id).trim(), name: u.name || '', role };
}

async function allTeachers(supabase) {
  const { data } = await supabase.from('users').select('id, name, role');
  return (data || []).filter(u => { const r = String(u.role || '').toLowerCase().trim(); return r === 'teacher' || r === 'admin'; })
    .map(u => ({ id: String(u.id).trim(), name: u.name || '' }));
}

function isOwner(row, tid) { return !!row && !!row.teacher_id && String(row.teacher_id).trim() === tid; }

// rows 중 tid가 볼 수 있는 것만 + 표시용 정보(isMine, sharedFrom, sharedWith)
async function decorate(supabase, rows, tid, opts) {
  rows = rows || [];
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const { data: shares, error } = await supabase.from('counseling_shares').select('log_id, teacher_id').in('log_id', ids);
  if (error) throw new Error(error.message);
  const sharedToMe = new Set((shares || []).filter(s => String(s.teacher_id) === tid).map(s => String(s.log_id)));
  const visible = rows.filter(r => isOwner(r, tid) || sharedToMe.has(String(r.id)));
  const need = new Set();
  (shares || []).forEach(s => need.add(String(s.teacher_id)));
  const teachers = need.size ? await allTeachers(supabase) : [];
  const tName = new Map(teachers.map(t => [t.id, t.name]));
  const stuNames = (opts && opts.studentNames) || new Map();
  return visible.map(r => {
    const mine = isOwner(r, tid);
    const out = {
      id: r.id,
      studentId: String(r.student_id || ''),
      studentName: stuNames.get(String(r.student_id)) || '',
      teacherName: r.teacher_name || '',
      counselDate: r.counsel_date,
      counselDateStr: formatCounselDate(r.counsel_date),
      counselType: r.counsel_type || '일반 상담',
      content: r.content || '',
      fileUrl: r.file_url || '',
      fileName: r.file_name || '',
      sessionId: r.session_id || '',
      participants: r.participants || '',
      isMine: mine,
      sharedFrom: mine ? '' : (r.teacher_name || '')
    };
    if (mine) out.sharedWith = (shares || []).filter(s => String(s.log_id) === String(r.id)).map(s => ({ id: String(s.teacher_id), name: tName.get(String(s.teacher_id)) || String(s.teacher_id) }));
    return out;
  });
}

const byDateDesc = (a, b) => String(b.counsel_date || '').localeCompare(String(a.counsel_date || '')) || (b.id - a.id);

// 학생 1명의 상담 기록 (내 것 + 나에게 공유된 것)
async function listForStudent(supabase, tid, studentId) {
  const { data, error } = await supabase.from('counseling_logs').select('*').eq('student_id', String(studentId))
    .order('counsel_date', { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return (await decorate(supabase, data, tid)).slice(0, 100);
}

// 상담 목록 전체보기 (내 것 + 나에게 공유된 것), 필터: 학년/반/학생(이름·학번)/기간
async function listAll(supabase, tid, f) {
  f = f || {};
  const { data: mine, error: e1 } = await supabase.from('counseling_logs').select('*').eq('teacher_id', tid).order('counsel_date', { ascending: false }).limit(MAX_LIST);
  if (e1) throw new Error(e1.message);
  const { data: sh, error: e2 } = await supabase.from('counseling_shares').select('log_id').eq('teacher_id', tid);
  if (e2) throw new Error(e2.message);
  let shared = [];
  const sids = [...new Set((sh || []).map(s => s.log_id))];
  if (sids.length) {
    const { data, error } = await supabase.from('counseling_logs').select('*').in('id', sids);
    if (error) throw new Error(error.message);
    shared = data || [];
  }
  const seen = new Set();
  let rows = (mine || []).concat(shared).filter(r => { if (seen.has(String(r.id))) return false; seen.add(String(r.id)); return true; });

  const g = String(f.grade || '').trim(), c = String(f.classNm || '').trim();
  if (g) rows = rows.filter(r => String(r.student_id || '').charAt(0) === g);
  if (c) rows = rows.filter(r => /^\d{5}$/.test(String(r.student_id)) && parseInt(String(r.student_id).substring(1, 3), 10) === parseInt(c, 10));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(f.from || '') ? f.from : '', to = /^\d{4}-\d{2}-\d{2}$/.test(f.to || '') ? f.to : '';
  if (from || to) rows = rows.filter(r => { const d = formatCounselDate(r.counsel_date).slice(0, 10); return (!from || d >= from) && (!to || d <= to); });

  const stuIds = [...new Set(rows.map(r => String(r.student_id)))];
  const names = new Map();
  if (stuIds.length) {
    const { data: us } = await supabase.from('users').select('id, name').in('id', stuIds);
    (us || []).forEach(u => names.set(String(u.id).trim(), u.name || ''));
  }
  const q = String(f.q || '').trim().toLowerCase();
  if (q) rows = rows.filter(r => String(r.student_id).includes(q) || String(names.get(String(r.student_id)) || '').toLowerCase().includes(q));
  rows.sort(byDateDesc);
  const total = rows.length;
  const out = await decorate(supabase, rows.slice(0, MAX_LIST), tid, { studentNames: names });
  return { records: out, total, truncated: total > MAX_LIST };
}

// 공유 대상 설정(교체): 작성자만. 공동 상담(session_id)이면 같은 세션의 내 기록 전체에 똑같이 적용
async function setShares(supabase, tid, logId, teacherIds) {
  const { data } = await supabase.from('counseling_logs').select('*').eq('id', Number(logId));
  const row = data && data[0];
  if (!row) return { success: false, msg: '기록을 찾을 수 없어요.' };
  if (!isOwner(row, tid)) return { success: false, msg: '작성한 선생님만 공유를 설정할 수 있어요.' };
  const teachers = await allTeachers(supabase);
  const valid = new Set(teachers.map(t => t.id));
  const targets = [...new Set((Array.isArray(teacherIds) ? teacherIds : []).map(x => String(x).trim()))].filter(x => x && x !== tid);
  const bad = targets.filter(x => !valid.has(x));
  if (bad.length) return { success: false, msg: '교사가 아닌 대상이 있어요: ' + bad.join(', ') };
  let rows = [row];
  if (row.session_id) {
    const { data: sess } = await supabase.from('counseling_logs').select('*').eq('session_id', row.session_id);
    rows = (sess || []).filter(r => isOwner(r, tid));
  }
  const ids = rows.map(r => r.id);
  const { error: dErr } = await supabase.from('counseling_shares').delete().in('log_id', ids);
  if (dErr) return { success: false, msg: '공유 저장 실패: ' + dErr.message };
  if (targets.length) {
    const ins = [];
    ids.forEach(id => targets.forEach(t => ins.push({ log_id: id, teacher_id: t, shared_by: tid })));
    const { error } = await supabase.from('counseling_shares').insert(ins);
    if (error) return { success: false, msg: '공유 저장 실패: ' + error.message };
  }
  const tName = new Map(teachers.map(t => [t.id, t.name]));
  return { success: true, msg: targets.length ? targets.length + '명의 선생님과 공유했어요.' : '공유를 모두 해제했어요.', sharedWith: targets.map(id => ({ id, name: tName.get(id) || id })), rowsAffected: ids.length };
}

function storagePath(url) {
  const idx = String(url || '').indexOf('/counseling-files/');
  return idx === -1 ? null : decodeURIComponent(String(url).substring(idx + '/counseling-files/'.length));
}
async function removeFile(supabase, url) {
  const p = storagePath(url);
  if (!p || !supabase.storage) return;
  try { await supabase.storage.from('counseling-files').remove([p]); } catch (e) {}
}

// 삭제: 작성자만. mode 'all'이면 같은 세션의 "내가 작성한" 기록 전체
async function removeRecord(supabase, tid, id, mode) {
  const { data } = await supabase.from('counseling_logs').select('*').eq('id', Number(id));
  const row = data && data[0];
  if (!row) return { success: false, msg: '레코드를 찾을 수 없습니다.' };
  if (!isOwner(row, tid)) return { success: false, msg: '작성한 선생님만 삭제할 수 있어요.' };
  if (mode === 'all' && row.session_id) {
    const { data: sess } = await supabase.from('counseling_logs').select('*').eq('session_id', row.session_id);
    const mine = (sess || []).filter(r => isOwner(r, tid));
    if (row.file_url) await removeFile(supabase, row.file_url);
    const ids = mine.map(r => r.id);
    await supabase.from('counseling_shares').delete().in('log_id', ids);
    const { error } = await supabase.from('counseling_logs').delete().in('id', ids);
    if (error) return { success: false, msg: error.message };
    return { success: true, msg: '공동 상담 ' + ids.length + '건 삭제 완료' };
  }
  if (row.file_url) {
    const { data: other } = await supabase.from('counseling_logs').select('id').eq('file_url', row.file_url);
    if (!(other || []).some(o => String(o.id) !== String(row.id))) await removeFile(supabase, row.file_url);
  }
  await supabase.from('counseling_shares').delete().eq('log_id', row.id);
  const { error } = await supabase.from('counseling_logs').delete().eq('id', row.id);
  if (error) return { success: false, msg: error.message };
  return { success: true, msg: '삭제되었습니다.' };
}

// 읽기/공유/삭제 액션 (create는 파일 업로드 때문에 api/counseling.js에서 처리)
async function handle(body, deps) {
  const supabase = deps.supabase;
  const t = await getTeacher(supabase, body.teacherId);
  if (!t) return { success: false, msg: '교사만 사용할 수 있습니다.' };
  const a = body.action;
  if (a === 'list') {
    if (!body.studentId) return { success: false, msg: '학생 ID 누락' };
    return { success: true, records: await listForStudent(supabase, t.id, body.studentId) };
  }
  if (a === 'listAll') return Object.assign({ success: true }, await listAll(supabase, t.id, body));
  if (a === 'setShares') return setShares(supabase, t.id, body.id, body.teacherIds);
  if (a === 'delete') return removeRecord(supabase, t.id, body.id, body.mode);
  if (a === 'teachers') return { success: true, teachers: (await allTeachers(supabase)).filter(x => x.id !== t.id).sort((x, y) => x.name.localeCompare(y.name)) };
  return null;
}

module.exports = { formatCounselDate, getTeacher, handle, listAll, listForStudent, setShares, removeRecord };
