const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { action } = req.body;
  const supabase = getSupabase();

  if (action === 'login') {
    const { id, pw } = req.body;
    const { data, error } = await supabase
      .from('users').select('*').eq('id', String(id).trim()).single();

    if (error || !data) return res.json({ success: false, message: '학번 또는 비밀번호를 확인해주세요.' });
    if (String(data.password).trim() !== String(pw).trim()) return res.json({ success: false, message: '학번 또는 비밀번호를 확인해주세요.' });

    return res.json({
      success: true, role: String(data.role).toLowerCase().trim(),
      name: String(data.name), id: String(data.id).trim(),
      points: Number(data.points) || 0, umbrella: data.umbrella || '',
      ball: data.ball || '', mbti: data.mbti || ''
    });
  }

  if (action === 'changePassword') {
    const { id, newPw } = req.body;
    const { error } = await supabase.from('users').update({ password: String(newPw).trim() }).eq('id', String(id).trim());
    if (error) return res.json({ success: false, msg: '실패' });
    return res.json({ success: true, msg: '변경 완료' });
  }

  return res.json({ success: false, msg: '알 수 없는 action' });
};
