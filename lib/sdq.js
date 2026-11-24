// SDQ-Kr 자기보고용(11~17세, 25문항). 공식 조사 2종과 테이블·열람 권한을 분리한다.
// 문항은 안정숙 등(2003) 한국어판 강점·난점 설문지 청소년 자기보고 유통 문구.
// 세 번째 응답 보기는 요청 표기. 유통본의 '분명히 그렇다'와 다르며 채점 값 2는 같다.

const SURVEY_ID = 'sdq_kr';
const CURRENT_WAVE = '2026-1';
const WAVE_RE = /^\d{4}-[1-9]$/;
// users.id 가 교사 계정의 기본키다. 결과 API는 body의 이름이 아니라 DB에서 다시 읽은 id를 본다.
// 2026-11 확인: id '임의수', '안지윤' (role teacher). 표시 이름이 바뀌어도 id가 같으면 유지된다.
const SDQ_READER_IDS = Object.freeze(['임의수', '안지윤']);

const OPTIONS = Object.freeze([
  { value: 0, label: '전혀 아니다' },
  { value: 1, label: '다소 그렇다' },
  { value: 2, label: '확실히 그렇다' }
]);

const ITEMS = Object.freeze([
  '나는 다른 사람들한테 잘 하려고 노력한다. 나는 그들의 감정을 배려한다.',
  '나는 안절부절 못 하고, 오랫동안 가만히 있지 못한다.',
  '나는 자주 머리나 배가 아프거나 몸이 아프다.',
  '나는 보통 다른 사람들과 물건을 함께 나눈다.(예, 음식, 게임 또는 연필 등)',
  '나는 매우 화가 나고 자주 불같이 성질을 낸다.',
  '나는 주로 혼자 있는다. 나는 일반적으로 홀로 놀거나 혼자 있으려고 한다.',
  '나는 주로 시키는 대로 한다.',
  '나는 걱정이 많다.',
  '나는 누군가가 다치거나, 속상해 하거나, 아파 보이면 도움을 준다.',
  '나는 언제나 꿈틀거리고 꼼지락거린다.',
  '나는 적어도 한 명 이상의 좋은 친구가 있다.',
  '나는 많이 싸운다. 나는 내가 원하는 것을 다른 사람이 하게 만들 수 있다.',
  '나는 자주 불행하고, 낙담하며, 눈물이 난다.',
  '내 나이의 다른 사람들이 대체로 나를 좋아한다.',
  '나는 쉽게 주의가 분산되고, 집중하기가 어렵다.',
  '나는 낯선 상황에서 불안해진다. 나는 쉽사리 자신감을 잃는다.',
  '나는 좀 더 어린 아이들에게 친절하다.',
  '나는 자주 거짓말을 하거나 속인다는 비난을 받는다.',
  '다른 아이들이나 젊은 사람들이 나를 놀리거나 괴롭힌다.',
  '나는 자주 사람들을 자진해서 돕는다. (예, 부모님, 선생님, 또는 아이들)',
  '나는 생각한 다음에 행동한다.',
  '나는 집이나 학교 또는 어떤 곳에서 내 것이 아닌 것을 가져온다.',
  '나는 내 나이의 다른 사람들보다 어른들과 더 잘 지낸다.',
  '나는 두려움이 많고 무서움을 잘 탄다.',
  '나는 내가 하는 일을 끝까지 마친다. 나는 주의력이 좋다.'
]);

const REVERSE = new Set([7, 11, 14, 21, 25]);

const SCALES = Object.freeze([
  { id: 'emotional', label: '정서증상', items: [3, 8, 13, 16, 24] },
  { id: 'conduct', label: '품행문제', items: [5, 7, 12, 18, 22] },
  { id: 'hyperactivity', label: '과잉행동', items: [2, 10, 15, 21, 25] },
  { id: 'peer', label: '또래관계문제', items: [6, 11, 14, 19, 23] },
  { id: 'prosocial', label: '친사회성', items: [1, 4, 9, 17, 20] }
]);

// youthinmind 자기보고(self-completed) 원래 3밴드. 부모용 컷오프와 4밴드는 쓰지 않는다.
const CUTOFFS = Object.freeze({
  total: [[15, '정상', 'normal'], [19, '경계', 'borderline'], [40, '임상', 'clinical']],
  emotional: [[5, '정상', 'normal'], [6, '경계', 'borderline'], [10, '임상', 'clinical']],
  conduct: [[3, '정상', 'normal'], [4, '경계', 'borderline'], [10, '임상', 'clinical']],
  hyperactivity: [[5, '정상', 'normal'], [6, '경계', 'borderline'], [10, '임상', 'clinical']],
  peer: [[3, '정상', 'normal'], [5, '경계', 'borderline'], [10, '임상', 'clinical']]
});

const BAND_RANK = { clinical: 0, borderline: 1, normal: 2, unscored: 3 };
const TOTAL_SCALES = ['emotional', 'conduct', 'hyperactivity', 'peer'];

function fail(msg) {
  return { status: 200, body: { success: false, msg } };
}

function ok(body) {
  return { status: 200, body: Object.assign({ success: true }, body) };
}

function clip(value, max) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function isStaff(role) {
  return role === 'teacher' || role === 'admin';
}

function canReadSdq(user) {
  if (!user || !isStaff(user.role)) return false;
  return SDQ_READER_IDS.indexOf(String(user.id).trim()) >= 0;
}

function parseStudentId(id) {
  const s = String(id || '').trim();
  if (!/^\d{5}$/.test(s)) return null;
  return {
    grade: Number(s.slice(0, 1)),
    classNo: Number(s.slice(1, 3)),
    number: Number(s.slice(3, 5))
  };
}

function studentIdentity(user) {
  const parsed = parseStudentId(user && user.id);
  const name = clip(user && user.name, 50);
  if (!parsed || !name) return null;
  if (![1, 2, 3].includes(parsed.grade)) return null;
  if (parsed.classNo < 1 || parsed.classNo > 30) return null;
  if (parsed.number < 1 || parsed.number > 99) return null;
  return {
    studentId: String(user.id).trim(),
    name,
    grade: parsed.grade,
    classNo: parsed.classNo,
    number: parsed.number
  };
}

function parseAnswer(value) {
  if (value === 0 || value === 1 || value === 2) return value;
  if (value === '0' || value === '1' || value === '2') return Number(value);
  return null;
}

function itemScore(n, raw) {
  const v = parseAnswer(raw);
  if (v == null) return null;
  return REVERSE.has(n) ? 2 - v : v;
}

function bandFor(scale, score) {
  if (scale === 'prosocial') {
    if (score >= 6) return { label: '정상', id: 'normal' };
    if (score === 5) return { label: '경계', id: 'borderline' };
    return { label: '임상', id: 'clinical' };
  }
  const cuts = CUTOFFS[scale] || CUTOFFS.total;
  for (let i = 0; i < cuts.length; i++) {
    if (score <= cuts[i][0]) return { label: cuts[i][1], id: cuts[i][2] };
  }
  return { label: '임상', id: 'clinical' };
}

function scoreAnswers(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const points = {};
  for (let n = 1; n <= 25; n++) {
    const scored = itemScore(n, src[n] != null ? src[n] : src[String(n)]);
    if (scored == null) return null;
    points[n] = scored;
  }
  const scores = {};
  const bands = {};
  SCALES.forEach(scale => {
    const sum = scale.items.reduce((acc, n) => acc + points[n], 0);
    scores[scale.id] = sum;
    bands[scale.id] = bandFor(scale.id, sum);
  });
  scores.total = TOTAL_SCALES.reduce((acc, id) => acc + scores[id], 0);
  bands.total = bandFor('total', scores.total);
  return { scores, bands, points };
}

function validateAnswers(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const answers = {};
  for (let n = 1; n <= 25; n++) {
    const v = parseAnswer(src[n] != null ? src[n] : src[String(n)]);
    if (v == null) return { ok: false, msg: '25문항을 모두 선택해 주세요. (' + n + '번)' };
    answers[String(n)] = v;
  }
  return { ok: true, answers };
}

function questions() {
  return ITEMS.map((text, i) => ({
    id: String(i + 1),
    number: i + 1,
    text,
    options: OPTIONS.map(opt => ({ value: opt.value, label: opt.label }))
  }));
}

function publicForm(user) {
  const identity = studentIdentity(user);
  return {
    surveyId: SURVEY_ID,
    kind: 'sdq',
    title: 'SDQ 정신건강 설문',
    wave: CURRENT_WAVE,
    intro: '지난 6개월 동안 자신이 어떻게 지냈는지 생각하고, 각 문항에 가장 가까운 답을 골라 주세요. 진단이 아니라 학교 정신건강 선별 설문입니다.',
    notice: '이름·학번·학년·반·번호는 로그인한 계정으로 저장됩니다. 마감일은 없습니다. 이번 회차에 다시 제출하면 기존 응답을 바꿉니다.',
    identity,
    questions: questions()
  };
}

function dbMessage(error) {
  const m = String(error && (error.message || error) || '');
  if (/updated_at/i.test(m) && /does not exist|schema cache/i.test(m)) {
    return 'SDQ 재응답용 열이 없습니다. Supabase SQL Editor에서 sql/sdq_responses_upsert.sql 파일을 실행해 주세요.';
  }
  if (/does not exist|schema cache|sdq_responses/i.test(m)) {
    return 'SDQ 테이블이 없습니다. Supabase SQL Editor에서 sql/sdq_responses.sql 파일을 실행해 주세요.';
  }
  return '';
}

function rowTime(row) {
  const t = new Date(row && (row.updated_at || row.created_at) || 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

function isRevised(row) {
  if (!row || !row.created_at || !row.updated_at) return false;
  const created = new Date(row.created_at).getTime();
  const updated = new Date(row.updated_at).getTime();
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;
  return updated - created >= 1000;
}

function isUniqueError(error) {
  return !!error && (String(error.code) === '23505' || /duplicate key|unique constraint/i.test(String(error.message || error)));
}

async function loadUser(supabase, userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  const { data, error } = await supabase.from('users').select('id, name, role').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id).trim(),
    name: String(data.name || ''),
    role: String(data.role || '').toLowerCase().trim()
  };
}

async function findOwnRows(supabase, wave, studentId) {
  const { data, error } = await supabase.from('sdq_responses')
    .select('id, created_at, updated_at, answers, wave')
    .eq('wave', wave)
    .eq('student_id', studentId);
  if (error) {
    const msg = dbMessage(error);
    if (msg) {
      const err = new Error(error.message || msg);
      err.code = 'NO_TABLE';
      throw err;
    }
    throw error;
  }
  return (data || []).slice().sort((a, b) => {
    const diff = rowTime(b) - rowTime(a);
    if (diff) return diff;
    return Number(b.id) - Number(a.id);
  });
}

async function findOwn(supabase, wave, studentId) {
  const rows = await findOwnRows(supabase, wave, studentId);
  return rows[0] || null;
}

async function saveResponse(supabase, row) {
  let rows;
  try {
    rows = await findOwnRows(supabase, row.wave, row.student_id);
  } catch (e) {
    return { error: e };
  }
  const patch = {
    student_name: row.student_name,
    grade: row.grade,
    class_no: row.class_no,
    number: row.number,
    answers: row.answers,
    updated_at: row.updated_at
  };
  if (rows.length) {
    const { error } = await supabase.from('sdq_responses').update(patch).eq('id', rows[0].id);
    if (!error && rows.length > 1) {
      await supabase.from('sdq_responses').delete().in('id', rows.slice(1).map(item => item.id));
    }
    return { error, updated: true };
  }
  const inserted = await supabase.from('sdq_responses').insert({
    wave: row.wave,
    student_id: row.student_id,
    student_name: row.student_name,
    grade: row.grade,
    class_no: row.class_no,
    number: row.number,
    answers: row.answers,
    created_at: row.updated_at,
    updated_at: row.updated_at
  });
  if (!isUniqueError(inserted.error)) return { error: inserted.error, updated: false };
  try {
    rows = await findOwnRows(supabase, row.wave, row.student_id);
  } catch (e) {
    return { error: e };
  }
  if (!rows.length) return { error: inserted.error, updated: false };
  const updated = await supabase.from('sdq_responses').update(patch).eq('id', rows[0].id);
  if (!updated.error && rows.length > 1) {
    await supabase.from('sdq_responses').delete().in('id', rows.slice(1).map(item => item.id));
  }
  return { error: updated.error, updated: true };
}

function clientExisting(row) {
  if (!row) return null;
  const checked = validateAnswers(row.answers || {});
  return { answers: checked.ok ? checked.answers : {} };
}

async function actionStatus(supabase, body) {
  const user = await loadUser(supabase, body.userId);
  if (!user) return fail('로그인 사용자를 확인할 수 없습니다.');
  const allowed = canReadSdq(user);
  if (user.role !== 'student') {
    return ok({ role: user.role, allowed, submitted: false, wave: allowed ? CURRENT_WAVE : '' });
  }
  let submitted = false;
  try {
    const row = await findOwn(supabase, CURRENT_WAVE, user.id);
    submitted = !!row;
  } catch (e) {
    const msg = dbMessage(e);
    if (msg) return ok({ role: user.role, allowed: false, submitted: false, wave: CURRENT_WAVE, warning: msg });
    throw e;
  }
  return ok({ role: user.role, allowed: false, submitted, wave: CURRENT_WAVE });
}

async function actionForm(supabase, body) {
  const user = await loadUser(supabase, body.userId);
  if (!user) return fail('로그인 사용자를 확인할 수 없습니다.');
  if (user.role !== 'student') return fail('SDQ 설문은 학생만 참여할 수 있습니다.');
  const identity = studentIdentity(user);
  if (!identity) return fail('학번 5자리 학생 계정만 SDQ 설문에 참여할 수 있습니다.');
  const form = publicForm(user);
  let row = null;
  try {
    row = await findOwn(supabase, CURRENT_WAVE, user.id);
  } catch (e) {
    if (e.code === 'NO_TABLE') return ok({ form, submitted: false, existing: null, warning: dbMessage(e) });
    throw e;
  }
  return ok({ form, submitted: !!row, existing: clientExisting(row) });
}

async function actionSubmit(supabase, body, ctx) {
  const user = await loadUser(supabase, body.userId);
  if (!user) return fail('로그인 사용자를 확인할 수 없습니다.');
  if (user.role !== 'student') return fail('SDQ 설문은 학생만 참여할 수 있습니다.');
  const identity = studentIdentity(user);
  if (!identity) return fail('학번 5자리 학생 계정만 SDQ 설문에 참여할 수 있습니다.');
  const packed = validateAnswers(body && body.answers);
  if (!packed.ok) return fail(packed.msg);
  const saved = await saveResponse(supabase, {
    wave: CURRENT_WAVE,
    student_id: identity.studentId,
    student_name: identity.name,
    grade: identity.grade,
    class_no: identity.classNo,
    number: identity.number,
    answers: packed.answers,
    updated_at: new Date(ctx.now || Date.now()).toISOString()
  });
  if (saved.error) {
    const msg = dbMessage(saved.error);
    return fail(msg || '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return ok({
    submitted: true,
    updated: !!saved.updated,
    wave: CURRENT_WAVE,
    msg: saved.updated ? '이전 응답을 새 답으로 바꿨습니다.' : '제출했습니다.'
  });
}

function normalizeWave(value, fallback) {
  const wave = String(value || '').trim();
  if (!wave) return fallback ? CURRENT_WAVE : '';
  if (!WAVE_RE.test(wave)) return null;
  return wave;
}

async function loadRows(supabase, wave) {
  let q = supabase.from('sdq_responses')
    .select('id, wave, student_id, student_name, grade, class_no, number, answers, created_at, updated_at');
  if (wave) q = q.eq('wave', wave);
  const { data, error } = await q;
  if (error) throw error;
  const latest = new Map();
  (data || []).forEach(row => {
    const key = String(row.wave) + '\0' + String(row.student_id);
    const prev = latest.get(key);
    if (!prev || rowTime(row) > rowTime(prev) || (rowTime(row) === rowTime(prev) && Number(row.id) > Number(prev.id))) {
      latest.set(key, row);
    }
  });
  return Array.from(latest.values());
}

function pct(count, total) {
  if (!total) return 0;
  return Math.round(count / total * 1000) / 10;
}

function emptyBands() {
  return { 정상: 0, 경계: 0, 임상: 0 };
}

function addBand(bucket, band) {
  if (Object.prototype.hasOwnProperty.call(bucket, band)) bucket[band] += 1;
}

function meanOf(list) {
  if (!list.length) return null;
  const sum = list.reduce((acc, n) => acc + n, 0);
  return Math.round(sum / list.length * 100) / 100;
}

function distribution(scored, scaleId) {
  const bands = emptyBands();
  const values = [];
  scored.forEach(row => {
    addBand(bands, row.bands[scaleId].label);
    values.push(row.scores[scaleId]);
  });
  return {
    scale: scaleId,
    count: scored.length,
    bands,
    mean: meanOf(values),
    options: ['정상', '경계', '임상'].map(label => ({
      label,
      count: bands[label],
      pct: pct(bands[label], scored.length)
    }))
  };
}

function gradeStats(scored) {
  return [1, 2, 3].map(grade => {
    const rows = scored.filter(row => row.grade === grade);
    return Object.assign({ grade }, distribution(rows, 'total'));
  });
}

function presentable(row) {
  const scored = scoreAnswers(row.answers);
  const base = {
    studentId: String(row.student_id || ''),
    name: String(row.student_name || ''),
    grade: Number(row.grade),
    classNo: Number(row.class_no),
    number: Number(row.number),
    wave: String(row.wave || ''),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || row.created_at || null,
    revised: isRevised(row),
    answers: row.answers || {}
  };
  if (!scored) {
    base.scores = null;
    base.bands = { total: { label: '미채점', id: 'unscored' } };
    return base;
  }
  base.scores = scored.scores;
  base.bands = scored.bands;
  return base;
}

function sortStudents(list) {
  return list.slice().sort((a, b) => {
    const ar = BAND_RANK[a.bands.total.id] != null ? BAND_RANK[a.bands.total.id] : 9;
    const br = BAND_RANK[b.bands.total.id] != null ? BAND_RANK[b.bands.total.id] : 9;
    if (ar !== br) return ar - br;
    const at = a.scores ? a.scores.total : -1;
    const bt = b.scores ? b.scores.total : -1;
    if (bt !== at) return bt - at;
    if (a.grade !== b.grade) return a.grade - b.grade;
    if (a.classNo !== b.classNo) return a.classNo - b.classNo;
    if (a.number !== b.number) return a.number - b.number;
    return String(a.studentId).localeCompare(String(b.studentId), 'ko');
  });
}

function buildResultView(allRows, query) {
  const wave = normalizeWave(query && query.wave, true);
  if (!wave) return null;
  const gradeRaw = query && query.grade ? String(query.grade) : '';
  if (gradeRaw && !['1', '2', '3'].includes(gradeRaw)) return null;
  const classRaw = query && (query.classNo != null ? query.classNo : query.class) ? String(query.classNo != null ? query.classNo : query.class) : '';
  let classNo = null;
  if (classRaw) {
    if (!/^\d{1,2}$/.test(classRaw)) return null;
    classNo = Number(classRaw);
    if (classNo < 1 || classNo > 30) return null;
  }
  const waveRows = (allRows || []).filter(row => String(row.wave) === wave);
  const people = waveRows.map(presentable);
  const gradeNum = gradeRaw ? Number(gradeRaw) : null;
  const gradePool = gradeNum ? people.filter(row => row.grade === gradeNum) : people;
  const classes = Array.from(new Set(gradePool.map(row => row.classNo).filter(n => Number.isFinite(n)))).sort((a, b) => a - b);
  const shown = classNo ? gradePool.filter(row => row.classNo === classNo) : gradePool;
  const scoredAll = people.filter(row => row.scores);
  const waves = Array.from(new Set((allRows || []).map(row => String(row.wave)).concat([CURRENT_WAVE]))).filter(w => WAVE_RE.test(w));
  waves.sort();
  const scaleStats = SCALES.map(scale => Object.assign({ label: scale.label }, distribution(scoredAll, scale.id)));
  return {
    surveyId: SURVEY_ID,
    kind: 'sdq',
    title: 'SDQ 정신건강 설문',
    wave,
    waves,
    grade: gradeNum,
    gradeLabel: gradeNum ? gradeNum + '학년' : '전체 학년',
    classNo,
    classLabel: classNo ? classNo + '반' : '전체 반',
    classes,
    responseCount: shown.length,
    unscoredCount: shown.filter(row => !row.scores).length,
    stats: {
      all: Object.assign({ label: '전체' }, distribution(scoredAll, 'total')),
      byGrade: gradeStats(scoredAll),
      scales: scaleStats
    },
    students: sortStudents(shown).map(row => ({
      studentId: row.studentId,
      name: row.name,
      grade: row.grade,
      classNo: row.classNo,
      number: row.number,
      updatedAt: row.updatedAt,
      revised: !!row.revised,
      scores: row.scores,
      bands: row.bands
    })),
    cutoffs: cutoffLegend()
  };
}

function cutoffLegend() {
  return [
    { id: 'total', label: '총난점', normal: '0–15', borderline: '16–19', clinical: '20–40', note: '친사회성을 제외한 네 척도의 합. 0~40.' },
    { id: 'emotional', label: '정서증상', normal: '0–5', borderline: '6', clinical: '7–10' },
    { id: 'conduct', label: '품행문제', normal: '0–3', borderline: '4', clinical: '5–10' },
    { id: 'hyperactivity', label: '과잉행동', normal: '0–5', borderline: '6', clinical: '7–10' },
    { id: 'peer', label: '또래관계문제', normal: '0–3', borderline: '4–5', clinical: '6–10' },
    { id: 'prosocial', label: '친사회성', normal: '6–10', borderline: '5', clinical: '0–4', note: '점수가 높을수록 강점입니다.' }
  ];
}

async function actionResults(supabase, body) {
  const user = await loadUser(supabase, body.userId);
  if (!user || !canReadSdq(user)) return fail('이 설문 결과는 볼 수 없습니다.');
  if (normalizeWave(body.wave, true) == null) return fail('회차를 확인해 주세요.');
  let rows;
  try {
    rows = await loadRows(supabase, null);
  } catch (e) {
    const msg = dbMessage(e);
    return fail(msg || '결과를 불러오지 못했습니다.');
  }
  const view = buildResultView(rows, body || {});
  if (!view) return fail('결과 조건을 확인해 주세요.');
  return ok({ view });
}

function formatKst(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);
  const get = type => (parts.find(p => p.type === type) || {}).value || '';
  return get('year') + '-' + get('month') + '-' + get('day') + ' ' + get('hour') + ':' + get('minute');
}

function buildExcelSheets(allRows) {
  const legend = cutoffLegend();
  const info = [
    ['천안중학교 SDQ 정신건강 설문 (SDQ-Kr 자기보고용 25문항)'],
    ['응답', '전혀 아니다=0', '다소 그렇다=1', '확실히 그렇다=2'],
    ['역채점', '7, 11, 14, 21, 25번 (0↔2)'],
    ['총난점', '정서증상+품행문제+과잉행동+또래관계문제. 친사회성은 포함하지 않습니다. 0~40.'],
    ['정렬', '명단은 임상, 경계, 정상 순이고 같은 수준에서는 총난점이 높은 학생을 위에 둡니다.'],
    ['재응답', '같은 회차에 다시 제출하면 이전 응답을 새 답으로 바꿉니다. 제출시각은 마지막 응답 시각이고, 점수는 그 답으로 다시 계산합니다.'],
    ['안내', '선별 참고 점수이며 진단이 아닙니다. 친사회성은 높을수록 강점입니다.'],
    [],
    ['척도', '정상', '경계', '임상', '비고']
  ];
  legend.forEach(row => info.push([row.label, row.normal, row.borderline, row.clinical, row.note || '']));
  const sheets = [{ name: '안내', rows: info }];

  const stats = [['회차', '범위', '척도', '인원', '정상', '정상%', '경계', '경계%', '임상', '임상%', '평균']];
  const waves = Array.from(new Set((allRows || []).map(row => String(row.wave)).filter(w => WAVE_RE.test(w))));
  waves.sort();
  if (!waves.length) waves.push(CURRENT_WAVE);
  waves.forEach(wave => {
    const view = buildResultView(allRows, { wave });
    const blocks = [{ label: '전체', dist: view.stats.all }].concat(view.stats.byGrade.map(g => ({
      label: g.grade + '학년',
      dist: g
    })));
    blocks.forEach(block => {
      stats.push([
        wave, block.label, '총난점', block.dist.count,
        block.dist.bands.정상, pct(block.dist.bands.정상, block.dist.count),
        block.dist.bands.경계, pct(block.dist.bands.경계, block.dist.count),
        block.dist.bands.임상, pct(block.dist.bands.임상, block.dist.count),
        block.dist.mean == null ? '' : block.dist.mean
      ]);
    });
    view.stats.scales.forEach(scale => {
      stats.push([
        wave, '전체', scale.label, scale.count,
        scale.bands.정상, pct(scale.bands.정상, scale.count),
        scale.bands.경계, pct(scale.bands.경계, scale.count),
        scale.bands.임상, pct(scale.bands.임상, scale.count),
        scale.mean == null ? '' : scale.mean
      ]);
    });
  });
  sheets.push({ name: '통계', rows: stats });

  const scoreHeaders = ['정서증상', '정서_수준', '품행문제', '품행_수준', '과잉행동', '과잉_수준', '또래관계문제', '또래_수준', '친사회성', '친사회_수준', '총난점', '위험수준'];
  const scaleIds = ['emotional', 'conduct', 'hyperactivity', 'peer', 'prosocial'];
  waves.forEach(wave => {
    const header = ['제출시각', '재응답', '회차', '학번', '이름', '학년', '반', '번호'].concat(scoreHeaders).concat(ITEMS.map((text, i) => (i + 1) + '. ' + text));
    const rows = [header];
    const people = sortStudents((allRows || []).filter(row => String(row.wave) === wave).map(presentable));
    people.forEach(row => {
      const scores = [];
      if (!row.scores) {
        scoreHeaders.forEach(() => scores.push(''));
        scores[scores.length - 1] = '미채점';
      } else {
        scaleIds.forEach(id => {
          scores.push(row.scores[id], row.bands[id].label);
        });
        scores.push(row.scores.total, row.bands.total.label);
      }
      const raw = ITEMS.map((_, i) => {
        const v = row.answers[String(i + 1)];
        return v == null ? '' : v;
      });
      rows.push([
        formatKst(row.updatedAt), row.revised ? '재응답' : '', row.wave, row.studentId, row.name, row.grade, row.classNo, row.number
      ].concat(scores).concat(raw));
    });
    sheets.push({ name: ('학생_' + wave).slice(0, 31), rows });
  });
  return sheets;
}

function exportFilename(now, wave) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now || Date.now()));
  const get = type => (parts.find(p => p.type === type) || {}).value || '';
  return '천중_SDQ_' + (wave || CURRENT_WAVE) + '_' + get('year') + get('month') + get('day') + '.xlsx';
}

async function actionExport(supabase, body, ctx) {
  const user = await loadUser(supabase, body.userId);
  if (!user || !canReadSdq(user)) return fail('이 설문 결과는 볼 수 없습니다.');
  let rows;
  try {
    rows = await loadRows(supabase, null);
  } catch (e) {
    const msg = dbMessage(e);
    return fail(msg || '결과를 불러오지 못했습니다.');
  }
  return ok({ sheets: buildExcelSheets(rows), filename: exportFilename(ctx.now, CURRENT_WAVE) });
}

async function handleAction(supabase, body, ctx) {
  body = body || {};
  ctx = ctx || {};
  const action = String(body.action || '');
  try {
    if (action === 'status') return await actionStatus(supabase, body);
    if (action === 'form') return await actionForm(supabase, body);
    if (action === 'submit') return await actionSubmit(supabase, body, ctx);
    if (action === 'results') return await actionResults(supabase, body);
    if (action === 'export') return await actionExport(supabase, body, ctx);
    return fail('알 수 없는 요청입니다.');
  } catch (e) {
    const msg = dbMessage(e);
    if (!msg) console.error('sdq', String(e && e.message || e));
    return fail(msg || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

// 허용 목록이 응답에 실리지 않도록 해시만 테스트에서 확인한다.
function readerTag() {
  return crypto.createHash('sha256').update(SDQ_READER_IDS.join('|')).digest('hex').slice(0, 12);
}

module.exports = {
  SURVEY_ID,
  CURRENT_WAVE,
  SDQ_READER_IDS,
  OPTIONS,
  ITEMS,
  REVERSE,
  SCALES,
  canReadSdq,
  parseStudentId,
  parseAnswer,
  itemScore,
  bandFor,
  scoreAnswers,
  validateAnswers,
  publicForm,
  buildResultView,
  buildExcelSheets,
  handleAction
};
