// SDQ-Kr 검증 (실DB 미사용)
// 실행: node test/sdq.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeDb } = require('./_mockdb');
const S = require('../lib/sdq');

global.window = global;
global.document = { addEventListener() {} };
require('../public/official-survey.js');

function db(extraUsers) {
  return makeDb({
    users: [
      { id: '10327', name: '홍길동', role: 'student', points: 10 },
      { id: '20101', name: '김학생', role: 'student', points: 3 },
      { id: '30105', name: '박학생', role: 'student', points: 1 },
      { id: '12', name: '짧음', role: 'student', points: 0 },
      { id: 'T001', name: '박교사', role: 'teacher', points: 0 },
      { id: 'A001', name: '최관리', role: 'admin', points: 0 },
      { id: '임의수', name: '임의수', role: 'teacher', points: 0 },
      { id: '안지윤', name: '안지윤', role: 'teacher', points: 0 }
    ].concat(extraUsers || []),
    sdq_responses: [],
    survey_logs: []
  }, { unique: { sdq_responses: [['wave', 'student_id']] } });
}

function answers(value) {
  const out = {};
  for (let n = 1; n <= 25; n++) out[String(n)] = value;
  return out;
}

function borderlineAnswers() {
  const out = answers(1);
  out['3'] = 0;
  return out;
}

(async () => {
  assert.strictEqual(S.ITEMS.length, 25);
  assert.deepStrictEqual(S.OPTIONS.map(o => o.value), [0, 1, 2]);
  assert.deepStrictEqual(S.OPTIONS.map(o => o.label), ['전혀 아니다', '다소 그렇다', '확실히 그렇다']);
  assert.deepStrictEqual(Array.from(S.REVERSE).sort((a, b) => a - b), [7, 11, 14, 21, 25]);
  assert.strictEqual(S.CURRENT_WAVE, '2026-1');

  const all2 = S.scoreAnswers(answers(2));
  assert.deepStrictEqual(all2.scores, {
    emotional: 10, conduct: 8, hyperactivity: 6, peer: 6, prosocial: 10, total: 30
  });
  assert.strictEqual(all2.bands.total.label, '임상');
  assert.strictEqual(all2.bands.hyperactivity.label, '경계');
  assert.strictEqual(all2.bands.prosocial.label, '정상');

  const all0 = S.scoreAnswers(answers(0));
  assert.deepStrictEqual(all0.scores, {
    emotional: 0, conduct: 2, hyperactivity: 4, peer: 4, prosocial: 0, total: 10
  });
  assert.strictEqual(all0.bands.total.label, '정상');
  assert.strictEqual(all0.bands.peer.label, '경계');
  assert.strictEqual(all0.bands.prosocial.label, '임상');
  assert.strictEqual(S.scoreAnswers(answers(1)).scores.total, 20);
  assert.strictEqual(S.scoreAnswers(borderlineAnswers()).scores.total, 19);
  assert.strictEqual(S.scoreAnswers(borderlineAnswers()).bands.total.label, '경계');

  assert.strictEqual(S.itemScore(7, 0), 2);
  assert.strictEqual(S.itemScore(7, 2), 0);
  assert.strictEqual(S.itemScore(7, 1), 1);
  assert.strictEqual(S.itemScore(3, 0), 0);
  assert.strictEqual(S.itemScore(3, '2'), 2);
  assert.strictEqual(S.itemScore(1, 3), null);

  assert.strictEqual(S.bandFor('total', 15).label, '정상');
  assert.strictEqual(S.bandFor('total', 16).label, '경계');
  assert.strictEqual(S.bandFor('total', 19).label, '경계');
  assert.strictEqual(S.bandFor('total', 20).label, '임상');
  assert.strictEqual(S.bandFor('emotional', 5).label, '정상');
  assert.strictEqual(S.bandFor('emotional', 6).label, '경계');
  assert.strictEqual(S.bandFor('emotional', 7).label, '임상');
  assert.strictEqual(S.bandFor('conduct', 3).label, '정상');
  assert.strictEqual(S.bandFor('conduct', 4).label, '경계');
  assert.strictEqual(S.bandFor('conduct', 5).label, '임상');
  assert.strictEqual(S.bandFor('hyperactivity', 5).label, '정상');
  assert.strictEqual(S.bandFor('hyperactivity', 6).label, '경계');
  assert.strictEqual(S.bandFor('hyperactivity', 7).label, '임상');
  assert.strictEqual(S.bandFor('peer', 3).label, '정상');
  assert.strictEqual(S.bandFor('peer', 4).label, '경계');
  assert.strictEqual(S.bandFor('peer', 5).label, '경계');
  assert.strictEqual(S.bandFor('peer', 6).label, '임상');
  assert.strictEqual(S.bandFor('prosocial', 6).label, '정상');
  assert.strictEqual(S.bandFor('prosocial', 10).label, '정상');
  assert.strictEqual(S.bandFor('prosocial', 5).label, '경계');
  assert.strictEqual(S.bandFor('prosocial', 4).label, '임상');
  assert.strictEqual(S.bandFor('prosocial', 0).label, '임상');
  assert.strictEqual(S.scoreAnswers({}), null);
  assert.strictEqual(S.validateAnswers(answers(4)).ok, false);

  const store = db();
  const base = { now: Date.parse('2026-11-23T00:00:00Z') };

  let res = await S.handleAction(store, {
    action: 'submit', userId: '10327', wave: '1999-1',
    studentName: '가짜이름', grade: 3, classNo: 9, number: 9,
    answers: answers(2)
  }, base);
  assert.strictEqual(res.body.success, true, res.body.msg);
  assert.strictEqual(res.body.updated, false);
  assert.ok(!res.body.msg.includes('마일리지'));
  assert.strictEqual(store.tables.users.find(u => u.id === '10327').points, 10);
  assert.strictEqual(store.tables.survey_logs.length, 0);
  assert.strictEqual(store.tables.sdq_responses.length, 1);
  const row = store.tables.sdq_responses[0];
  assert.strictEqual(row.wave, '2026-1');
  assert.strictEqual(row.student_id, '10327');
  assert.strictEqual(row.student_name, '홍길동');
  assert.strictEqual(row.grade, 1);
  assert.strictEqual(row.class_no, 3);
  assert.strictEqual(row.number, 27);
  assert.strictEqual(row.answers['1'], 2);
  assert.strictEqual(row.answers.name, undefined);
  assert.strictEqual(row.created_at, new Date(base.now).toISOString());

  res = await S.handleAction(store, {
    action: 'submit', userId: '10327', answers: answers(2), studentName: '다른사람'
  }, { now: base.now + 5000 });
  assert.strictEqual(res.body.updated, true);
  assert.strictEqual(res.body.msg, '수정했습니다.');
  assert.strictEqual(store.tables.sdq_responses.length, 1);
  assert.strictEqual(store.tables.sdq_responses[0].created_at, new Date(base.now).toISOString());
  assert.strictEqual(store.tables.sdq_responses[0].student_name, '홍길동');

  res = await S.handleAction(store, { action: 'submit', userId: '20101', answers: borderlineAnswers() }, base);
  assert.strictEqual(res.body.success, true, res.body.msg);
  res = await S.handleAction(store, { action: 'submit', userId: '30105', answers: answers(0) }, base);
  assert.strictEqual(res.body.success, true, res.body.msg);
  store.tables.sdq_responses.push({
    id: 99, wave: '2025-2', student_id: '20101', student_name: '김학생',
    grade: 2, class_no: 1, number: 1, answers: answers(1),
    created_at: new Date(base.now).toISOString(), updated_at: new Date(base.now).toISOString()
  });

  res = await S.handleAction(store, { action: 'submit', userId: 'T001', answers: answers(0) }, base);
  assert.strictEqual(res.body.success, false);
  assert.ok(res.body.msg.includes('학생'));
  res = await S.handleAction(store, { action: 'submit', userId: '12', answers: answers(0) }, base);
  assert.strictEqual(res.body.success, false);
  res = await S.handleAction(store, { action: 'submit', userId: '10327', answers: Object.assign(answers(1), { '25': '' }) }, base);
  assert.strictEqual(res.body.success, false);

  const statusStudent = await S.handleAction(store, { action: 'status', userId: '10327' }, base);
  assert.strictEqual(statusStudent.body.submitted, true);
  assert.strictEqual(statusStudent.body.allowed, false);
  assert.strictEqual(statusStudent.body.wave, '2026-1');

  const statusOther = await S.handleAction(store, { action: 'status', userId: 'T001', name: '임의수', allowed: true }, base);
  assert.strictEqual(statusOther.body.success, true);
  assert.strictEqual(statusOther.body.allowed, false);
  assert.ok(!JSON.stringify(statusOther.body).includes('홍길동'));
  assert.ok(!JSON.stringify(statusOther.body).includes('10327'));
  const statusAdmin = await S.handleAction(store, { action: 'status', userId: 'A001' }, base);
  assert.strictEqual(statusAdmin.body.allowed, false);
  const statusLee = await S.handleAction(store, { action: 'status', userId: '임의수' }, base);
  assert.strictEqual(statusLee.body.allowed, true);
  const statusAhn = await S.handleAction(store, { action: 'status', userId: '안지윤' }, base);
  assert.strictEqual(statusAhn.body.allowed, true);

  const denied = await S.handleAction(store, { action: 'results', userId: 'T001', wave: '2026-1', allowed: true, name: '안지윤' }, base);
  assert.strictEqual(denied.body.success, false);
  assert.ok(!JSON.stringify(denied.body).includes('홍길동'));
  assert.ok(!JSON.stringify(denied.body).includes('임의수'));
  assert.strictEqual(denied.body.view, undefined);
  const deniedStudent = await S.handleAction(store, { action: 'results', userId: '10327' }, base);
  assert.strictEqual(deniedStudent.body.success, false);
  const deniedExport = await S.handleAction(store, { action: 'export', userId: 'A001' }, base);
  assert.strictEqual(deniedExport.body.success, false);
  assert.strictEqual(deniedExport.body.sheets, undefined);

  const view = (await S.handleAction(store, { action: 'results', userId: '안지윤', wave: '2026-1' }, base)).body;
  assert.strictEqual(view.success, true, view.msg);
  assert.strictEqual(view.view.students.map(s => s.studentId).join(','), '10327,20101,30105');
  assert.strictEqual(view.view.students[0].bands.total.label, '임상');
  assert.strictEqual(view.view.students[0].scores.total, 30);
  assert.strictEqual(view.view.students[1].bands.total.label, '경계');
  assert.strictEqual(view.view.students[1].scores.total, 19);
  assert.strictEqual(view.view.students[2].bands.total.label, '정상');
  assert.strictEqual(view.view.students[0].name, '홍길동');
  assert.strictEqual(view.view.students[0].grade, 1);
  assert.strictEqual(view.view.students[0].classNo, 3);
  assert.strictEqual(view.view.students[0].number, 27);
  assert.strictEqual(view.view.students[0].answers, undefined);
  assert.strictEqual(view.view.stats.all.count, 3);
  assert.strictEqual(view.view.stats.all.bands.임상, 1);
  assert.strictEqual(view.view.stats.all.bands.경계, 1);
  assert.strictEqual(view.view.stats.all.bands.정상, 1);
  assert.strictEqual(view.view.stats.byGrade.find(g => g.grade === 1).bands.임상, 1);
  assert.strictEqual(view.view.stats.byGrade.find(g => g.grade === 2).count, 1);
  assert.ok(!JSON.stringify(view.view.students).includes('"1":'));

  const grade2 = (await S.handleAction(store, {
    action: 'results', userId: '임의수', grade: '2', classNo: '1'
  }, base)).body.view;
  assert.strictEqual(grade2.students.length, 1);
  assert.strictEqual(grade2.students[0].studentId, '20101');
  assert.strictEqual(grade2.stats.all.count, 3);
  assert.deepStrictEqual(grade2.classes, [1]);

  const oldWave = (await S.handleAction(store, { action: 'results', userId: '임의수', wave: '2025-2' }, base)).body.view;
  assert.strictEqual(oldWave.students.length, 1);
  assert.strictEqual(oldWave.students[0].scores.total, 20);
  const badWave = await S.handleAction(store, { action: 'results', userId: '임의수', wave: '2026-0' }, base);
  assert.strictEqual(badWave.body.success, false);

  const adminStaff = db([{ id: '임시관리', name: '임시관리', role: 'admin' }]);
  const promoted = db();
  promoted.tables.users.find(u => u.id === '임의수').role = 'admin';
  const still = await S.handleAction(promoted, { action: 'results', userId: '임의수' }, base);
  assert.strictEqual(still.body.success, true, still.body.msg);
  assert.strictEqual((await S.handleAction(adminStaff, { action: 'results', userId: '임시관리' }, base)).body.success, false);

  const exported = await S.handleAction(store, { action: 'export', userId: '임의수' }, base);
  assert.strictEqual(exported.body.success, true, exported.body.msg);
  assert.ok(exported.body.filename.startsWith('천중_SDQ_2026-1_'));
  const names = exported.body.sheets.map(s => s.name);
  assert.ok(names.includes('안내'));
  assert.ok(names.includes('통계'));
  assert.ok(names.includes('학생_2026-1'));
  assert.ok(names.includes('학생_2025-2'));
  const studentSheet = exported.body.sheets.find(s => s.name === '학생_2026-1');
  const blob = JSON.stringify(studentSheet.rows);
  assert.ok(blob.includes('홍길동'));
  assert.ok(blob.includes('10327'));
  assert.ok(blob.includes(S.ITEMS[0]));
  assert.ok(blob.includes('임상'));
  assert.strictEqual(studentSheet.rows[1][2], '10327');
  assert.strictEqual(studentSheet.rows[1][17], 30);
  assert.strictEqual(studentSheet.rows[1][18], '임상');
  const info = JSON.stringify(exported.body.sheets[0].rows);
  assert.ok(info.includes('0–15') || info.includes('0-15'));
  assert.ok(info.includes('친사회'));

  const form = await S.handleAction(store, { action: 'form', userId: '10327', respondent: 'teacher', name: '가짜' }, base);
  assert.strictEqual(form.body.success, true, form.body.msg);
  assert.strictEqual(form.body.form.kind, 'sdq');
  assert.strictEqual(form.body.form.identity.name, '홍길동');
  assert.strictEqual(form.body.form.identity.grade, 1);
  assert.strictEqual(form.body.form.identity.classNo, 3);
  assert.strictEqual(form.body.submitted, true);
  assert.strictEqual(form.body.existing.answers['1'], 2);
  const html = OfficialSurvey.renderSdq(form.body.form, form.body.existing);
  S.ITEMS.forEach(text => assert.ok(html.includes(text), text));
  assert.ok(html.includes('전혀 아니다'));
  assert.ok(html.includes('다소 그렇다'));
  assert.ok(html.includes('확실히 그렇다'));
  assert.ok(html.includes('홍길동'));
  assert.ok(html.includes('10327'));
  assert.ok(html.includes('회차 2026-1'));
  assert.ok(html.includes('마감일은 없습니다'));
  assert.ok(!html.includes('마일리지'));
  assert.ok(!html.includes('2024'));
  assert.ok(!html.includes('제출마감'));
  const resultHtml = OfficialSurvey.renderSdqResults(view.view);
  assert.ok(resultHtml.includes('홍길동'));
  assert.ok(resultHtml.includes('임상'));
  assert.ok(resultHtml.includes('경계'));
  assert.ok(resultHtml.includes('정상'));
  assert.ok(resultHtml.includes('os-sdq-table'));
  assert.ok(resultHtml.includes('os-sdq-card'));
  assert.ok(resultHtml.includes('1학년'));
  assert.ok(!resultHtml.includes('마일리지'));
  const missing = OfficialSurvey.problems('sdq', form.body.form, answers(1));
  assert.strictEqual(missing, '');
  const gap = OfficialSurvey.problems('sdq', form.body.form, Object.assign(answers(1), { '8': '' }));
  assert.ok(gap.includes('8번'));

  function fakeSelect(values) {
    const options = values.map(v => {
      const opt = {
        value: v,
        textContent: v,
        remove() {
          const i = options.indexOf(opt);
          if (i >= 0) options.splice(i, 1);
        }
      };
      return opt;
    });
    return {
      value: values[0] || '',
      options,
      querySelector(sel) {
        const m = /value="([^"]+)"/.exec(sel);
        if (!m) return null;
        return options.find(o => o.value === m[1]) || null;
      },
      appendChild(o) { options.push(o); },
      ownerDocument: {
        createElement() {
          const opt = { value: '', textContent: '' };
          opt.remove = function () {
            const i = options.indexOf(opt);
            if (i >= 0) options.splice(i, 1);
          };
          return opt;
        }
      }
    };
  }
  const select = fakeSelect(['curriculum_sat_2026', 'budget_participation_2027']);
  assert.strictEqual(OfficialSurvey.syncSurveySelect(select, true), true);
  assert.ok(select.options.some(o => o.value === 'sdq_kr' && o.textContent === 'SDQ 정신건강 설문'));
  select.value = 'sdq_kr';
  assert.strictEqual(OfficialSurvey.syncSurveySelect(select, false), false);
  assert.ok(!select.options.some(o => o.value === 'sdq_kr'));
  assert.strictEqual(select.value, 'curriculum_sat_2026');

  const indexPage = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const sql = fs.readFileSync(path.join(__dirname, '../sql/sdq_responses.sql'), 'utf8');
  assert.ok(indexPage.includes('data-official-survey="sdq_kr"'));
  assert.ok(indexPage.includes('SDQ 정신건강 설문'));
  assert.ok(!/<option[^>]*value="sdq_kr"/.test(indexPage));
  const bannerAt = indexPage.indexOf('id="officialResultsBanner"');
  const banner = indexPage.slice(bannerAt, bannerAt + 400);
  assert.ok(!banner.includes('SDQ'));
  assert.ok(indexPage.includes("surveyId === 'sdq_kr' ? '/sdq'"));
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('REVOKE ALL ON TABLE sdq_responses FROM anon, authenticated'));
  assert.ok(sql.includes('UNIQUE (wave, student_id)'));
  assert.ok(!sql.includes('CREATE POLICY'));

  const formDenied = await S.handleAction(store, { action: 'form', userId: '안지윤' }, base);
  assert.strictEqual(formDenied.body.success, false);

  console.log('sdq tests ok');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
