const { getSupabase, cors, formatDate } = require('../lib/supabase');
const { getNeisLunch, getNeisTimetable } = require('../lib/neis');

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
    const isTeacher = (role === 'teacher' || role === 'admin');
    const uid = String(userId);
    const sid = uid.trim();

    // ===== 서로 독립적인 조회를 동시에 실행 (순차 대기 waterfall 제거) =====
    const P = {};
    P.allUsers = supabase.from('users').select('id,name,role,points,umbrella,ball,mbti,penalty_total,penalty_earned');
    P.rewards = supabase.from('rewards').select('*').eq('active', 'O');
    P.lunch = getNeisLunch().catch(() => '정보 없음');

    { let q = supabase.from('surveys').select('*'); if (!isTeacher) q = q.eq('status', 'O'); P.surveys = q; }
    { let q = supabase.from('quizzes').select('*'); if (!isTeacher) q = q.eq('status', 'O'); P.quizzes = q; }
    { let q = supabase.from('announcements').select('*').order('id', { ascending: false }).limit(20); if (!isTeacher) q = q.eq('status', 'O'); P.notices = q; }

    if (isTeacher) {
      // 교사: 통계용으로 전체 로그 필요
      P.surveyLogs = supabase.from('survey_logs').select('*');
      P.quizLogs = supabase.from('quiz_logs').select('*');
      P.items = supabase.from('items').select('*').eq('active', 'O');
      P.clubs = supabase.from('clubs').select('*').eq('teacher_id', uid);
      P.reports = supabase.from('reports').select('*').order('id', { ascending: false }).limit(30);
      P.praises = supabase.from('praises').select('*');
      P.unread = supabase.from('teacher_messages').select('id', { count: 'exact', head: true }).eq('teacher_id', uid).eq('is_read', false);
    } else {
      // 학생: 본인 것만 조회하여 전송량 축소
      P.surveyLogs = supabase.from('survey_logs').select('vote_id,student_id').eq('student_id', uid);
      P.quizLogs = supabase.from('quiz_logs').select('quiz_id,student_id,status').eq('student_id', uid);
      P.myReports = supabase.from('reports').select('*').eq('reporter_id', uid).order('id', { ascending: false }).limit(30);
      P.history = supabase.from('logs').select('*').eq('student_id', uid).order('id', { ascending: false }).limit(30);
      P.recvPraises = supabase.from('praises').select('*').eq('receiver_id', uid).eq('status', 'Approved');
      if (/^\d{5}$/.test(sid)) {
        const grade = sid.substring(0, 1);
        const classNm = String(parseInt(sid.substring(1, 3), 10));
        P.timetable = getNeisTimetable(null, grade, classNm).catch(() => []);
      }
      // 돌림판: 내부 순차 호출을 하나의 비동기로 묶어 배치와 함께 동시 실행
      P.roulette = (async () => {
        try {
          const { data: rounds } = await supabase.from('roulette_rounds').select('*').order('id', { ascending: false }).limit(1);
          const round = rounds && rounds[0];
          if (!round) return { roundId: null, roundNo: 0, status: null, winnerWord: '', myPick: '' };
          const [{ data: mp }, { count }] = await Promise.all([
            supabase.from('roulette_picks').select('word').eq('round_id', round.id).eq('student_id', uid).limit(1),
            supabase.from('roulette_rounds').select('id', { count: 'exact', head: true })
          ]);
          return { roundId: round.id, roundNo: count || 0, status: round.status, winnerWord: round.winner_word || '', myPick: (mp && mp.length) ? mp[0].word : '' };
        } catch (e) {
          return { roundId: null, status: null, winnerWord: '', myPick: '' };
        }
      })();
    }

    // 전체 동시 대기
    const keys = Object.keys(P);
    const vals = await Promise.all(keys.map(k => Promise.resolve(P[k])));
    const R = {};
    keys.forEach((k, i) => { R[k] = vals[i]; });

    const allUsers = (R.allUsers && R.allUsers.data) || null;
    if (!allUsers) { result.error = 'Users 테이블 없음'; return res.json(result); }

    // 본인 정보 + myName
    let myName = '';
    for (const u of allUsers) {
      if (String(u.id).trim() === sid) {
        myName = u.name;
        if (!isTeacher) {
          result.myPoints = Number(u.points) || 0;
          result.myUmbrella = u.umbrella || '';
          result.myBall = u.ball || '';
          result.myMbti = u.mbti || '';
          result.myPenaltyTotal = Number(u.penalty_total) || 0;
          result.myPenaltyEarned = Number(u.penalty_earned) || 0;
        }
        break;
      }
    }

    // Rewards
    result.rewards = ((R.rewards && R.rewards.data) || []).map(r => ({ name: r.name, price: Number(r.price) }));

    // Students
    const allStudentsData = allUsers
      .filter(u => String(u.role).toLowerCase().trim() === 'student')
      .map(u => ({
        id: String(u.id).trim(), name: u.name,
        points: Number(u.points) || 0,
        umbrella: u.umbrella || '', ball: u.ball || '', mbti: u.mbti || '',
        penaltyTotal: Number(u.penalty_total) || 0,
        penaltyEarned: Number(u.penalty_earned) || 0
      }));
    result.students = allStudentsData;

    // Lunch
    result.lunchMenu = (typeof R.lunch === 'string') ? R.lunch : '정보 없음';

    const surveys = (R.surveys && R.surveys.data) || [];
    const surveyLogs = (R.surveyLogs && R.surveyLogs.data) || [];
    const quizzes = (R.quizzes && R.quizzes.data) || [];
    const quizLogs = (R.quizLogs && R.quizLogs.data) || [];

    if (!isTeacher) {
      // 교사 목록 (학생이 메시지 보낼 수 있도록)
      result.teachersList = allUsers
        .filter(u => { var r = String(u.role || '').toLowerCase().trim(); return r === 'teacher' || r === 'admin'; })
        .map(u => ({ id: String(u.id).trim(), name: u.name }))
        .sort((a, b) => a.name.localeCompare(b.name));

      // 내 제보 + 교사 답변
      result.myReportList = ((R.myReports && R.myReports.data) || []).map(r => ({
        date: formatDate(r.date), content: r.content, fileLink: r.file_link || '',
        reply: r.reply || '', replyTeacher: r.reply_teacher || '', replyDate: r.reply_date ? formatDate(r.reply_date) : ''
      }));

      // Leaderboard
      const rankMap = { '1': [], '2': [], '3': [] };
      allStudentsData.forEach(u => {
        const gr = String(u.id).substring(0, 1);
        if (rankMap[gr]) rankMap[gr].push({ name: u.name, points: u.points });
      });
      for (const g in rankMap) {
        rankMap[g].sort((a, b) => b.points - a.points);
        result.leaderboard[g] = rankMap[g].slice(0, 10);
      }

      // History
      result.history = ((R.history && R.history.data) || []).map(l => ({
        date: formatDate(l.date), item: l.item, point: Number(l.point)
      }));

      // Received praises
      result.receivedPraises = ((R.recvPraises && R.recvPraises.data) || []).map(p => ({
        date: formatDate(p.date), senderName: p.sender_name, content: p.content
      }));
      result.receivedPraises.reverse();

      // Timetable
      if (R.timetable) result.timetable = Array.isArray(R.timetable) ? R.timetable : [];

      // Roulette
      if (R.roulette) result.roulette = R.roulette;
    } else {
      // 교사 미확인 메시지 카운트
      result.unreadMessageCount = (R.unread && R.unread.count) || 0;

      // Items
      result.items = ((R.items && R.items.data) || []).map(i => ({ name: i.name, points: Number(i.points) }));

      // Unreturned
      result.unreturnedUmbrella = result.students.filter(u => u.umbrella === '대여중').map(u => ({ id: u.id, name: u.name }));
      result.unreturnedBall = result.students.filter(u => u.ball === '대여중').map(u => ({ id: u.id, name: u.name }));

      // Clubs
      const clubs = (R.clubs && R.clubs.data) || [];
      const myClubIds = [];
      for (const c of clubs) {
        myClubIds.push(c.id);
        const mems = Array.isArray(c.members) ? c.members : [];
        const memObjs = mems.map(mid => {
          const tid = (typeof mid === 'object' && mid.id) ? mid.id : String(mid);
          const u = allUsers.find(x => String(x.id) === tid);
          return u ? { id: tid, name: u.name } : { id: tid, name: '미등록' };
        }).filter(Boolean);
        result.myClubs.push({ id: c.id, name: c.name, members: memObjs });
      }

      // Reports
      result.reportList = ((R.reports && R.reports.data) || []).map(r => ({
        id: r.id, date: formatDate(r.date), reporterId: r.reporter_id || '', reporterName: r.reporter_name, content: r.content, fileLink: r.file_link || '',
        reply: r.reply || '', replyTeacher: r.reply_teacher || '', replyDate: r.reply_date ? formatDate(r.reply_date) : ''
      }));

      // Praises
      for (const p of ((R.praises && R.praises.data) || [])) {
        const pObj = { id: p.id, date: formatDate(p.date), senderName: p.sender_name, receiverName: p.receiver_name, content: p.content };
        if (p.status === 'Pending') result.pendingPraises.push(pObj);
        else if (p.status === 'Approved') result.approvedPraises.push(pObj);
      }
      result.pendingPraises.reverse();
      result.approvedPraises.reverse();

      // myName / clubs 에 의존하는 조회 (교사 전용, 2단계)
      const [tLogsRes, clubLogsRes] = await Promise.all([
        supabase.from('logs').select('*').eq('teacher', myName).order('id', { ascending: false }).limit(50),
        myClubIds.length > 0
          ? supabase.from('club_logs').select('*').in('club_id', myClubIds).order('id', { ascending: false }).limit(50)
          : Promise.resolve({ data: [] })
      ]);
      result.teacherHistory = ((tLogsRes && tLogsRes.data) || []).map(l => ({
        rowIndex: l.id, date: formatDate(l.date), target: l.student_id, item: l.item, point: Number(l.point)
      }));
      result.clubLogs = ((clubLogsRes && clubLogsRes.data) || []).map(l => ({
        rowIndex: l.id, date: l.date, clubId: l.club_id, data: JSON.stringify(l.data)
      }));
    }

    // Surveys (공통 처리)
    for (const s of surveys) {
      let myVoted = false;
      if (role !== 'teacher') {
        myVoted = surveyLogs.some(sl => String(sl.vote_id) === String(s.id) && String(sl.student_id) === sid);
      }
      const sv = { id: s.id, title: s.title, questions: s.questions, voted: myVoted, allowPhoto: !!s.allow_photo, allowVideo: !!s.allow_video, status: s.status || 'O' };
      if (isTeacher) {
        sv.stats = getSurveyStats(s.id, s.questions, surveyLogs, !!s.allow_photo, !!s.allow_video);
      }
      result.surveyList.push(sv);
    }
    result.surveyList.reverse();

    // Quizzes (공통 처리)
    for (const q of quizzes) {
      let mySolved = false;
      if (role !== 'teacher') {
        mySolved = quizLogs.some(ql =>
          String(ql.quiz_id) === String(q.id) && String(ql.student_id) === sid && ql.status === 'Rewarded'
        );
      }
      let qc = q.questions;
      if (role !== 'teacher') {
        qc = qc.map(x => ({ type: x.type, q: x.q, opts: x.opts, hint: x.hint || '' }));
      }
      result.quizList.push({ id: q.id, teacherName: q.teacher, title: q.title, questions: qc, isSolved: mySolved, status: q.status || 'O' });
    }
    result.quizList.reverse();

    // Announcements (공지사항)
    result.notices = ((R.notices && R.notices.data) || []).map(n => ({
      id: n.id,
      teacher: n.teacher || '',
      title: n.title || '',
      content: n.content || '',
      date: formatDate(n.created_at || n.date),
      status: n.status || 'O'
    }));

  } catch (e) {
    console.error(e);
    result.error = e.message;
  }

  return res.json(result);
};

function getSurveyStats(vid, qs, logs, allowPhoto, allowVideo) {
  if (!logs) return '-';
  const st = qs.map(q => (q.type === 'text' ? [] : {}));
  const photos = [];
  const videos = [];
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
      if (log.video_url) videos.unshift({ url: log.video_url, sid: log.student_id });
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
  if (allowVideo) {
    h += `<div class='mt-3 pt-2 border-top'><strong>🎬 업로드된 영상 (${videos.length})</strong>`;
    if (videos.length === 0) {
      h += `<div class='text-muted small mt-1'>업로드된 영상이 없습니다.</div>`;
    } else {
      h += `<div class='d-flex flex-column gap-2 mt-2'>`;
      videos.forEach(v => {
        h += `<div class='d-flex align-items-center justify-content-between p-2 bg-light rounded small'>
          <span><i class='bi bi-camera-video-fill text-primary'></i> 학번 <strong>${v.sid}</strong></span>
          <div class='d-flex gap-1'>
            <a href='${v.url}' target='_blank' class='btn btn-sm btn-outline-primary'>▶ 재생</a>
            <a href='${v.url}' download class='btn btn-sm btn-outline-secondary'>⬇ 다운로드</a>
          </div>
        </div>`;
      });
      h += `</div>`;
    }
    h += `</div>`;
  }
  h += `</div>`;
  return h;
}
