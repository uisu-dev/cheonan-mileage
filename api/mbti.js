const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { id, mbti } = req.body;
  const supabase = getSupabase();

  const { data: user } = await supabase.from('users').select('points, mbti').eq('id', String(id).trim()).single();
  if (!user) return res.json({ success: false, msg: '오류' });

  if (!user.mbti || user.mbti === '') {
    await supabase.from('users').update({ mbti, points: Number(user.points) + 100 }).eq('id', String(id).trim());
    await supabase.from('logs').insert({ teacher: 'System', student_id: id, item: 'MBTI 완료', point: 100 });
    return res.json({ success: true, msg: '결과 저장 +100P!' });
  } else {
    await supabase.from('users').update({ mbti }).eq('id', String(id).trim());
    return res.json({ success: true, msg: '결과 수정 완료' });
  }
};
