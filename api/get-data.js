const { getSupabase, cors, formatDate } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { role, userId } = req.body;
  const supabase = getSupabase();

  const result = {
    rewards: [], students: [], items: [], history: [],
    myPoints: 0, myUmbrella: '', myBall: '', myMbti: '', lunchMenu: '로딩 중...',
    surveyList: [], reportList: [], pendingPraises: [], approvedPraises: [], receivedPraises: [],
    unreturnedUmbrella: [], unreturnedBall: [],
    teacherHistory: [], myClubs: [], clubLogs: [], leaderboard: { '1': [], '2': [], '3': [] },
    quizList: []
  };

  try {
    // Users
    const { data: allUsers } = await supabase.from('users').select('*');
    if (!allUsers) { result.error = 'Users 테이블 없음'; return res.json(result); }

    let myName = '';
    for (const u of allUsers) {
      if (String(u.id).trim() === String(userId)) {
        myName = u.name;
        if (role !== 'teacher' && role !== 'admin') {
          result.myPoints = Number(u.points) || 0;
          result.myUmbrella = u.umbrella || '';
          result.myBall = u.ball || '';
          result.myMbti = u.mbti || '';
        }
        break;
      }
    }

    // Rewards
    const { data: rewards } = await supabase.from('rewards').select('*').eq('active', 'O');
    result.rewards = (rewards || []).map(r => ({ name: r.name, price: Number(r.price) }));

    // All students
    const allStudentsData = allUsers
      .filter(u => String(u.role).toLowerCase().trim() === 'student')
      .map(u => ({
        id: String(u.id).trim(), name: u.name,
        points: Number(u.points) || 0,
        umbrella: u.umbrella || '', ball: u.ball || '', mbti: u.mbti || ''
      }));
    result.students = allStudentsData;

    if (role === 'teacher' || role === 'admin') {
      // Items
      const { data: items } = await supabase.from('items').select('*').eq('active', 'O');
      result.items = (items || []).map(i => ({ name: i.name, points: Number(i.points) }));

      // Unreturned
      result.unreturnedUmbrella = result.students.filter(u => u.umbrella === '대여중').map(u => ({ id: u.id, name: u.name }));
      result.unreturnedBall = result.students.filter(u => u.ball === '대여중').map(u => ({ id: u.id, name: u.name }));

      // Clubs
      const { data: clubs } = await supabase.from('clubs').select('*').eq('teacher_id', String(userId));
      const myClubIds = [];
      for (const c of (clubs || [])) {
        myClubIds.push(c.id);
        const mems = Array.isArray(c.members) ? c.members : [];
        const memObjs = mems.map(mid => {
          const tid = (typeof mid === 'object' && mid.id) ? mid.id : String(mid);
          const u = allUsers.find(x => String(x.id) === tid);
          return u ? { id: tid, name: u.name } : { id: tid, name: '미등록' };
        }).filter(Boolean);
        result.myClubs.push({ id: c.id, name: c.name, members: memObjs });
      }

      // Club Logs
      if (myClubIds.length > 0) {
        const { data: clData } = await supabase
          .from('club_logs').select('*')
          .in('club_id', myClubIds)
          .order('id', { ascending: false })
          .limit(50);
        result.clubLogs = (clData || []).map(l => ({
          rowIndex: l.id, date: l.date, clubId: l.club_id, data: JSON.stringify(l.data)
        }));
      }

      // Reports
      const { data: reports } = await supabase
        .from('reports').select('*')
        .order('id', { ascending: false })
        .limit(30);
      result.reportList = (reports || []).map(r => ({
        date: formatDate(r.date), reporterName: r.reporter_name, content: r.content, fileLink: r.file_link || ''
      }));

      // Teacher Logs
      const { data: tLogs } = await supabase
        .from('logs').select('*')
        .eq('teacher', myName)
        .order('id', { ascending: false })
        .limit(50);
      result.teacherHistory = (tLogs || []).map(l => ({
        rowIndex: l.id, date: formatDate(l.date), target: l.student_id, item: l.item, point: Number(l.point)
      }));

      // Praises
      const { data: praises } = await supabase.from('praises').select('*');
      for (const p of (praises || [])) {
        const pObj = { id: p.id, date: formatDate(p.date), senderName: p.sender_name, receiverName: p.receiver_name, content: p.content };
        if (p.status === 'Pending') result.pendingPraises.push(pObj);
        else if (p.status === 'Approved') result.approvedPraises.push(pObj);
      }
      result.pendingPraises.reverse();
      result.approvedPraises.reverse();

    } else {
      // Student: leaderboard
      const rankMap = { '1': [], '2': [], '3': [] };
      result.students.forEach(u => {
        const gr = String(u.id).substring(0, 1);
        if (rankMap[gr]) rankMap[gr].push({ name: u.name, points: u.points });
      });
      for (const g in rankMap) {
        rankMap[g].sort((a, b) => b.points - a.points);
        result.leaderboard[g] = rankMap[g].slice(0, 10);
      }

      // Student history
      const { data: sLogs } = await supabase
        .from('logs').select('*')
        .eq('student_id', String(userId))
        .order('id', { ascending: false })
        .limit(30);
      result.history = (sLogs || []).map(l => ({
        date: formatDate(l.date), item: l.item, point: Number(l.point)
      }));

      // Received praises
      const { data: rPraises } = await supabase
        .from('praises').select('*')
        .eq('receiver_id', String(userId))
        .eq('status', 'Approved');
      result.receivedPraises = (rPraises || []).map(p => ({
        date: formatDate(p.date), senderName: p.sender_name, content: p.content
      }));
      result.receivedPraises.reverse();
    }

    // Surveys
    const { data: surveys } = await supabase.from('surveys').select('*').eq('status', 'O');
    const { data: surveyLogs } = await supabase.from('survey_logs').select('*');

    for (const s of (surveys || [])) {
      let myVoted = false;
      if (role !== 'teacher') {
        myVoted = (surveyLogs || []).some(sl => String(sl.vote_id) === String(s.id) && String(sl.student_id) === String(userId));
      }
      const sv = { id: s.id, title: s.title, questions: s.questions, voted: myVoted, allowPhoto: !!s.allow_photo };
      if (role === 'teacher' || role === 'admin') {
        sv.stats = getSurveyStats(s.id, s.questions, surveyLogs || [], !!s.allow_photo);
      }
      result.surveyList.push(sv);
    }
    result.surveyList.reverse();

    // Quizzes
    const { data: quizzes } = await supabase.from('quizzes').select('*').eq('status', 'O');
    const { data: quizLogs } = await supabase.from('quiz_logs').select('*');

    for (const q of (quizzes || [])) {
      let mySolved = false;
      if (role !== 'teacher') {
        mySolved = (quizLogs || []).some(ql =>
          String(ql.quiz_id) === String(q.id) && String(ql.student_id) === String(userId) && ql.status === 'Rewarded'
        );
      }
      let qc = q.questions;
      if (role !== 'teacher') {
        qc = qc.map(x => ({ type: x.type, q: x.q, opts: x.opts, hint: x.hint || '' }));
      }
      result.quizList.push({ id: q.id, teacherName: q.teacher, title: q.title, questions: qc, isSolved: mySolved });
    }
    result.quizList.reverse();

    // Lunch
    try { result.lunchMenu = await getNeisLunch(); } catch (e) { result.lunchMenu = '정보 없음'; }

  } catch (e) {
    console.error(e);
    result.error = e.message;
  }

  return res.json(result);
};

function getSurveyStats(vid, qs, logs, allowPhoto) {
  if (!logs) return '-';
  const st = qs.map(q => (q.type === 'text' ? [] : {}));
  const photos = [];
  let count = 0;
  for (const log of logs) {
    if (String(log.vote_id) === String(vid)) {
      count++;
      try {
        const a = typeof log.answer === 'string' ? JSON.parse(log.answer) : log.answer;
        a.forEach((v, x) => {
          if (qs[x] && qs[x].type === 'text') st[x].unshift(v);
          else if (st[x]) st[x][v] = (st[x][v] || 0) + 1;
        });
      } catch (e) { }
      if (log.photo_url) photos.unshift({ url: log.photo_url, sid: log.student_id });
    }
  }
  let h = `<div style='max-height:500px;overflow-y:auto;padding-right:6px;'>`;
  h += `<span class='badge bg-primary'>참여: ${count}</span>`;
  qs.forEach((q, x) => {
    h += `<div class='mb-3 pb-2 border-bottom'><strong>Q${x + 1}. ${q.q}</strong><br>`;
    if (q.type === 'text') {
      h += `<div class='bg-light p-2 small' style='max-height:220px;overflow:auto'>${st[x].join('<br>') || '(응답 없음)'}</div>`;
    } else {
      // 등록된 보기 순서대로, 응답 없는 항목은 0으로 표시
      const opts = q.opts || [];
      opts.forEach(opt => {
        const cnt = st[x][opt] || 0;
        const pct = count > 0 ? Math.round(cnt / count * 100) : 0;
        h += `<div class='d-flex align-items-center my-1 small'>
          <span style='width:120px;flex-shrink:0'>- ${opt}</span>
          <div class='flex-grow-1 bg-light rounded mx-2' style='height:14px;'>
            <div class='bg-primary rounded' style='height:14px;width:${pct}%;'></div>
          </div>
          <span class='fw-bold' style='width:40px;text-align:right'>${cnt}명</span>
        </div>`;
      });
      // opts에 없는 응답(이전 버전의 텍스트 입력 잔존)은 표시 안함
    }
    h += '</div>';
  });
  if (allowPhoto) {
    h += `<div class='mt-3 pt-2 border-top'><strong>📷 업로드된 사진 (${photos.length})</strong>`;
    if (photos.length === 0) {
      h += `<div class='text-muted small mt-1'>업로드된 사진이 없습니다.</div>`;
    } else {
      h += `<div class='d-flex flex-wrap gap-2 mt-2'>`;
      photos.forEach(p => {
        h += `<a href='${p.url}' target='_blank' title='학번 ${p.sid}'>
          <img src='${p.url}' style='width:100px;height:100px;object-fit:cover;border:1px solid #ddd;border-radius:6px;'>
          <div class='text-center small text-muted'>${p.sid}</div>
        </a>`;
      });
      h += `</div>`;
    }
    h += `</div>`;
  }
  h += `</div>`;
  return h;
}

async function getNeisLunch() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const d = kst.toISOString().slice(0, 10).replace(/-/g, '');
  const code = process.env.ATPT_OFCDC_SC_CODE || 'T10';
  const school = process.env.SD_SCHUL_CODE || '7441062';
  const key = process.env.NEIS_API_KEY || '';
  const url = `https://open.neis.go.kr/hub/mealServiceDietInfo?Type=json&pIndex=1&pSize=10&ATPT_OFCDC_SC_CODE=${code}&SD_SCHUL_CODE=${school}&MLSV_YMD=${d}${key ? '&KEY=' + key : ''}`;
  const resp = await fetch(url);
  const json = await resp.json();
  if (json.mealServiceDietInfo) {
    return json.mealServiceDietInfo[1].row[0].DDISH_NM
      .replace(/<br\/>/g, ', ')
      .replace(/[0-9.]/g, '')
      .replace(/\(\)/g, '');
  }
  return '급식 없음';
}
