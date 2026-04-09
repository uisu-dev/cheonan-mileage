const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { type, teacher, ids, action } = req.body;
  const supabase = getSupabase();
  const col = type === 'umbrella' ? 'umbrella' : 'ball';
  const txt = type === 'umbrella' ? '우산' : '공';
  let count = 0;

  for (const id of ids) {
    const { data: user } = await supabase.from('users').select('*').eq('id', String(id).trim()).single();
    if (!user) continue;

    if (action === 'rent' && user[col] !== '대여중') {
      await supabase.from('users').update({ [col]: '대여중' }).eq('id', String(id).trim());
      await supabase.from('logs').insert({ teacher, student_id: id, item: txt + ' 대여', point: 0 });
      count++;
    } else if (action === 'return' && user[col] === '대여중') {
      await supabase.from('users').update({ [col]: '' }).eq('id', String(id).trim());
      await supabase.from('logs').insert({ teacher, student_id: id, item: txt + ' 반납', point: 0 });
      count++;
    }
  }

  return res.json({ success: true, msg: count + '명 처리' });
};
