const { getSupabase, cors, formatDate } = require('../lib/supabase');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json([]);

  const { studentId } = req.body;
  const supabase = getSupabase();

  const { data: logs } = await supabase
    .from('logs').select('*')
    .eq('student_id', String(studentId).trim())
    .order('id', { ascending: false })
    .limit(50);

  const result = (logs || []).map(l => ({
    date: formatDate(l.date), item: l.item, point: Number(l.point)
  }));

  return res.json(result);
};
