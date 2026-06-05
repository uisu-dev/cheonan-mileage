const { getSupabase, cors } = require('../lib/supabase');

const WORDS = ['학행일여', '지성', '우애', '단결', '향나무', '장미'];

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  // 가장 최근 회차 조회 헬퍼
  async function latestRound() {
    const { data } = await supabase.from('roulette_rounds')
      .select('*').order('id', { ascending: false }).limit(1);
    return (data && data[0]) || null;
  }
  async function openRound() {
    const { data } = await supabase.from('roulette_rounds')
      .select('*').eq('status', 'O').order('id', { ascending: false }).limit(1);
    return (data && data[0]) || null;
  }

  // 교사: 새 회차 시작
  if (action === 'startRound') {
    const { teacherName } = req.body;
    const existing = await openRound();
    if (existing) return res.json({ success: false, msg: '이미 진행 중인 회차가 있습니다. 먼저 마감해주세요.' });
    const { data, error } = await supabase.from('roulette_rounds')
      .insert({ status: 'O', winner_word: '', teacher_name: teacherName || '' }).select().single();
    if (error) return res.json({ success: false, msg: '시작 실패: ' + error.message });
    return res.json({ success: true, msg: '새 회차가 시작되었습니다!', roundId: data.id });
  }

  // 학생: 단어 선택
  if (action === 'pick') {
    const { studentId, studentName, word } = req.body;
    if (!WORDS.includes(word)) return res.json({ success: false, msg: '잘못된 단어입니다.' });
    const round = await openRound();
    if (!round) return res.json({ success: false, msg: '진행 중인 돌림판이 없습니다.' });
    if (round.winner_word) return res.json({ success: false, msg: '이미 추첨이 시작되어 선택할 수 없습니다.' });
    const { error } = await supabase.from('roulette_picks').upsert(
      { round_id: round.id, student_id: String(studentId), student_name: studentName || '', word: word },
      { onConflict: 'round_id,student_id' }
    );
    if (error) return res.json({ success: false, msg: '선택 실패: ' + error.message });
    return res.json({ success: true, msg: "'" + word + "' 선택 완료! 추첨을 기다려주세요." });
  }

  // 교사: 관리창 현황
  if (action === 'status') {
    const round = await latestRound();
    const counts = {}; WORDS.forEach(w => counts[w] = 0);
    let total = 0; let winners = [];
    if (round) {
      const { data: picks } = await supabase.from('roulette_picks').select('*').eq('round_id', round.id);
      (picks || []).forEach(p => { if (counts[p.word] !== undefined) { counts[p.word]++; total++; } });
      if (round.winner_word) {
        winners = (picks || []).filter(p => p.word === round.winner_word)
          .map(p => ({ id: p.student_id, name: p.student_name }));
      }
    }
    return res.json({
      success: true, words: WORDS,
      round: round ? { id: round.id, status: round.status, winnerWord: round.winner_word || '' } : null,
      counts, total, winners
    });
  }

  // 교사: 돌리기 결과 저장
  if (action === 'spin') {
    const { word } = req.body;
    if (!WORDS.includes(word)) return res.json({ success: false, msg: '잘못된 단어입니다.' });
    const round = await openRound();
    if (!round) return res.json({ success: false, msg: '진행 중인 회차가 없습니다.' });
    await supabase.from('roulette_rounds').update({ winner_word: word }).eq('id', round.id);
    const { data: picks } = await supabase.from('roulette_picks').select('*')
      .eq('round_id', round.id).eq('word', word);
    return res.json({ success: true, winnerWord: word, winners: (picks || []).map(p => ({ id: p.student_id, name: p.student_name })) });
  }

  // 교사: 당첨자 100P 지급 + 마감
  if (action === 'reward') {
    const { teacherName } = req.body;
    const round = await openRound();
    if (!round) return res.json({ success: false, msg: '진행 중인 회차가 없습니다.' });
    if (!round.winner_word) return res.json({ success: false, msg: '먼저 돌림판을 돌려 당첨 단어를 정해주세요.' });

    const { data: picks } = await supabase.from('roulette_picks').select('*')
      .eq('round_id', round.id).eq('word', round.winner_word);
    const winners = picks || [];
    let paid = 0;
    if (winners.length) {
      const ids = winners.map(w => String(w.student_id).trim());
      const { data: users } = await supabase.from('users').select('id, points, penalty_total').in('id', ids);
      const logRows = [];
      await Promise.all((users || []).map(u => {
        const onPenalty = Number(u.penalty_total) > 0;
        if (onPenalty) {
          logRows.push({ teacher: 'System', student_id: u.id, item: '행운의 돌림판 당첨 (' + round.winner_word + ') (징계 중 미반영)', point: 0 });
          return Promise.resolve();
        }
        paid++;
        logRows.push({ teacher: teacherName || 'System', student_id: u.id, item: '행운의 돌림판 당첨 (' + round.winner_word + ')', point: 100 });
        return supabase.from('users').update({ points: (Number(u.points) || 0) + 100 }).eq('id', u.id);
      }));
      if (logRows.length) await supabase.from('logs').insert(logRows);
    }
    await supabase.from('roulette_rounds').update({ status: 'C' }).eq('id', round.id);
    return res.json({ success: true, msg: '당첨자 ' + winners.length + '명 중 ' + paid + '명에게 100P 지급 후 마감했습니다.', winnerCount: winners.length });
  }

  // 교사: 그냥 마감(취소)
  if (action === 'cancel') {
    const round = await openRound();
    if (round) await supabase.from('roulette_rounds').update({ status: 'C' }).eq('id', round.id);
    return res.json({ success: true, msg: '회차를 마감했습니다.' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
