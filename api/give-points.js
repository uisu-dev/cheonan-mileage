const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { teacher, ids, itemName, point } = req.body;
  const supabase = getSupabase();
  let count = 0;

  for (const id of ids) {
    const { data: user } = await supabase.from('users').select('points').eq('id', String(id).trim()).single();
    if (user) {
      await supabase.from('logs').insert({ teacher, student_id: id, item: itemName, point: Number(point) });
      await supabase.from('users').update({ points: (Number(user.points) || 0) + Number(point) }).eq('id', String(id).trim());
      count++;
    }
  }

  return res.json({ success: true, msg: count + '명 완료' });
};
