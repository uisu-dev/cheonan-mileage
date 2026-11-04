// ===== 학교통일교육 실태조사 참여 복권 (복권 긁기) =====
// 결과는 전부 서버에서 결정한다. DB 스키마 변경 없이 기존 survey_logs 테이블에 저장:
//   vote_id = UNIFY_SCRATCH_ID, student_id = 학번, answer(jsonb) = { result: 'win'|'lose', grade, name, at, ... }
// 한 학생당 1회만 가능 (두 번째 호출부터는 저장된 결과를 그대로 돌려줌).

// ▼ 당첨 확률 (1회 긁기당). 바꾸려면 이 숫자만 수정하면 됨. 0.10 = 10%
const UNIFY_WIN_PROBABILITY = 0.10;

// ▼ 학년별 당첨 인원 (총 10명)
const UNIFY_GRADE_QUOTA = { '1': 3, '2': 3, '3': 4 };

const UNIFY_SCRATCH_ID = 'unification_scratch_2026';

function gradeOf(studentId) {
  const s = String(studentId || '');
  if (!/^\d{5}$/.test(s)) return '';
  const g = s.charAt(0);
  return UNIFY_GRADE_QUOTA[g] ? g : '';
}

function publicResult(row, name) {
  const a = (row && row.answer) || {};
  return {
    played: true,
    result: a.result === 'win' ? 'win' : 'lose',
    studentId: String(row.student_id),
    name: a.name || name || '',
    grade: a.grade || gradeOf(row.student_id),
    at: a.at || row.date || null
  };
}

async function allRows(supabase) {
  const { data, error } = await supabase
    .from('survey_logs').select('id,student_id,answer,date')
    .eq('vote_id', UNIFY_SCRATCH_ID).order('id', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function studentRows(supabase, sid) {
  const { data, error } = await supabase
    .from('survey_logs').select('id,student_id,answer,date')
    .eq('vote_id', UNIFY_SCRATCH_ID).eq('student_id', sid).order('id', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

function isWinRow(r) { return r && r.answer && r.answer.result === 'win'; }

async function getStudent(supabase, sid) {
  const { data, error } = await supabase.from('users').select('id,name,role').eq('id', sid);
  if (error) throw new Error(error.message);
  const u = (data || [])[0];
  if (!u || String(u.role || '').toLowerCase().trim() !== 'student') return null;
  return u;
}

// 상태 조회: 이미 긁었으면 저장된 결과, 아니면 played:false
async function status(supabase, studentId) {
  const sid = String(studentId || '').trim();
  if (!sid) return { success: false, msg: '정보 누락' };
  const rows = await studentRows(supabase, sid);
  if (!rows.length) return { success: true, played: false, eligible: !!gradeOf(sid) };
  return Object.assign({ success: true }, publicResult(rows[0]));
}

// 복권 긁기 (1인 1회). rand 는 테스트용 주입 (기본 Math.random)
async function play(supabase, studentId, rand) {
  const random = typeof rand === 'function' ? rand : Math.random;
  const sid = String(studentId || '').trim();
  if (!sid) return { success: false, msg: '정보 누락' };

  // 1) 이미 했으면 저장된 결과 그대로
  const existing = await studentRows(supabase, sid);
  if (existing.length) return Object.assign({ success: true, already: true }, publicResult(existing[0]));

  // 2) 학생 확인
  const grade = gradeOf(sid);
  if (!grade) return { success: false, msg: '학년을 확인할 수 없는 학번입니다.' };
  const user = await getStudent(supabase, sid);
  if (!user) return { success: false, msg: '학생 계정만 참여할 수 있어요.' };
  const quota = UNIFY_GRADE_QUOTA[grade];

  // 3) 남은 당첨 자리가 있을 때만 추첨
  const all = await allRows(supabase);
  const gradeWins = all.filter(r => isWinRow(r) && gradeOf(r.student_id) === grade).length;
  const win = gradeWins < quota && random() < UNIFY_WIN_PROBABILITY;

  const at = new Date().toISOString();
  const answer = { result: win ? 'win' : 'lose', grade, name: user.name, at, p: UNIFY_WIN_PROBABILITY };
  const { data: ins, error: insErr } = await supabase
    .from('survey_logs').insert({ vote_id: UNIFY_SCRATCH_ID, student_id: sid, answer }).select('id,student_id,answer,date');
  if (insErr) return { success: false, msg: '저장 실패: ' + insErr.message };
  const mine = (ins || [])[0];

  // 4) 같은 학생 중복 행 정리 (동시에 두 번 눌린 경우): 가장 먼저 저장된 행만 남김
  const dup = await studentRows(supabase, sid);
  if (dup.length > 1) {
    const extra = dup.slice(1).map(r => r.id);
    await supabase.from('survey_logs').delete().in('id', extra);
  }
  const canonical = dup[0] || mine;
  if (!mine || String(canonical.id) !== String(mine.id)) {
    return Object.assign({ success: true, already: true }, publicResult(canonical));
  }

  // 5) 정원 재확인 (동시 당첨 경합 방지): 저장 후 다시 세서 정원 초과면 내 당첨을 꽝으로 전환.
  //    각 당첨 행은 "자기 저장 이후" 보이는 당첨 수가 정원 이하일 때만 유지되므로,
  //    마지막으로 확인한 행이 항상 전체를 보게 되어 정원 초과가 남지 않음 (동시 경합 시 둘 다 꽝이 될 수는 있음).
  if (win) {
    const after = await allRows(supabase);
    const n = after.filter(r => isWinRow(r) && gradeOf(r.student_id) === grade).length;
    if (n > quota) {
      const lose = Object.assign({}, answer, { result: 'lose', bumped: true });
      await supabase.from('survey_logs').update({ answer: lose }).eq('id', mine.id);
      mine.answer = lose;
    }
  }
  return Object.assign({ success: true, already: false }, publicResult(mine));
}

// 교사용 당첨자 목록
async function winners(supabase) {
  const rows = await allRows(supabase);
  const seen = new Set();
  const list = [];
  let played = 0;
  for (const r of rows) {
    const sid = String(r.student_id);
    if (seen.has(sid)) continue; // 학생당 첫 행만 유효
    seen.add(sid);
    played++;
    if (isWinRow(r)) list.push({ id: sid, name: (r.answer && r.answer.name) || '', grade: gradeOf(sid), at: (r.answer && r.answer.at) || r.date });
  }
  list.sort((a, b) => a.id.localeCompare(b.id));
  return { success: true, list, played, quota: UNIFY_GRADE_QUOTA, probability: UNIFY_WIN_PROBABILITY };
}

module.exports = { UNIFY_WIN_PROBABILITY, UNIFY_GRADE_QUOTA, UNIFY_SCRATCH_ID, gradeOf, status, play, winners };
