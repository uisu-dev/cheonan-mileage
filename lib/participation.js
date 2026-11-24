// 학년·반 참여 현황. 재적 학생은 users.role = student 이고 학번 5자리인 계정만 센다.
// 학년·반·번호는 학번에서 읽는다(1학년 2자리 반 2자리 번호). 응답 여부와 미응답 이름만 만들고
// 문항 답, 점수, 위험 수준은 넣지 않는다.

const LOW_RATE = 70;

function pct(count, total) {
  if (!total) return 0;
  return Math.round(count / total * 1000) / 10;
}

function parseEnrolled(user) {
  if (!user) return null;
  const role = String(user.role || '').toLowerCase().trim();
  if (role !== 'student') return null;
  const id = String(user.id || '').trim();
  if (!/^\d{5}$/.test(id)) return null;
  const grade = Number(id.slice(0, 1));
  const classNo = Number(id.slice(1, 3));
  const number = Number(id.slice(3, 5));
  if (grade < 1 || grade > 3) return null;
  if (classNo < 1 || classNo > 30) return null;
  if (number < 1 || number > 99) return null;
  const name = String(user.name || '').replace(/\u0000/g, '').trim();
  if (!name) return null;
  return { id, name, grade, classNo, number };
}

function buildSurveyParticipation(enrolled, respondedIds) {
  const responded = new Set((respondedIds || []).map(id => String(id || '').trim()).filter(Boolean));
  const byGrade = new Map();
  (enrolled || []).forEach(stu => {
    if (!byGrade.has(stu.grade)) byGrade.set(stu.grade, new Map());
    const classes = byGrade.get(stu.grade);
    if (!classes.has(stu.classNo)) classes.set(stu.classNo, []);
    classes.get(stu.classNo).push(stu);
  });
  const grades = [];
  let schoolResponded = 0;
  let schoolEnrolled = 0;
  Array.from(byGrade.keys()).sort((a, b) => a - b).forEach(grade => {
    let gradeResponded = 0;
    let gradeEnrolled = 0;
    const classes = Array.from(byGrade.get(grade).keys()).sort((a, b) => a - b).map(classNo => {
      const students = byGrade.get(grade).get(classNo).slice().sort((a, b) => {
        if (a.number !== b.number) return a.number - b.number;
        return a.name.localeCompare(b.name, 'ko');
      });
      const hit = students.filter(stu => responded.has(stu.id)).length;
      const missing = students.filter(stu => !responded.has(stu.id)).map(stu => ({
        number: stu.number,
        name: stu.name
      }));
      gradeResponded += hit;
      gradeEnrolled += students.length;
      const rate = pct(hit, students.length);
      return {
        classNo,
        responded: hit,
        enrolled: students.length,
        rate,
        low: students.length > 0 && rate < LOW_RATE,
        missing
      };
    });
    const rate = pct(gradeResponded, gradeEnrolled);
    schoolResponded += gradeResponded;
    schoolEnrolled += gradeEnrolled;
    grades.push({
      grade,
      responded: gradeResponded,
      enrolled: gradeEnrolled,
      rate,
      low: gradeEnrolled > 0 && rate < LOW_RATE,
      classes
    });
  });
  const rate = pct(schoolResponded, schoolEnrolled);
  return {
    responded: schoolResponded,
    enrolled: schoolEnrolled,
    rate,
    low: schoolEnrolled > 0 && rate < LOW_RATE,
    lowRate: LOW_RATE,
    grades
  };
}

module.exports = {
  LOW_RATE,
  parseEnrolled,
  buildSurveyParticipation
};
