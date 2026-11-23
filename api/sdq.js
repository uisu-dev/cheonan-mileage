const { getSupabase, cors } = require('../lib/supabase');
const { handleAction } = require('../lib/sdq');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, msg: 'POST만 받을 수 있습니다.' });
  const result = await handleAction(getSupabase(), req.body || {}, { now: Date.now() });
  return res.status(result.status || 200).json(result.body);
};
