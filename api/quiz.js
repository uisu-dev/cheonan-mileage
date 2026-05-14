const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'create') {
    const { teacherName, title, questions } = req.body;
    if (!title || !questions || !questions.length) {
      return res.json({ success: false, msg: '제목과 문제를 입력하세요.' });
    }
    // 각 문제에 정답(a) 누락 체크
    for (let i = 0; i < questions.length; i++) {
      if (!questions[i].a || !String(questions[i].a).trim()) {
        return res.json({ success: false, msg: `${i + 1}번 문제의 정답을 입력하세요.` });
      }
    }
    const { error } = await supabase.from('quizzes').insert({
      id: String(Date.now()), teacher: teacherName, title, questions, status: 'O'
    });
    if (error) return res.json({ success: false, msg: '등록 실패: ' + error.message });
    return res.json({ success: true, msg: '퀴즈가 등록되었습니다.' });
  }

  if (action === 'submit') {
    const { studentId, quizId, answers } = req.body;

    // 이미 정답으로 보상 받았는지 확인
    const { data: existing } = await supabase
      .from('quiz_logs').select('id')
      .eq('quiz_id', quizId)
      .eq('student_id', studentId)
      .eq('status', 'Rewarded');

    if (existing && existing.length > 0) {
      return res.json({ success: false, msg: '이미 정답을 맞춰 점수를 받으셨습니다.' });
    }

    const { data: quiz } = await supabase.from('quizzes').select('*').eq('id', quizId).single();
    if (!quiz) return res.json({ success: false, msg: '퀴즈 정보를 찾을 수 없습니다.' });

    const qo = quiz.questions || [];
    const wrongIndices = [];
    let correct = 0;
    for (let i = 0; i < qo.length; i++) {
      const stuAns = String(answers[i] || '').trim().toLowerCase();
      const ansKey = String(qo[i].a || '').trim().toLowerCase();
      if (stuAns && stuAns === ansKey) correct++;
      else wrongIndices.push(i + 1);
    }

    if (correct === qo.length && qo.length > 0) {
      // 만점: 보상 처리 (50P)
      const { data: user } = await supabase.from('users')
        .select('points, penalty_total').eq('id', studentId).single();
      if (!user) return res.json({ success: false, msg: '학생 정보 오류' });

      const onPenalty = Number(user.penalty_total) > 0;
      await supabase.from('quiz_logs').insert({
        quiz_id: quizId, student_id: studentId,
        result: correct + '/' + qo.length, status: 'Rewarded'
      });

      if (onPenalty) {
        await supabase.from('logs').insert({
          teacher: 'System', student_id: studentId,
          item: '퀴즈 만점: ' + quiz.title + ' (징계 중 점수 미반영)', point: 0
        });
        return res.json({
          success: true, allCorrect: true,
          msg: '🎉 모든 문제를 맞췄어요!\n(징계 중이므로 점수는 지급되지 않습니다.)'
        });
      }

      await supabase.from('users')
        .update({ points: Number(user.points) + 50 })
        .eq('id', studentId);
      await supabase.from('logs').insert({
        teacher: 'System', student_id: studentId,
        item: '퀴즈 만점: ' + quiz.title, point: 50
      });
      return res.json({
        success: true, allCorrect: true,
        msg: '🎉 모든 문제를 맞췄어요!\n+50P가 적립되었습니다!'
      });
    }

    // 부분 정답 / 오답: 틀린 문제 번호 안내, 재도전 가능
    return res.json({
      success: false, allCorrect: false,
      correct: correct, total: qo.length, wrongQuestions: wrongIndices,
      msg: `${qo.length}문제 중 ${correct}개 정답이에요.\n${wrongIndices.join(', ')}번 문제를 다시 풀어보세요! 💪`
    });
  }

  if (action === 'close') {
    const { id } = req.body;
    await supabase.from('quizzes').update({ status: 'C' }).eq('id', id);
    return res.json({ success: true, msg: '마감되었습니다. 학생 화면에서 숨겨집니다.' });
  }

  if (action === 'reopen') {
    const { id } = req.body;
    await supabase.from('quizzes').update({ status: 'O' }).eq('id', id);
    return res.json({ success: true, msg: '다시 공개되었습니다.' });
  }

  if (action === 'delete') {
    const { id } = req.body;
    await supabase.from('quizzes').delete().eq('id', id);
    return res.json({ success: true, msg: '삭제되었습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
