// 1인 1역(봉사도우미) API — 교사/관리자 전용. 로직은 lib/class-roles.js
const { getSupabase, cors } = require('../lib/supabase');
const CR = require('../lib/class-roles');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false });
  try {
    return res.json(await CR.handle(req.body || {}, { supabase: getSupabase() }));
  } catch (e) {
    return res.json({ success: false, msg: '서버 오류: ' + (e && e.message ? e.message : e) });
  }
};
