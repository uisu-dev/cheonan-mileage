// 학년·반 참여 현황 (실DB 미사용)
// 실행: node test/participation.test.js
const assert = require('assert');
const { makeDb } = require('./_mockdb');
const S = require('../lib/official-surveys');
const P = require('../lib/participation');
const SDQ = require('../lib/sdq');

global.window = global;
global.document = { addEventListener() {} };
require('../public/official-survey.js');

function db() {
  return makeDb({
    users: [
      { id: '10301', name: '김하나', role: 'student' },
      { id: '10302', name: '김둘', role: 'student' },
      { id: '10303', name: '김셋', role: 'student' },
      { id: '10304', name: '전출', role: 'withdrawn' },
      { id: '10401', name: '이하나', role: 'student' },
      { id: '20101', name: '박하나', role: 'student' },
      { id: '12', name: '짧음', role: 'student' },
      { id: '10001', name: '0반', role: 'student' },
      { id: 'T001', name: '박교사', role: 'teacher' },
      { id: 'A001', name: '최관리', role: 'admin' },
      { id: '임의수', name: '임의수', role: 'teacher' }
    ],
    official_survey_responses: [
      { survey_id: S.CURRICULUM, respondent_type: 'student', respondent_key: 'u:10301', grade: 1, answers: { leak: 'SECRET_ANSWER' } },
      { survey_id: S.CURRICULUM, respondent_type: 'student', respondent_key: 'u:10302', grade: 1, answers: { leak: 'SECRET_ANSWER' } },
      { survey_id: S.CURRICULUM, respondent_type: 'student', respondent_key: 'u:10599', grade: 1, answers: { leak: 'SECRET_ANSWER' } },
      { survey_id: S.CURRICULUM, respondent_type: 'parent', respondent_key: 'd:parent', grade: 1, answers: { leak: 'SECRET_ANSWER' } },
      { survey_id: S.CURRICULUM, respondent_type: 'teacher', respondent_key: 'u:T001', grade: null, answers: { leak: 'SECRET_ANSWER' } },
      { survey_id: S.BUDGET, respondent_type: 'student', respondent_key: 'u:10401', grade: 1, answers: { leak: 'SECRET_ANSWER' } }
    ],
    sdq_responses: [
      { wave: '2026-1', student_id: '10301', student_name: '김하나', grade: 1, class_no: 3, number: 1, answers: { leak: 'SECRET_ANSWER' }, scores: { total: 30 }, bands: { total: { label: '임상' } } },
      { wave: '2026-1', student_id: '20101', student_name: '박하나', grade: 2, class_no: 1, number: 1, answers: { leak: 'SECRET_ANSWER' } },
      { wave: '2025-2', student_id: '10302', student_name: '김둘', grade: 1, class_no: 3, number: 2, answers: { leak: 'SECRET_ANSWER' } },
      { wave: '2026-1', student_id: '10599', student_name: '없는학생', grade: 1, class_no: 5, number: 99, answers: { leak: 'SECRET_ANSWER' } }
    ]
  });
}

(async () => {
  assert.strictEqual(P.parseEnrolled({ id: '10301', name: '김하나', role: 'Student' }).classNo, 3);
  assert.strictEqual(P.parseEnrolled({ id: '10304', name: '전출', role: 'withdrawn' }), null);
  assert.strictEqual(P.parseEnrolled({ id: '12', name: '짧음', role: 'student' }), null);
  assert.strictEqual(P.parseEnrolled({ id: '10001', name: '0반', role: 'student' }), null);
  assert.strictEqual(P.parseEnrolled({ id: 'T001', name: '박교사', role: 'teacher' }), null);
  assert.strictEqual(P.LOW_RATE, 70);

  const store = db();
  const denied = await S.handleAction(store, { action: 'participation', userId: '10301' });
  assert.strictEqual(denied.body.success, false);
  assert.strictEqual(denied.body.report, undefined);
  assert.ok(!JSON.stringify(denied.body).includes('김셋'));
  assert.ok(!JSON.stringify(denied.body).includes('SECRET_ANSWER'));

  const teacher = await S.handleAction(store, { action: 'participation', userId: 'T001', allowed: true, name: '임의수' });
  assert.strictEqual(teacher.body.success, true, teacher.body.msg);
  const report = teacher.body.report;
  assert.strictEqual(report.surveys.length, 2);
  const curriculum = report.surveys[0];
  const sdq = report.surveys[1];
  assert.strictEqual(curriculum.id, S.CURRICULUM);
  assert.strictEqual(sdq.id, 'sdq_kr');
  assert.strictEqual(sdq.wave, '2026-1');

  const c13 = curriculum.grades.find(g => g.grade === 1).classes.find(c => c.classNo === 3);
  assert.strictEqual(c13.responded, 2);
  assert.strictEqual(c13.enrolled, 3);
  assert.strictEqual(c13.rate, 66.7);
  assert.strictEqual(c13.low, true);
  assert.deepStrictEqual(c13.missing, [{ number: 3, name: '김셋' }]);
  const c14 = curriculum.grades.find(g => g.grade === 1).classes.find(c => c.classNo === 4);
  assert.strictEqual(c14.responded, 0);
  assert.strictEqual(c14.enrolled, 1);
  assert.deepStrictEqual(c14.missing, [{ number: 1, name: '이하나' }]);
  assert.strictEqual(curriculum.grades.find(g => g.grade === 1).responded, 2);
  assert.strictEqual(curriculum.grades.find(g => g.grade === 1).enrolled, 4);
  assert.strictEqual(curriculum.grades.find(g => g.grade === 2).responded, 0);
  assert.strictEqual(curriculum.responded, 2);
  assert.strictEqual(curriculum.enrolled, 5);
  assert.strictEqual(curriculum.low, true);
  assert.ok(!curriculum.grades.some(g => g.classes.some(c => c.classNo === 5)));
  assert.ok(!curriculum.grades.some(g => g.classes.some(c => c.classNo === 0)));

  const s13 = sdq.grades.find(g => g.grade === 1).classes.find(c => c.classNo === 3);
  assert.strictEqual(s13.responded, 1);
  assert.strictEqual(s13.enrolled, 3);
  assert.strictEqual(s13.rate, 33.3);
  assert.deepStrictEqual(s13.missing, [{ number: 2, name: '김둘' }, { number: 3, name: '김셋' }]);
  const s21 = sdq.grades.find(g => g.grade === 2).classes.find(c => c.classNo === 1);
  assert.strictEqual(s21.responded, 1);
  assert.strictEqual(s21.enrolled, 1);
  assert.strictEqual(s21.rate, 100);
  assert.strictEqual(s21.low, false);
  assert.deepStrictEqual(s21.missing, []);
  assert.strictEqual(sdq.responded, 2);
  assert.strictEqual(sdq.enrolled, 5);

  const blob = JSON.stringify(teacher.body);
  assert.ok(!blob.includes('SECRET_ANSWER'));
  assert.ok(!blob.includes('answers'));
  assert.ok(!blob.includes('scores'));
  assert.ok(!blob.includes('bands'));
  assert.ok(!blob.includes('임상'));
  assert.ok(!blob.includes('10301'));
  assert.ok(!blob.includes('u:10301'));
  assert.ok(blob.includes('김셋'));
  assert.ok(!blob.includes('김하나'));
  assert.ok(!blob.includes('전출'));

  const admin = await S.handleAction(store, { action: 'participation', userId: 'A001' });
  assert.strictEqual(admin.body.success, true, admin.body.msg);
  const reader = await S.handleAction(store, { action: 'participation', userId: '임의수' });
  assert.strictEqual(reader.body.success, true);
  assert.strictEqual(reader.body.report.surveys[1].responded, 2);

  const sdqDenied = await SDQ.handleAction(store, { action: 'results', userId: 'T001' });
  assert.strictEqual(sdqDenied.body.success, false);
  assert.strictEqual(sdqDenied.body.view, undefined);
  assert.ok(!JSON.stringify(sdqDenied.body).includes('SECRET_ANSWER'));
  assert.ok(!JSON.stringify(sdqDenied.body).includes('김셋'));

  const html = OfficialSurvey.renderParticipation(report);
  assert.ok(html.includes('참여 현황 · 2026학년도 교육과정 만족도 조사'));
  assert.ok(html.includes('참여 현황 · SDQ 정신건강 설문'));
  assert.ok(html.includes('소계'));
  assert.ok(html.includes('학교 전체'));
  assert.ok(html.includes('os-part-low'));
  assert.ok(html.includes('3번 김셋'));
  assert.ok(html.includes('2번 김둘'));
  assert.ok(html.includes('모두 응답했습니다'));
  assert.ok(html.includes('70%'));
  assert.ok(!html.includes('SECRET_ANSWER'));
  assert.ok(!html.includes('임상'));
  assert.ok(!html.includes('10301'));
  assert.ok(html.includes('data-part-key="curriculum_sat_2026-1-3"'));
  assert.ok(html.includes('data-part-panel="sdq_kr-2-1"'));

  console.log('participation tests ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
