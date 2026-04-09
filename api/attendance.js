const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { id } = req.body;
  const supabase = getSupabase();

  const { data: user } = await supabase.from('users').select('points').eq('id', String(id).trim()).single();
  if (!user) return res.json({ success: false, msg: '학생 없음' });

  // 오늘 날짜 (KST)
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayStr = kst.toISOString().slice(0, 10);

  // 오늘 출석 체크 여부 확인
  const { data: todayLogs } = await supabase
    .from('logs')
    .select('*')
    .eq('student_id', String(id))
    .eq('item', '출석체크')
    .gte('date', todayStr + 'T00:00:00+09:00')
    .lt('date', todayStr + 'T23:59:59+09:00');

  if (todayLogs && todayLogs.length > 0) {
    return res.json({ success: false, msg: '이미 완료' });
  }

  await supabase.from('logs').insert({ teacher: 'System', student_id: id, item: '출석체크', point: 10 });
  await supabase.from('users').update({ points: (Number(user.points) || 0) + 10 }).eq('id', String(id).trim());

  return res.json({ success: true, msg: '완료! +10P' });
};
