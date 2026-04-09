const { getSupabase, cors } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { id, pw } = req.body;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', String(id).trim())
    .single();

  if (error || !data) {
    return res.json({ success: false, message: '학번 또는 비밀번호를 확인해주세요.' });
  }

  if (String(data.password).trim() !== String(pw).trim()) {
    return res.json({ success: false, message: '학번 또는 비밀번호를 확인해주세요.' });
  }

  return res.json({
    success: true,
    role: String(data.role).toLowerCase().trim(),
    name: String(data.name),
    id: String(data.id).trim(),
    points: Number(data.points) || 0,
    umbrella: data.umbrella || '',
    ball: data.ball || '',
    mbti: data.mbti || ''
  });
};
