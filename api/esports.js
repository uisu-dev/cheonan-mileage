const { getSupabase, cors } = require('../lib/supabase');
const esports = require('../lib/esports'); // 찾아가는 이스포츠 대회 신청 (2·3학년)

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  const body = req.body || {};
  const { action } = body;
  const supabase = getSupabase();

  try {
    if (action === 'status') return res.json(await esports.status(supabase, body.studentId));
    if (action === 'search') return res.json(await esports.search(supabase, body.studentId, body.q));
    if (action === 'apply') return res.json(await esports.apply(supabase, body));
    if (action === 'cancel') return res.json(await esports.cancel(supabase, body.studentId));
    if (action === 'list') return res.json(await esports.list(supabase, body.teacherId));
    if (action === 'teacherSearch') return res.json(await esports.teacherSearch(supabase, body.teacherId, body.q));
    if (action === 'teacherRegister') return res.json(await esports.teacherRegister(supabase, body));
    if (action === 'teacherRemove') return res.json(await esports.teacherRemove(supabase, body.teacherId, body.teamId));
  } catch (e) {
    return res.json({ success: false, msg: String(e.message || e) });
  }
  return res.json({ success: false, msg: '알 수 없는 action' });
};
