const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { teacher, studentId, rewardName, cost } = req.body;
  const supabase = getSupabase();

  const { data: user } = await supabase.from('users').select('points').eq('id', String(studentId).trim()).single();
  if (!user) return res.json({ success: false, msg: '학생 없음' });

  const currentPoints = Number(user.points) || 0;
  if (currentPoints < cost) return res.json({ success: false, msg: '포인트 부족' });

  await supabase.from('users').update({ points: currentPoints - cost }).eq('id', String(studentId).trim());
  await supabase.from('logs').insert({ teacher, student_id: studentId, item: '교환: ' + rewardName, point: -cost });

  return res.json({ success: true, msg: '교환 완료' });
};
