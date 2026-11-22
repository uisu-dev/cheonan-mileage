// 공식 조사 검증 (실DB 미사용)
// 실행: node test/official-survey.test.js
const assert = require('assert');
const { makeDb } = require('./_mockdb');
const S = require('../lib/official-surveys');

global.window = global;
global.document = { addEventListener() {} };
require('../public/official-survey.js');

const DEVICE = '11111111-1111-4111-8111-111111111111';

function db() {
  return makeDb({
    users: [
      { id: '10327', name: '홍길동', role: 'student', points: 10 },
      { id: '20101', name: '김학생', role: 'student', points: 3 },
      { id: 'T001', name: '박교사', role: 'teacher', points: 0 },
      { id: 'A001', name: '최관리', role: 'admin', points: 0 }
    ],
    official_survey_responses: [],
    official_survey_rate_limits: [],
    survey_logs: []
  }, { unique: { official_survey_responses: [['survey_id', 'respondent_type', 'respondent_key']] } });
}

function likert(form, value, open) {
  const answers = {};
  form.questions.forEach(q => {
    answers[q.id] = q.type === 'long_text' ? (open || '') : value;
  });
  return answers;
}

function budgetBody(extra) {
  return Object.assign({
    consent: '예',
    proposals: [{ title: '우산 거치대', content: '출입구 설치', amount: '1000000', reason: '비 올 때 불편함' }]
  }, extra || {});
}

(async () => {
  const studentForm = S.publicForm(S.CURRICULUM, 'student');
  const parentForm = S.publicForm(S.CURRICULUM, 'parent');
  const teacherForm = S.publicForm(S.CURRICULUM, 'teacher');
  assert.strictEqual(studentForm.questions.length, 12);
  assert.strictEqual(parentForm.questions.length, 12);
  assert.strictEqual(teacherForm.questions.length, 15);
  assert.strictEqual(studentForm.questions.filter(q => q.type === 'likert5').length, 11);
  assert.strictEqual(teacherForm.questions.filter(q => q.type === 'likert5').length, 14);
  assert.ok(teacherForm.questions.some(q => q.id === '3-2' && q.id));
  assert.ok(teacherForm.questions.some(q => q.id === '3-3'));
  assert.ok(teacherForm.questions.some(q => q.id === '4-2'));
  ['3-2', '3-3', '4-2'].forEach(id => {
    assert.ok(!studentForm.questions.some(q => q.id === id));
    assert.ok(!parentForm.questions.some(q => q.id === id));
  });

  const s12 = studentForm.questions.find(q => q.id === '1-2');
  assert.ok(s12.text.includes('교육[AI(인공지능)'));
  assert.ok(!s12.text.includes('교육([AI'));
  assert.strictEqual(s12.text, parentForm.questions.find(q => q.id === '1-2').text);
  assert.notStrictEqual(studentForm.questions.find(q => q.id === '1-3').text, parentForm.questions.find(q => q.id === '1-3').text);
  assert.notStrictEqual(studentForm.questions.find(q => q.id === '1-1').text, teacherForm.questions.find(q => q.id === '1-1').text);
  studentForm.questions.filter(q => q.type === 'likert5').forEach(q => {
    assert.deepStrictEqual(q.options, S.LIKERT);
    assert.strictEqual(q.required, true);
  });
  assert.strictEqual(studentForm.questions.find(q => q.id === 'open-1').required, false);
  assert.strictEqual(parentForm.questions.find(q => q.id === 'open-1').required, false);
  assert.strictEqual(teacherForm.questions.find(q => q.id === 'open-1').required, false);
  assert.strictEqual(studentForm.dateLine, '2026. 12. 2.');
  assert.strictEqual(studentForm.signer, '천안중학교장');

  const parentBudget = S.publicForm(S.BUDGET, 'parent');
  const studentBudget = S.publicForm(S.BUDGET, 'student');
  assert.strictEqual(S.publicForm(S.BUDGET, 'teacher'), null);
  assert.ok(parentBudget.identityFields.some(f => f.id === 'child_number'));
  assert.ok(parentBudget.identityFields.some(f => f.id === 'child_grade' && f.required));
  assert.strictEqual(studentBudget.under14Notice, S.UNDER14_NOTICE);
  assert.strictEqual(parentBudget.under14Notice, '');
  const pub = JSON.stringify(parentBudget) + JSON.stringify(studentBudget) + JSON.stringify(parentForm);
  assert.ok(!pub.includes('2024'));
  assert.ok(!pub.includes('제출마감'));
  assert.ok(parentBudget.instructions.some(line => line.includes('학생자치회에서 제출 가능합니다')));
  assert.ok(parentBudget.instructions.some(line => line.includes('041-563-0242')));
  assert.deepStrictEqual(parentBudget.privacy.consentOptions, ['예', '아니요']);

  const store = db();
  const base = { ip: '203.0.113.9', now: Date.parse('2026-11-22T00:00:00Z') };

  let res = await S.handleAction(store, {
    action: 'submit', userId: '10327', surveyId: S.CURRICULUM,
    answers: likert(studentForm, '그렇다', ''),
    role: 'teacher',
    name: '가짜이름'
  }, base);
  assert.strictEqual(res.body.success, true, res.body.msg);
  assert.strictEqual(store.tables.users.find(u => u.id === '10327').points, 10);
  assert.strictEqual(store.tables.survey_logs.length, 0);
  assert.strictEqual(store.tables.official_survey_responses.length, 1);
  assert.strictEqual(store.tables.official_survey_responses[0].respondent_type, 'student');
  assert.strictEqual(store.tables.official_survey_responses[0].grade, 1);
  assert.strictEqual(store.tables.official_survey_responses[0].answers.name, undefined);
  assert.strictEqual(store.tables.official_survey_responses[0].answers['open-1'], '');

  res = await S.handleAction(store, {
    action: 'submit', userId: '10327', surveyId: S.CURRICULUM,
    answers: likert(studentForm, '매우 그렇다', '운동장이 좋아요')
  }, { ip: base.ip, now: base.now + 5000 });
  assert.strictEqual(res.body.updated, true);
  assert.strictEqual(store.tables.official_survey_responses.length, 1);
  assert.strictEqual(store.tables.official_survey_responses[0].answers['1-1'], '매우 그렇다');
  assert.strictEqual(store.tables.official_survey_responses[0].created_at, new Date(base.now).toISOString());

  res = await S.handleAction(store, {
    action: 'submit', userId: 'T001', surveyId: S.CURRICULUM,
    answers: likert(teacherForm, '전혀 그렇지 않다', '시설 보완이 필요합니다')
  }, base);
  assert.strictEqual(res.body.success, true, res.body.msg);
  assert.strictEqual(store.tables.official_survey_responses.filter(r => r.respondent_type === 'teacher')[0].grade, null);

  res = await S.handleAction(store, { action: 'submit', userId: 'T001', surveyId: S.BUDGET, consent: '예', proposals: [{ title: '없음' }] }, base);
  assert.strictEqual(res.body.success, false);
  assert.ok(res.body.msg.includes('교사'));

  res = await S.handleAction(store, {
    action: 'submit', userId: '10327', surveyId: S.BUDGET,
    consent: '아니요',
    proposals: [{ title: '게시판' }]
  }, base);
  assert.strictEqual(res.body.success, false);

  res = await S.handleAction(store, Object.assign({
    action: 'submit', userId: '10327', surveyId: S.BUDGET,
    identity: { grade: '3', class: '9', number: '9', name: '다른사람' }
  }, budgetBody()), base);
  assert.strictEqual(res.body.success, true, res.body.msg);
  const budgetRow = store.tables.official_survey_responses.find(r => r.survey_id === S.BUDGET);
  assert.strictEqual(budgetRow.answers.identity.name, '홍길동');
  assert.strictEqual(budgetRow.answers.identity.grade, '1');
  assert.strictEqual(budgetRow.answers.identity.class, '3');
  assert.strictEqual(budgetRow.answers.identity.number, '27');
  assert.notStrictEqual(budgetRow.answers.identity.name, '다른사람');

  res = await S.handleAction(store, {
    action: 'parentSubmit', deviceToken: DEVICE, surveyId: S.CURRICULUM,
    answers: Object.assign(likert(parentForm, '보통이다', ''), { name: '학부모이름', phone: '010-9999-0000' })
  }, base);
  assert.strictEqual(res.body.success, true, res.body.msg);
  const parentCur = store.tables.official_survey_responses.find(r => r.survey_id === S.CURRICULUM && r.respondent_type === 'parent');
  assert.strictEqual(parentCur.grade, null);
  assert.strictEqual(parentCur.answers.phone, undefined);
  assert.strictEqual(parentCur.answers.name, undefined);

  res = await S.handleAction(store, {
    action: 'parentSubmit', deviceToken: DEVICE, surveyId: S.BUDGET,
    consent: '예',
    identity: { proposer_name: '홍보호', phone: '010-9999-0000', child_grade: '2학년', child_class: '4', child_number: '', child_name: '홍자녀' },
    proposals: [
      { title: '독서 코너', content: '', amount: '', reason: '' },
      { title: '', content: '', amount: '', reason: '' }
    ]
  }, Object.assign({}, base, { now: base.now + 1000 }));
  assert.strictEqual(res.body.success, true, res.body.msg);
  const parentBudgetRow = store.tables.official_survey_responses.find(r => r.survey_id === S.BUDGET && r.respondent_type === 'parent');
  assert.strictEqual(parentBudgetRow.answers.proposals.length, 1);
  assert.strictEqual(parentBudgetRow.grade, 2);
  assert.strictEqual(parentBudgetRow.answers.identity.child_number, '');

  res = await S.handleAction(store, {
    action: 'parentSubmit', deviceToken: DEVICE, surveyId: S.BUDGET,
    consent: '예', identity: { proposer_name: '홍보호', phone: '123', child_grade: '2', child_class: '4', child_name: '홍자녀' },
    proposals: [{ title: '물품' }]
  }, base);
  assert.strictEqual(res.body.success, false);

  const spam = db();
  for (let i = 0; i < 3; i++) {
    const token = '22222222-2222-4222-8222-22222222222' + i;
    const out = await S.handleAction(spam, {
      action: 'parentSubmit', deviceToken: token, surveyId: S.CURRICULUM,
      answers: likert(parentForm, '그렇다', '')
    }, { ip: '198.51.100.20', now: base.now + i, rateMax: 3 });
    assert.strictEqual(out.body.success, true, out.body.msg);
  }
  const blocked = await S.handleAction(spam, {
    action: 'parentSubmit', deviceToken: '33333333-3333-4333-8333-333333333333', surveyId: S.CURRICULUM,
    answers: likert(parentForm, '그렇다', '')
  }, { ip: '198.51.100.20', now: base.now + 10, rateMax: 3 });
  assert.strictEqual(blocked.body.success, false);
  assert.ok(!JSON.stringify(spam.tables.official_survey_rate_limits).includes('198.51.100.20'));

  const view = (await S.handleAction(store, { action: 'results', userId: 'T001', surveyId: S.CURRICULUM, group: 'all' }, base)).body;
  assert.strictEqual(view.success, true, view.msg);
  const blob = JSON.stringify(view);
  assert.ok(!blob.includes('10327'));
  assert.ok(!blob.includes('홍길동'));
  assert.ok(!blob.includes('respondent_key'));
  assert.ok(!blob.includes('010-9999-0000'));
  assert.ok(blob.includes('운동장이 좋아요'));
  const studentSec = view.view.sections.find(s => s.group === 'student');
  const teacherSec = view.view.sections.find(s => s.group === 'teacher');
  const qStudent = studentSec.questions.find(q => q.id === '1-1');
  const qTeacher = teacherSec.questions.find(q => q.id === '1-1');
  assert.strictEqual(qStudent.mean, 5);
  assert.strictEqual(qTeacher.mean, 1);
  assert.notStrictEqual(qStudent.text, qTeacher.text);
  assert.ok(!studentSec.questions.some(q => q.id === '3-2'));
  assert.ok(teacherSec.questions.some(q => q.id === '3-2'));
  const open = studentSec.questions.find(q => q.id === 'open-1');
  assert.deepStrictEqual(open.answers, [{ text: '운동장이 좋아요', grade: 1 }]);
  assert.strictEqual(open.answers[0].name, undefined);

  const formHtml = OfficialSurvey.renderCurriculum(studentForm, null);
  studentForm.questions.forEach(q => assert.ok(formHtml.includes(q.text), q.id));
  assert.ok(formHtml.includes('2026. 12. 2.'));
  assert.ok(formHtml.includes('천안중학교장'));
  assert.ok(formHtml.includes('(선택)'));
  assert.ok(!formHtml.includes('교육([AI'));
  assert.ok(!formHtml.includes('2024'));
  assert.ok(!formHtml.includes('제출마감'));
  const budgetHtml = OfficialSurvey.renderBudget(studentBudget, null);
  assert.ok(budgetHtml.includes(S.UNDER14_NOTICE));
  assert.ok(budgetHtml.includes('value="예"'));
  assert.ok(budgetHtml.includes('value="아니요"'));
  assert.ok(!budgetHtml.includes('2024'));
  assert.ok(!budgetHtml.includes('제출마감'));
  const parentHtml = OfficialSurvey.renderBudget(parentBudget, null);
  assert.ok(parentHtml.includes('자녀 번호'));
  assert.ok(parentHtml.includes('자녀 학년'));
  assert.ok(!parentHtml.includes(S.UNDER14_NOTICE));
  const resultHtml = OfficialSurvey.renderResults(view.view);
  assert.ok(resultHtml.includes('운동장이 좋아요'));
  assert.ok(resultHtml.includes('os-bar'));
  assert.ok(resultHtml.includes('평균 5.00'));
  assert.ok(!resultHtml.includes('홍길동'));
  assert.ok(!resultHtml.includes('10327'));

  const denied = await S.handleAction(store, { action: 'results', userId: '10327', surveyId: S.CURRICULUM }, base);
  assert.strictEqual(denied.body.success, false);
  const admin = await S.handleAction(store, { action: 'export', userId: 'A001' }, base);
  assert.strictEqual(admin.body.success, true, admin.body.msg);
  const names = admin.body.sheets.map(s => s.name);
  assert.deepStrictEqual(names, ['요약', '교육과정_학생', '교육과정_학부모', '교육과정_교사', '참여예산_학생', '참여예산_학부모']);
  const summary = JSON.stringify(admin.body.sheets[0].rows);
  assert.ok(summary.includes('학번과 이름을 넣지 않습니다'));
  assert.ok(!summary.includes('2024'));
  assert.ok(!summary.includes('제출마감'));
  const curStudent = admin.body.sheets.find(s => s.name === '교육과정_학생');
  assert.ok(!curStudent.rows[0].includes('이름'));
  assert.ok(!JSON.stringify(curStudent.rows).includes('10327'));
  assert.ok(!JSON.stringify(curStudent.rows).includes('홍길동'));
  const budgetStudent = admin.body.sheets.find(s => s.name === '참여예산_학생');
  assert.ok(JSON.stringify(budgetStudent.rows).includes('홍길동'));
  assert.strictEqual(budgetStudent.rows[1][1], '1');
  assert.strictEqual(budgetStudent.rows[1][2], '3');
  assert.strictEqual(budgetStudent.rows[1][3], '27');
  const budgetParent = admin.body.sheets.find(s => s.name === '참여예산_학부모');
  assert.ok(JSON.stringify(budgetParent.rows).includes('010-9999-0000'));
  assert.ok(JSON.stringify(budgetParent.rows).includes('홍보호'));

  const gradeView = (await S.handleAction(store, {
    action: 'results', userId: 'T001', surveyId: S.BUDGET, group: 'parent', grade: '2'
  }, base)).body.view;
  assert.strictEqual(gradeView.sections[0].responseCount, 1);
  assert.strictEqual(gradeView.sections[0].proposals[0].identity.proposer_name, '홍보호');

  const status = await S.handleAction(store, { action: 'status', userId: '10327' }, base);
  assert.strictEqual(status.body.submitted[S.CURRICULUM], true);
  assert.strictEqual(status.body.submitted[S.BUDGET], true);
  const teacherStatus = await S.handleAction(store, { action: 'status', userId: 'T001' }, base);
  assert.strictEqual(teacherStatus.body.submitted[S.BUDGET], false);

  const form = await S.handleAction(store, { action: 'form', userId: '10327', surveyId: S.BUDGET, respondent: 'teacher' }, base);
  assert.strictEqual(form.body.form.respondent, 'student');
  assert.strictEqual(form.body.form.identityPrefill.name, '홍길동');
  assert.strictEqual(form.body.submitted, true);

  const bundle = await S.handleAction(store, { action: 'parentBundle', deviceToken: DEVICE }, base);
  assert.strictEqual(bundle.body.forms.length, 2);
  assert.ok(bundle.body.existing[S.CURRICULUM]);
  assert.strictEqual(bundle.body.existing[S.BUDGET].proposals.length, 1);

  const bad = S.validateCurriculum('student', likert(studentForm, '아주 그렇다', ''));
  assert.strictEqual(bad.ok, false);
  const four = S.validateBudget('parent', {
    consent: '예',
    identity: { proposer_name: '가', phone: '010-1111-2222', child_grade: '1', child_class: '1', child_name: '나' },
    proposals: [{ title: 'a' }, { title: 'b' }, { title: 'c' }, { title: 'd' }]
  }, null);
  assert.strictEqual(four.ok, false);
  const noTitle = S.validateBudget('student', { consent: '예', proposals: [{ title: '', content: '내용만' }] }, { id: '10327', name: '홍길동' });
  assert.strictEqual(noTitle.ok, false);

  const parsed = S.parseStudentId('10327');
  assert.deepStrictEqual(parsed, { grade: '1', classNo: '3', number: '27' });

  console.log('official-survey tests ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
