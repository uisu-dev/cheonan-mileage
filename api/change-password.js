const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const { id, newPw } = req.body;
  const supabase = getSupabase();

  const { error } = await supabase
    .from('users')
    .update({ password: String(newPw).trim() })
    .eq('id', String(id).trim());

  if (error) return res.json({ success: false, msg: '실패' });
  return res.json({ success: true, msg: '변경 완료' });
};
