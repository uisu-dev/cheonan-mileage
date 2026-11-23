// 공식 조사 2종. 기존 surveys/survey_logs(참여 시 마일리지 지급)와 분리한다.
const crypto = require('crypto');

const CURRICULUM = 'curriculum_sat_2026';
const BUDGET = 'budget_participation_2027';
const LIKERT = ['매우 그렇다', '그렇다', '보통이다', '그렇지않다', '전혀 그렇지 않다'];
const LIKERT_SCORE = { '매우 그렇다': 5, '그렇다': 4, '보통이다': 3, '그렇지않다': 2, '전혀 그렇지 않다': 1 };
const GROUPS = ['student', 'parent', 'teacher'];
const GROUP_LABEL = { student: '학생', parent: '학부모', teacher: '교사', all: '전체' };
const OPEN_MAX = 4000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 30;
const UNDER14_NOTICE = '학생 본인이 아래 동의를 직접 선택합니다. 보호자(법정대리인)의 동의는 받은 것으로 보며, 가정에서 상의해 주세요.';

let CACHED = null;

function catalog() {
  if (!CACHED) CACHED = applyPolicy(JSON.parse(JSON.stringify(require('../docs/survey/questions.json'))));
  return CACHED;
}

function applyPolicy(doc) {
  const curriculum = doc.surveys.find(s => s.id === CURRICULUM);
  (curriculum.forms || []).forEach(form => {
    (form.questions || []).forEach(q => {
      if (q.type === 'long_text') q.required = false;
      if (q.id === '1-2' && typeof q.text === 'string') q.text = q.text.replace('교육([AI', '교육[AI');
    });
  });
  const budget = doc.surveys.find(s => s.id === BUDGET);
  budget.instructions = (budget.instructions || []).filter(line => !isDeadlineLine(line));
  return doc;
}

function isDeadlineLine(line) {
  return /제출마감일|2024\s*년|12월\s*27일/.test(String(line || ''));
}

function getSurvey(surveyId) {
  return catalog().surveys.find(s => s.id === surveyId) || null;
}

function getForm(surveyId, respondent) {
  const survey = getSurvey(surveyId);
  if (!survey) return null;
  return (survey.forms || []).find(f => f.respondent === respondent) || null;
}

function clip(value, max) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
}

function oneLine(value, max) {
  return clip(value, max).replace(/[\r\n]+/g, ' ');
}

function parseStudentId(id) {
  const s = String(id || '').trim();
  if (!/^\d{5}$/.test(s)) return null;
  return {
    grade: String(Number(s.slice(0, 1))),
    classNo: String(Number(s.slice(1, 3))),
    number: String(Number(s.slice(3, 5)))
  };
}

function isTeacherRole(role) {
  return role === 'teacher' || role === 'admin';
}

function respondentForRole(role) {
  if (role === 'student') return 'student';
  if (isTeacherRole(role)) return 'teacher';
  return null;
}

function userKey(id) {
  return 'u:' + String(id || '').trim();
}

function deviceKey(token) {
  return 'd:' + token;
}

function normalizeDevice(token) {
  const t = String(token || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(t)) return null;
  return t;
}

function hashIp(ip) {
  return crypto.createHash('sha256').update('official-survey-v1|' + String(ip || 'unknown')).digest('hex').slice(0, 40);
}

function publicForm(surveyId, respondent) {
  const survey = getSurvey(surveyId);
  const form = getForm(surveyId, respondent);
  if (!survey || !form || form.participates === false) return null;
  if (surveyId === CURRICULUM) {
    return {
      surveyId,
      kind: 'curriculum',
      title: survey.title,
      respondent,
      groupLabel: GROUP_LABEL[respondent],
      docLabel: form.doc_label || '',
      intro: form.intro || '',
      dateLine: survey.date_line || '',
      signer: survey.signer || '',
      questions: (form.questions || []).map(q => ({
        id: q.id,
        section: q.section,
        indicator: q.indicator,
        promptLabel: q.prompt_label || '',
        text: q.text,
        type: q.type,
        options: (q.options && q.options.length ? q.options : LIKERT).slice(),
        required: q.type === 'long_text' ? false : true
      }))
    };
  }
  return {
    surveyId,
    kind: 'budget',
    title: survey.title,
    heading: survey.form_heading_in_doc || survey.title,
    respondent,
    groupLabel: GROUP_LABEL[respondent],
    instructions: (survey.instructions || []).filter(line => !isDeadlineLine(line)),
    footnote: survey.footnote || '',
    example: survey.example_row ? {
      title: survey.example_row.title,
      content: survey.example_row.content,
      amount: survey.example_row.amount,
      reason: survey.example_row.reason
    } : null,
    privacy: {
      title: survey.privacy.title,
      body: survey.privacy.body,
      items: (survey.privacy.items || []).slice(),
      consentLabel: survey.privacy.consent_label,
      consentOptions: (survey.privacy.consent_options || []).slice(),
      notes: (survey.privacy.notes || []).slice()
    },
    under14Notice: respondent === 'student' ? UNDER14_NOTICE : '',
    identityFields: (form.identity_fields || []).map(f => ({ id: f.id, label: f.label, required: !!f.required })),
    proposals: {
      min: 1,
      max: 3,
      fields: [
        { id: 'title', label: '사업명', required: true },
        { id: 'content', label: '사업내용', required: false },
        { id: 'amount', label: '예산요구액', required: false },
        { id: 'reason', label: '요구사유', required: false }
      ]
    }
  };
}

function fail(msg) {
  return { status: 200, body: { success: false, msg } };
}

function ok(body) {
  return { status: 200, body: Object.assign({ success: true }, body) };
}

function dbMessage(error) {
  const m = String(error && (error.message || error) || '');
  if (/does not exist|schema cache|official_survey/i.test(m)) {
    return '설문 테이블이 없습니다. Supabase SQL Editor에서 sql/official_surveys.sql 파일을 실행해 주세요.';
  }
  return '';
}

function studentIdentity(user) {
  const parsed = parseStudentId(user && user.id);
  if (!parsed || !clip(user.name, 50)) return null;
  return { grade: parsed.grade, class: parsed.classNo, number: parsed.number, name: clip(user.name, 50) };
}

function validateCurriculum(respondent, raw) {
  const form = getForm(CURRICULUM, respondent);
  if (!form) return { ok: false, msg: '설문 양식을 찾을 수 없습니다.' };
  const src = raw && typeof raw === 'object' ? raw : {};
  const answers = {};
  for (const q of form.questions) {
    if (q.type === 'likert5') {
      const v = clip(src[q.id], 30);
      const options = q.options && q.options.length ? q.options : LIKERT;
      if (!options.includes(v)) return { ok: false, msg: '만족도 문항은 모두 선택해 주세요. (' + (q.indicator || q.id) + ')' };
      answers[q.id] = v;
    } else {
      const text = clip(src[q.id], OPEN_MAX + 1);
      if (text.length > OPEN_MAX) return { ok: false, msg: '서술형은 4000자 이내로 적어 주세요.' };
      answers[q.id] = text;
    }
  }
  return { ok: true, answers };
}

function cleanProposals(list) {
  if (!Array.isArray(list)) return { ok: false, msg: '사업 제안을 입력해 주세요.' };
  const proposals = [];
  for (const item of list) {
    const title = oneLine(item && item.title, 200);
    const content = clip(item && item.content, 2000);
    const amount = oneLine(item && item.amount, 50);
    const reason = clip(item && item.reason, 2000);
    if (!title && !content && !amount && !reason) continue;
    if (!title) return { ok: false, msg: '사업명을 입력해 주세요. 내용·예산요구액·요구사유는 비워도 됩니다.' };
    proposals.push({ title, content, amount, reason });
  }
  if (proposals.length < 1 || proposals.length > 3) {
    return { ok: false, msg: '제출할 때는 사업명을 1건 이상 3건 이하로 적어 주세요.' };
  }
  return { ok: true, proposals };
}

function parentIdentity(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const grade = String(clip(src.child_grade, 10)).replace(/학년/g, '');
  if (!['1', '2', '3'].includes(grade)) return { ok: false, msg: '자녀 학년을 선택해 주세요.' };
  const classNo = String(clip(src.child_class, 10)).replace(/반/g, '');
  const classNum = Number(classNo);
  if (!/^\d{1,2}$/.test(classNo) || classNum < 1 || classNum > 30) return { ok: false, msg: '자녀 반을 입력해 주세요.' };
  let number = String(clip(src.child_number, 10)).replace(/번/g, '');
  if (number) {
    const n = Number(number);
    if (!/^\d{1,2}$/.test(number) || n < 1 || n > 99) return { ok: false, msg: '자녀 번호 형식을 확인해 주세요.' };
    number = String(n);
  }
  const name = oneLine(src.child_name, 50);
  const proposer = oneLine(src.proposer_name, 50);
  const phone = oneLine(src.phone, 30).replace(/\s+/g, '');
  const digits = phone.replace(/\D/g, '');
  if (!proposer) return { ok: false, msg: '제안자 성명을 입력해 주세요.' };
  if (digits.length < 8 || digits.length > 15) return { ok: false, msg: '연락처를 입력해 주세요.' };
  if (!name) return { ok: false, msg: '자녀 이름을 입력해 주세요.' };
  return {
    ok: true,
    grade: Number(grade),
    identity: {
      proposer_name: proposer,
      phone,
      child_grade: grade,
      child_class: String(classNum),
      child_number: number,
      child_name: name
    }
  };
}

function validateBudget(respondent, raw, user) {
  const form = getForm(BUDGET, respondent);
  if (!form || form.participates === false) return { ok: false, msg: '교사는 참여예산제 조사에 응답하지 않고 결과만 볼 수 있습니다.' };
  const consent = clip(raw && raw.consent, 10);
  if (consent !== '예') return { ok: false, msg: '개인정보 수집·이용에 「예」로 동의해야 제출할 수 있습니다.' };
  const cleaned = cleanProposals(raw && raw.proposals);
  if (!cleaned.ok) return cleaned;
  if (respondent === 'student') {
    const identity = studentIdentity(user);
    if (!identity) return { ok: false, msg: '학번 5자리 학생 계정만 참여예산제를 제출할 수 있습니다.' };
    return {
      ok: true,
      grade: Number(identity.grade),
      answers: { identity, consent: '예', proposals: cleaned.proposals }
    };
  }
  const ident = parentIdentity(raw && raw.identity);
  if (!ident.ok) return ident;
  return {
    ok: true,
    grade: ident.grade,
    answers: { identity: ident.identity, consent: '예', proposals: cleaned.proposals }
  };
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

async function findOwn(supabase, surveyId, respondent, key) {
  const { data, error } = await supabase.from('official_survey_responses')
    .select('id, created_at, answers, grade, updated_at')
    .eq('survey_id', surveyId)
    .eq('respondent_type', respondent)
    .eq('respondent_key', key)
    .maybeSingle();
  if (error) {
    const msg = dbMessage(error);
    if (msg) {
      const err = new Error(error.message || msg);
      err.code = 'NO_TABLE';
      throw err;
    }
    throw error;
  }
  return data || null;
}

function clientExisting(surveyId, respondent, row, user) {
  if (!row) return null;
  if (surveyId === CURRICULUM) {
    const checked = validateCurriculum(respondent, row.answers || {});
    return checked.ok ? { answers: checked.answers } : { answers: row.answers || {} };
  }
  const answers = row.answers || {};
  const identity = respondent === 'student' && user ? (studentIdentity(user) || answers.identity || {}) : (answers.identity || {});
  return { identity, consent: answers.consent || '', proposals: Array.isArray(answers.proposals) ? answers.proposals : [] };
}

async function saveResponse(supabase, row) {
  let existing;
  try {
    existing = await findOwn(supabase, row.survey_id, row.respondent_type, row.respondent_key);
  } catch (e) {
    return { error: e };
  }
  if (existing && existing.id) {
    const { error } = await supabase.from('official_survey_responses').update({
      grade: row.grade,
      answers: row.answers,
      meta: {},
      updated_at: row.updated_at
    }).eq('id', existing.id);
    return { error, updated: true };
  }
  const { error } = await supabase.from('official_survey_responses').insert({
    survey_id: row.survey_id,
    respondent_type: row.respondent_type,
    respondent_key: row.respondent_key,
    grade: row.grade,
    answers: row.answers,
    meta: {},
    created_at: row.updated_at,
    updated_at: row.updated_at
  });
  return { error, updated: false };
}

async function consumeRate(supabase, bucket, limit, windowMs, now) {
  const { data, error } = await supabase.from('official_survey_rate_limits').select('id, created_at').eq('bucket', bucket);
  if (error) throw error;
  const start = now - windowMs;
  const recent = [];
  const oldIds = [];
  (data || []).forEach(row => {
    const t = new Date(row.created_at).getTime();
    if (t >= start) recent.push(row);
    else if (row.id != null) oldIds.push(row.id);
  });
  if (oldIds.length) await supabase.from('official_survey_rate_limits').delete().in('id', oldIds);
  if (recent.length >= limit) return false;
  const { error: insErr } = await supabase.from('official_survey_rate_limits').insert({
    bucket,
    created_at: new Date(now).toISOString()
  });
  if (insErr) throw insErr;
  return true;
}

function attachStudentBudget(form, user) {
  if (!form || form.kind !== 'budget' || form.respondent !== 'student') return form;
  form.identityLocked = true;
  form.identityPrefill = studentIdentity(user);
  return form;
}

async function actionForm(supabase, body) {
  const surveyId = String(body.surveyId || '');
  const user = await loadUser(supabase, body.userId);
  if (!user) return fail('로그인 사용자를 확인할 수 없습니다.');
  const respondent = respondentForRole(user.role);
  if (!respondent) return fail('이 조사는 학생·교사 계정으로 참여합니다.');
  if (surveyId === BUDGET && respondent === 'teacher') return fail('교사는 참여예산제 조사에 응답하지 않고 결과만 볼 수 있습니다.');
  const form = publicForm(surveyId, respondent);
  if (!form) return fail('설문을 찾을 수 없습니다.');
  attachStudentBudget(form, user);
  let row = null;
  try {
    row = await findOwn(supabase, surveyId, respondent, userKey(user.id));
  } catch (e) {
    if (e.code === 'NO_TABLE') return ok({ form, submitted: false, existing: null, warning: dbMessage(e) });
    throw e;
  }
  return ok({
    form,
    submitted: !!row,
    existing: clientExisting(surveyId, respondent, row, user)
  });
}

async function actionStatus(supabase, body) {
  const user = await loadUser(supabase, body.userId);
  if (!user) return fail('로그인 사용자를 확인할 수 없습니다.');
  const respondent = respondentForRole(user.role);
  if (!respondent) return fail('이 조사는 학생·교사 계정으로 참여합니다.');
  const submitted = {};
  submitted[CURRICULUM] = false;
  submitted[BUDGET] = false;
  try {
    const { data, error } = await supabase.from('official_survey_responses')
      .select('survey_id')
      .eq('respondent_type', respondent)
      .eq('respondent_key', userKey(user.id));
    if (error) throw error;
    (data || []).forEach(row => { submitted[row.survey_id] = true; });
  } catch (e) {
    const msg = dbMessage(e);
    if (msg) return ok({ role: user.role, respondent, submitted, warning: msg });
    throw e;
  }
  if (respondent === 'teacher') submitted[BUDGET] = false;
  return ok({ role: user.role, respondent, submitted });
}

async function actionSubmit(supabase, body, ctx) {
  const surveyId = String(body.surveyId || '');
  const user = await loadUser(supabase, body.userId);
  if (!user) return fail('로그인 사용자를 확인할 수 없습니다.');
  const respondent = respondentForRole(user.role);
  if (!respondent) return fail('이 조사는 학생·교사 계정으로 참여합니다.');
  let packed;
  let grade = null;
  if (surveyId === CURRICULUM) {
    packed = validateCurriculum(respondent, body.answers);
    if (!packed.ok) return fail(packed.msg);
    if (respondent === 'student') {
      const parsed = parseStudentId(user.id);
      grade = parsed ? Number(parsed.grade) : null;
    }
  } else if (surveyId === BUDGET) {
    packed = validateBudget(respondent, body, user);
    if (!packed.ok) return fail(packed.msg);
    grade = packed.grade;
  } else {
    return fail('설문을 찾을 수 없습니다.');
  }
  const saved = await saveResponse(supabase, {
    survey_id: surveyId,
    respondent_type: respondent,
    respondent_key: userKey(user.id),
    grade,
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
    msg: saved.updated ? '수정했습니다.' : '제출했습니다.'
  });
}

async function loadParentRows(supabase, device) {
  const { data, error } = await supabase.from('official_survey_responses')
    .select('survey_id, answers, grade, updated_at')
    .eq('respondent_type', 'parent')
    .eq('respondent_key', deviceKey(device));
  if (error) throw error;
  const existing = {};
  (data || []).forEach(row => {
    existing[row.survey_id] = clientExisting(row.survey_id, 'parent', row, null);
  });
  return existing;
}

async function actionParentBundle(supabase, body) {
  const device = normalizeDevice(body.deviceToken);
  if (!device) return fail('페이지를 새로고침한 뒤 다시 열어 주세요.');
  const forms = [publicForm(CURRICULUM, 'parent'), publicForm(BUDGET, 'parent')];
  try {
    const existing = await loadParentRows(supabase, device);
    return ok({ forms, existing });
  } catch (e) {
    const msg = dbMessage(e);
    if (msg) return ok({ forms, existing: {}, warning: msg });
    throw e;
  }
}

async function actionParentSubmit(supabase, body, ctx) {
  const device = normalizeDevice(body.deviceToken);
  if (!device) return fail('페이지를 새로고침한 뒤 다시 열어 주세요.');
  const surveyId = String(body.surveyId || '');
  if (surveyId !== CURRICULUM && surveyId !== BUDGET) return fail('설문을 찾을 수 없습니다.');
  const now = ctx.now || Date.now();
  const limit = ctx.rateMax || RATE_MAX;
  let allowed = true;
  try {
    allowed = await consumeRate(supabase, 'ip:' + hashIp(ctx.ip || 'unknown'), limit, RATE_WINDOW_MS, now);
  } catch (e) {
    const msg = dbMessage(e);
    return fail(msg || '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!allowed) return fail('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  let packed;
  let grade = null;
  if (surveyId === CURRICULUM) {
    packed = validateCurriculum('parent', body.answers);
    if (!packed.ok) return fail(packed.msg);
  } else {
    packed = validateBudget('parent', body, null);
    if (!packed.ok) return fail(packed.msg);
    grade = packed.grade;
  }
  const saved = await saveResponse(supabase, {
    survey_id: surveyId,
    respondent_type: 'parent',
    respondent_key: deviceKey(device),
    grade,
    answers: packed.answers,
    updated_at: new Date(now).toISOString()
  });
  if (saved.error) {
    const msg = dbMessage(saved.error);
    return fail(msg || '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  return ok({
    submitted: true,
    updated: !!saved.updated,
    msg: saved.updated ? '수정했습니다.' : '제출했습니다. 감사합니다.'
  });
}

function sanitizeRow(row) {
  const surveyId = row.survey_id;
  const respondent = row.respondent_type;
  const grade = row.grade == null || row.grade === '' ? null : Number(row.grade);
  if (surveyId === CURRICULUM) {
    const checked = validateCurriculum(respondent, row.answers || {});
    return {
      survey_id: surveyId,
      respondent_type: respondent,
      grade: Number.isFinite(grade) ? grade : null,
      answers: checked.ok ? checked.answers : {},
      updated_at: row.updated_at || null
    };
  }
  const answers = row.answers || {};
  return {
    survey_id: surveyId,
    respondent_type: respondent,
    grade: Number.isFinite(grade) ? grade : null,
    answers: {
      identity: answers.identity || {},
      consent: answers.consent || '',
      proposals: Array.isArray(answers.proposals) ? answers.proposals : []
    },
    updated_at: row.updated_at || null
  };
}

async function loadAllRows(supabase) {
  const { data, error } = await supabase.from('official_survey_responses')
    .select('survey_id, respondent_type, grade, answers, updated_at');
  if (error) throw error;
  return (data || []).map(sanitizeRow);
}

async function requireTeacher(supabase, userId) {
  const user = await loadUser(supabase, userId);
  if (!user || !isTeacherRole(user.role)) return null;
  return user;
}

function pct(count, total) {
  if (!total) return 0;
  return Math.round(count / total * 1000) / 10;
}

function meanOf(counts, options) {
  let sum = 0;
  let n = 0;
  options.forEach(label => {
    const c = counts[label] || 0;
    if (LIKERT_SCORE[label] == null) return;
    sum += LIKERT_SCORE[label] * c;
    n += c;
  });
  if (!n) return null;
  return Math.round(sum / n * 100) / 100;
}

function questionStats(form, rows) {
  return (form.questions || []).map(q => {
    if (q.type === 'long_text') {
      const answers = [];
      rows.forEach(row => {
        const text = clip(row.answers && row.answers[q.id], OPEN_MAX);
        if (text) answers.push({ text, grade: row.grade == null ? null : Number(row.grade) });
      });
      return {
        id: q.id,
        section: q.section,
        indicator: q.indicator,
        promptLabel: q.prompt_label || '서술형1)',
        text: q.text,
        type: 'long_text',
        answers
      };
    }
    const options = q.options && q.options.length ? q.options : LIKERT;
    const counts = {};
    options.forEach(label => { counts[label] = 0; });
    rows.forEach(row => {
      const v = row.answers && row.answers[q.id];
      if (counts[v] != null) counts[v] += 1;
    });
    const answered = options.reduce((sum, label) => sum + counts[label], 0);
    return {
      id: q.id,
      section: q.section,
      indicator: q.indicator,
      text: q.text,
      type: 'likert5',
      responseCount: answered,
      mean: meanOf(counts, options),
      options: options.map(label => ({ label, count: counts[label], pct: pct(counts[label], answered) }))
    };
  });
}

function buildSection(allRows, surveyId, group, grade) {
  const form = getForm(surveyId, group);
  const base = allRows.filter(row => row.survey_id === surveyId && row.respondent_type === group);
  const gradeCounts = { '1': 0, '2': 0, '3': 0 };
  base.forEach(row => {
    const g = String(row.grade);
    if (gradeCounts[g] != null) gradeCounts[g] += 1;
  });
  const filtered = grade ? base.filter(row => String(row.grade) === String(grade)) : base.slice();
  let note = '';
  if (surveyId === BUDGET && group === 'teacher') note = '교사는 참여예산제 조사의 응답 대상이 아닙니다.';
  else if (grade && base.length && !filtered.length && base.every(row => row.grade == null)) {
    note = '이 집단은 학년 정보가 없습니다. 학년을 전체로 두면 응답이 보입니다.';
  }
  const section = {
    group,
    groupLabel: GROUP_LABEL[group],
    responseCount: (surveyId === BUDGET && group === 'teacher') ? 0 : filtered.length,
    gradeCounts,
    gradeAvailable: base.some(row => row.grade != null),
    note,
    questions: [],
    proposals: null
  };
  if (surveyId === BUDGET && group === 'teacher') return section;
  if (surveyId === CURRICULUM && form) {
    section.questions = questionStats(form, filtered);
    return section;
  }
  section.proposals = filtered.map(row => ({
    grade: row.grade == null ? null : Number(row.grade),
    updatedAt: row.updated_at || null,
    identity: (row.answers && row.answers.identity) || {},
    consent: row.answers && row.answers.consent || '',
    items: (row.answers && row.answers.proposals) || []
  }));
  section.proposalCount = section.proposals.reduce((sum, item) => sum + item.items.length, 0);
  return section;
}

function resultChoices() {
  return {
    surveys: catalog().surveys.map(s => ({ id: s.id, title: s.title })),
    groups: [{ id: 'all', label: '전체' }].concat(GROUPS.map(id => ({ id, label: GROUP_LABEL[id] }))),
    grades: [
      { id: '', label: '전체 학년' },
      { id: '1', label: '1학년' },
      { id: '2', label: '2학년' },
      { id: '3', label: '3학년' }
    ]
  };
}

function buildResultView(allRows, query) {
  const surveyId = String(query.surveyId || CURRICULUM);
  const survey = getSurvey(surveyId);
  if (!survey) return null;
  const group = String(query.group || 'all');
  if (group !== 'all' && !GROUPS.includes(group)) return null;
  const grade = query.grade ? String(query.grade) : '';
  if (grade && !['1', '2', '3'].includes(grade)) return null;
  const groups = group === 'all' ? GROUPS : [group];
  return {
    surveyId,
    title: survey.title,
    group,
    groupLabel: GROUP_LABEL[group] || '전체',
    grade: grade || null,
    gradeLabel: grade ? grade + '학년' : '전체 학년',
    sections: groups.map(g => buildSection(allRows, surveyId, g, grade))
  };
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

function gradeSlices(section) {
  return section.gradeAvailable ? ['', '1', '2', '3'] : [''];
}

function buildExcelSheets(allRows) {
  const summary = [
    ['천안중학교 공식 조사 결과'],
    ['척도', '매우 그렇다=5', '그렇다=4', '보통이다=3', '그렇지않다=2', '전혀 그렇지 않다=1'],
    ['안내', '교육과정 만족도에는 학번과 이름을 넣지 않습니다. 참여예산제에는 제안자 정보를 넣습니다.'],
    [],
    ['조사', '응답집단', '학년', '응답수', '영역', '문항번호', '문항', '유형', '보기', '인원', '비율', '평균']
  ];
  const sheets = [];
  catalog().surveys.forEach(survey => {
    GROUPS.forEach(group => {
      const whole = buildSection(allRows, survey.id, group, '');
      if (survey.id === BUDGET && group === 'teacher') {
        summary.push([survey.title, GROUP_LABEL[group], '전체', 0, '', '', whole.note, '안내', '', 0, '', '']);
        return;
      }
      gradeSlices(whole).forEach(grade => {
        const section = buildSection(allRows, survey.id, group, grade);
        const gradeLabel = grade ? grade + '학년' : '전체';
        if (survey.id === CURRICULUM) {
          section.questions.forEach(q => {
            if (q.type === 'long_text') {
              summary.push([survey.title, section.groupLabel, gradeLabel, section.responseCount, q.section, q.promptLabel || q.id, q.text, '서술형', '응답 수', q.answers.length, '', '']);
              return;
            }
            q.options.forEach(opt => {
              summary.push([
                survey.title, section.groupLabel, gradeLabel, section.responseCount, q.section, q.indicator || q.id, q.text,
                '리커트', opt.label, opt.count, opt.pct, q.mean == null ? '' : q.mean
              ]);
            });
          });
        } else {
          summary.push([survey.title, section.groupLabel, gradeLabel, section.responseCount, '', '', '', '제안', '제안 건수', section.proposalCount || 0, '', '']);
        }
      });
    });
  });
  sheets.push({ name: '요약', rows: summary });

  GROUPS.forEach(group => {
    const form = getForm(CURRICULUM, group);
    const header = ['제출시각', '학년'].concat((form.questions || []).map(q => (q.indicator || q.promptLabel || q.prompt_label || q.id) + ' ' + q.text));
    const rows = [header];
    allRows.filter(row => row.survey_id === CURRICULUM && row.respondent_type === group).forEach(row => {
      rows.push([formatKst(row.updated_at), row.grade == null ? '' : row.grade].concat((form.questions || []).map(q => (row.answers && row.answers[q.id]) || '')));
    });
    sheets.push({ name: '교육과정_' + GROUP_LABEL[group], rows });
  });

  const proposalHeaders = ['사업명', '사업내용', '예산요구액', '요구사유'];
  function proposalCells(items) {
    const cells = [];
    for (let i = 0; i < 3; i++) {
      const item = items[i] || {};
      cells.push(item.title || '', item.content || '', item.amount || '', item.reason || '');
    }
    return cells;
  }
  const studentHeader = ['제출시각', '학년', '반', '번호', '이름', '동의']
    .concat([1, 2, 3].flatMap(n => proposalHeaders.map(h => h + n)));
  const studentRows = [studentHeader];
  allRows.filter(row => row.survey_id === BUDGET && row.respondent_type === 'student').forEach(row => {
    const idn = row.answers.identity || {};
    studentRows.push([
      formatKst(row.updated_at), idn.grade || '', idn.class || '', idn.number || '', idn.name || '', row.answers.consent || ''
    ].concat(proposalCells(row.answers.proposals || [])));
  });
  sheets.push({ name: '참여예산_학생', rows: studentRows });

  const parentHeader = ['제출시각', '제안자 성명', '연락처', '자녀 학년', '자녀 반', '자녀 번호', '자녀 이름', '동의']
    .concat([1, 2, 3].flatMap(n => proposalHeaders.map(h => h + n)));
  const parentRows = [parentHeader];
  allRows.filter(row => row.survey_id === BUDGET && row.respondent_type === 'parent').forEach(row => {
    const idn = row.answers.identity || {};
    parentRows.push([
      formatKst(row.updated_at), idn.proposer_name || '', idn.phone || '', idn.child_grade || '', idn.child_class || '',
      idn.child_number || '', idn.child_name || '', row.answers.consent || ''
    ].concat(proposalCells(row.answers.proposals || [])));
  });
  sheets.push({ name: '참여예산_학부모', rows: parentRows });
  return sheets;
}

function exportFilename(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now || Date.now()));
  const get = type => (parts.find(p => p.type === type) || {}).value || '';
  return '천중_공식조사_' + get('year') + get('month') + get('day') + '.xlsx';
}

async function actionResults(supabase, body) {
  const teacher = await requireTeacher(supabase, body.userId);
  if (!teacher) return fail('결과는 교사만 볼 수 있습니다.');
  let rows;
  try {
    rows = await loadAllRows(supabase);
  } catch (e) {
    const msg = dbMessage(e);
    return fail(msg || '결과를 불러오지 못했습니다.');
  }
  const view = buildResultView(rows, body || {});
  if (!view) return fail('결과 조건을 확인해 주세요.');
  return ok({ view, choices: resultChoices() });
}

async function actionExport(supabase, body, ctx) {
  const teacher = await requireTeacher(supabase, body.userId);
  if (!teacher) return fail('결과는 교사만 볼 수 있습니다.');
  let rows;
  try {
    rows = await loadAllRows(supabase);
  } catch (e) {
    const msg = dbMessage(e);
    return fail(msg || '결과를 불러오지 못했습니다.');
  }
  return ok({ sheets: buildExcelSheets(rows), filename: exportFilename(ctx.now) });
}

async function handleAction(supabase, body, ctx) {
  body = body || {};
  ctx = ctx || {};
  const action = String(body.action || '');
  try {
    if (action === 'form') return await actionForm(supabase, body);
    if (action === 'status') return await actionStatus(supabase, body);
    if (action === 'submit') return await actionSubmit(supabase, body, ctx);
    if (action === 'parentBundle') return await actionParentBundle(supabase, body);
    if (action === 'parentSubmit') return await actionParentSubmit(supabase, body, ctx);
    if (action === 'results') return await actionResults(supabase, body);
    if (action === 'export') return await actionExport(supabase, body, ctx);
    return fail('알 수 없는 요청입니다.');
  } catch (e) {
    const msg = dbMessage(e);
    if (!msg) console.error('official-survey', String(e && e.message || e));
    return fail(msg || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

module.exports = {
  CURRICULUM,
  BUDGET,
  LIKERT,
  GROUP_LABEL,
  UNDER14_NOTICE,
  RATE_MAX,
  catalog,
  publicForm,
  parseStudentId,
  validateCurriculum,
  validateBudget,
  buildResultView,
  buildExcelSheets,
  handleAction,
  hashIp,
  normalizeDevice
};
