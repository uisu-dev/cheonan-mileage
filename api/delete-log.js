const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { rowId, studentId, point } = req.body;
  const supabase = getSupabase();

  try {
    await supabase.from('logs').delete().eq('id', Number(rowId));
    const { data: user } = await supabase.from('users').select('points').eq('id', String(studentId).trim()).single();
    if (user) {
      await supabase.from('users').update({ points: (Number(user.points) || 0) - Number(point) }).eq('id', String(studentId).trim());
    }
    return res.json({ success: true, msg: '삭제/회수 완료' });
  } catch (e) {
    return res.json({ success: false, msg: e.message });
  }
};
