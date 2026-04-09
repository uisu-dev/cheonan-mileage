const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'create') {
    const { teacherName, title, questions } = req.body;
    await supabase.from('quizzes').insert({
      id: String(Date.now()), teacher: teacherName, title, questions, status: 'O'
    });
    return res.json({ success: true, msg: '등록' });
  }

  if (action === 'submit') {
    const { studentId, quizId, answers } = req.body;

    // 이미 풀었는지 확인
    const { data: existing } = await supabase
      .from('quiz_logs').select('id')
      .eq('quiz_id', quizId)
      .eq('student_id', studentId)
      .eq('status', 'Rewarded');

    if (existing && existing.length > 0) {
      return res.json({ success: false, msg: '이미함' });
    }

    // 퀴즈 정보 가져오기
    const { data: quiz } = await supabase.from('quizzes').select('*').eq('id', quizId).single();
    if (!quiz) return res.json({ success: false, msg: '오류' });

    const qo = quiz.questions;
    let correct = 0;
    for (let i = 0; i < qo.length; i++) {
      if (String(answers[i]).trim().toLowerCase() === String(qo[i].a).trim().toLowerCase()) correct++;
    }

    if (correct === qo.length) {
      const { data: user } = await supabase.from('users').select('points').eq('id', studentId).single();
      if (user) {
        await supabase.from('users').update({ points: Number(user.points) + 100 }).eq('id', studentId);
        await supabase.from('logs').insert({ teacher: 'System', student_id: studentId, item: '퀴즈만점: ' + quiz.title, point: 100 });
        await supabase.from('quiz_logs').insert({ quiz_id: quizId, student_id: studentId, result: correct + '/' + qo.length, status: 'Rewarded' });
        return res.json({ success: true, msg: '만점! +100P' });
      }
    }

    return res.json({ success: false, msg: correct + '개 맞음' });
  }

  if (action === 'delete') {
    const { id } = req.body;
    await supabase.from('quizzes').delete().eq('id', id);
    return res.json({ success: true, msg: '삭제되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
