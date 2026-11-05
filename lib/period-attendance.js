// 학급 출석부 (교시별) — 순수 로직 + supabase 핸들러
// 기본값은 '출석'이며, 예외(지각·조퇴 3종·결과·결석 4종)만 attendance_records에 저장한다.
// attendance_periods에는 "이 교시를 누가 언제 확인/저장했는지"를 남긴다(예외 0명이어도 기록됨).

const STATUSES = {
  late: '지각',
  early_leave_sick: '조퇴(질병)',
  early_leave_unexcused: '조퇴(미인정)',
  early_leave_excused: '조퇴(인정)',
  result: '결과',
  absent_excused: '결석(인정)',
  absent_unexcused: '결석(미인정)',
  absent_sick: '결석(질병)',
  absent_other: '결석(기타)'
};
const MAX_PERIOD = 10;
const MAX_NOTE = 200;

function kstNowIso() { return new Date().toISOString(); }

function normYmd(v) {
  const s = String(v || '').replace(/[^0-9]/g, '');
  return /^\d{8}$/.test(s) ? s : null;
}
function normGrade(v) { const n = parseInt(v, 10); return n >= 1 && n <= 3 ? n : null; }
function normClass(v) { const n = parseInt(v, 10); return n >= 1 && n <= 20 ? n : null; }
function normPeriod(v) { const n = parseInt(v, 10); return n >= 1 && n <= MAX_PERIOD ? n : null; }

// 학번 5자리: 1자리 학년, 2~3자리 반, 4~5자리 번호
function classOf(studentId) {
  const s = String(studentId || '').trim();
  if (!/^\d{5}$/.test(s)) return null;
  return { grade: parseInt(s.substring(0, 1), 10), classNm: parseInt(s.substring(1, 3), 10), no: parseInt(s.substring(3, 5), 10) };
}
function classPrefix(grade, classNm) { return String(grade) + String(classNm).padStart(2, '0'); }

// 저장할 예외 목록 정리: 명단에 있는 학생 + 허용된 상태만, 학생당 1건
function cleanMarks(marks, rosterIds) {
  const allow = new Set((rosterIds || []).map(String));
  const out = new Map();
  (Array.isArray(marks) ? marks : []).forEach(m => {
    if (!m) return;
    const sid = String(m.studentId || m.student_id || '').trim();
    const st = String(m.status || '').trim();
    if (!allow.has(sid) || !STATUSES[st]) return;
    out.set(sid, { student_id: sid, status: st, note: String(m.note || '').trim().slice(0, MAX_NOTE) });
  });
  return Array.from(out.values());
}

async function assertTeacher(supabase, teacherId) {
  const id = String(teacherId || '').trim();
  if (!id) return { ok: false, msg: '교사 정보가 필요합니다.' };
  const { data, error } = await supabase.from('users').select('id, name, role').eq('id', id).maybeSingle();
  if (error) return { ok: false, msg: error.message };
  if (!data) return { ok: false, msg: '교사를 찾을 수 없습니다.' };
  const role = String(data.role || '').toLowerCase().trim();
  if (role !== 'teacher' && role !== 'admin') return { ok: false, msg: '교사만 사용할 수 있습니다.' };
  return { ok: true, user: data };
}

async function loadRoster(supabase, grade, classNm) {
  const prefix = classPrefix(grade, classNm);
  const { data, error } = await supabase.from('users').select('id, name, role').like('id', prefix + '%');
  if (error) throw new Error(error.message);
  return (data || [])
    .filter(u => String(u.role || 'student').toLowerCase().trim() === 'student')
    .filter(u => { const c = classOf(u.id); return c && c.grade === grade && c.classNm === classNm; })
    .map(u => ({ id: String(u.id), name: u.name || '', no: classOf(u.id).no }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function loadMarks(supabase, ymd, grade, classNm) {
  const [r, p] = await Promise.all([
    supabase.from('attendance_records').select('*').eq('date', ymd).eq('grade', grade).eq('class_nm', classNm),
    supabase.from('attendance_periods').select('*').eq('date', ymd).eq('grade', grade).eq('class_nm', classNm)
  ]);
  if (r.error) throw new Error(r.error.message);
  if (p.error) throw new Error(p.error.message);
  const records = (r.data || []).map(x => ({
    studentId: String(x.student_id), period: Number(x.period), status: x.status, note: x.note || '',
    subject: x.subject || '', teacherId: x.teacher_id || '', teacherName: x.teacher_name || '', updatedAt: x.updated_at
  }));
  const periods = (p.data || []).map(x => ({
    period: Number(x.period), subject: x.subject || '', teacherId: x.teacher_id || '', teacherName: x.teacher_name || '',
    exceptionCount: Number(x.exception_count) || 0, updatedAt: x.updated_at
  })).sort((a, b) => a.period - b.period);
  return { records, periods };
}

function parseClassArgs(body) {
  const ymd = normYmd(body.date);
  const grade = normGrade(body.grade);
  const classNm = normClass(body.classNm);
  if (!ymd || !grade || !classNm) return null;
  return { ymd, grade, classNm };
}

async function handle(body, deps) {
  const { supabase, getNeisTimetable } = deps;
  const action = body && body.action;
  const t = await assertTeacher(supabase, body.teacherId);
  if (!t.ok) return { success: false, msg: t.msg };

  if (action === 'load' || action === 'getMarks') {
    const a = parseClassArgs(body);
    if (!a) return { success: false, msg: '학년·반·날짜를 확인하세요.' };
    let timetable = [];
    if (action === 'load') {
      try { timetable = await getNeisTimetable(a.ymd, a.grade, a.classNm); } catch (e) { timetable = []; }
    }
    try {
      const [roster, marks] = await Promise.all([
        action === 'load' ? loadRoster(supabase, a.grade, a.classNm) : Promise.resolve(undefined),
        loadMarks(supabase, a.ymd, a.grade, a.classNm)
      ]);
      const out = { success: true, date: a.ymd, grade: a.grade, classNm: a.classNm, records: marks.records, periods: marks.periods };
      if (action === 'load') { out.timetable = timetable; out.roster = roster; }
      return out;
    } catch (e) {
      return { success: false, msg: '출석 기록을 불러오지 못했습니다. (DB 테이블이 아직 없으면 sql/attendance_period.sql 실행 필요) ' + e.message };
    }
  }

  if (action === 'saveMarks') {
    const a = parseClassArgs(body);
    if (!a) return { success: false, msg: '학년·반·날짜를 확인하세요.' };
    // period: 이 교시는 명단 전체 기준으로 덮어씀(체크 안 된 학생 = 출석).
    // extraPeriods: 같은 예외를 다른 교시에도 "추가"만 함(그 교시의 다른 학생 기록은 유지).
    const main = normPeriod(body.period);
    if (!main) return { success: false, msg: '교시를 선택하세요.' };
    const extra = Array.from(new Set((Array.isArray(body.extraPeriods) ? body.extraPeriods : [])
      .map(normPeriod).filter(p => p && p !== main))).sort((x, y) => x - y);
    const subjects = body.subjects && typeof body.subjects === 'object' ? body.subjects : {};
    const fallbackSubject = String(body.subject || '').trim().slice(0, 50);

    let roster;
    try { roster = await loadRoster(supabase, a.grade, a.classNm); } catch (e) { return { success: false, msg: e.message }; }
    const marks = cleanMarks(body.marks, roster.map(s => s.id));
    const now = kstNowIso();
    const teacherName = t.user.name || '';

    const jobs = [{ p: main, replace: true }].concat(extra.map(p => ({ p, replace: false })));
    for (const job of jobs) {
      const p = job.p;
      const subject = String(subjects[p] != null ? subjects[p] : (job.replace ? fallbackSubject : '')).trim().slice(0, 50);
      const rows = marks.map(m => ({
        date: a.ymd, grade: a.grade, class_nm: a.classNm, period: p, subject,
        student_id: m.student_id, status: m.status, note: m.note,
        teacher_id: t.user.id, teacher_name: teacherName, updated_at: now
      }));
      // 1) 예외 upsert (먼저 써서 중간 실패 시 기존 기록이 사라지지 않게)
      if (rows.length) {
        const up = await supabase.from('attendance_records').upsert(rows, { onConflict: 'date,student_id,period' });
        if (up.error) return { success: false, msg: '저장 실패: ' + up.error.message };
      }
      // 2) 이 교시에서 '출석'으로 돌아간 학생의 기존 예외 삭제 (덮어쓰기 교시만)
      if (job.replace) {
        const keep = new Set(marks.map(m => m.student_id));
        const stale = roster.map(s => s.id).filter(id => !keep.has(id));
        if (stale.length) {
          const del = await supabase.from('attendance_records').delete()
            .eq('date', a.ymd).eq('period', p).in('student_id', stale);
          if (del.error) return { success: false, msg: '저장 실패: ' + del.error.message };
        }
      }
      // 3) 교시 확인 기록 (예외 인원은 실제 저장된 행 기준)
      const cnt = await supabase.from('attendance_records').select('student_id')
        .eq('date', a.ymd).eq('grade', a.grade).eq('class_nm', a.classNm).eq('period', p);
      if (cnt.error) return { success: false, msg: '저장 실패: ' + cnt.error.message };
      const metaRow = {
        date: a.ymd, grade: a.grade, class_nm: a.classNm, period: p,
        teacher_id: t.user.id, teacher_name: teacherName, exception_count: (cnt.data || []).length, updated_at: now
      };
      if (subject) metaRow.subject = subject;
      const meta = await supabase.from('attendance_periods').upsert(metaRow, { onConflict: 'date,grade,class_nm,period' });
      if (meta.error) return { success: false, msg: '저장 실패: ' + meta.error.message };
    }
    const periods = jobs.map(j => j.p);

    const fresh = await loadMarks(supabase, a.ymd, a.grade, a.classNm);
    return { success: true, msg: periods.join(', ') + '교시 저장 완료 (예외 ' + marks.length + '명)', records: fresh.records, periods: fresh.periods };
  }

  return { success: false, msg: '알 수 없는 action' };
}

module.exports = { STATUSES, MAX_PERIOD, normYmd, classOf, classPrefix, cleanMarks, handle };
